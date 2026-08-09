import type { WebRetrievalProviderConfig } from "./web_retrieval_types.ts";
import {
    ProviderError,
    type AdapterFetchResponse,
    type FetchAdapter,
    type FetchItem,
    type FetchProviderId,
    type NormalizedFetchRequest,
    type WebFetchDetails,
    type WebRetrievalRuntimeConfig,
} from "./web_retrieval_types.ts";
import {
    createExaContentsAdapter,
    createParallelExtractAdapter,
    FetchHttpError,
    normalizeLineEndings,
    type FetchAdapterDependencies,
} from "./web_fetch_adapters.ts";
export { defaultSleep } from "./web_retrieval_runtime.ts";

export type ReadTextFile = (path: string) => Promise<string>;
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface FetchRouterDependencies extends FetchAdapterDependencies {
    readTextFile: ReadTextFile;
    sleep: Sleep;
    now: () => number;
}

export interface FetchRouterResponse extends AdapterFetchResponse {
    provider: FetchProviderId;
    latencyMs: number;
    retryCount: 0 | 1;
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function configFor(config: WebRetrievalRuntimeConfig, provider: FetchProviderId): WebRetrievalProviderConfig {
    const found = config.providers.find(candidate => candidate.id === provider);
    if (found === undefined) throw new ProviderError({ provider, category: "unavailable", retryable: false });
    return found;
}

async function loadCredential(provider: FetchProviderId, path: string | null, readTextFile: ReadTextFile): Promise<string> {
    if (path === null) throw new ProviderError({ provider, category: "credential", retryable: false });
    try {
        const key = (await readTextFile(path)).trim();
        if (key !== "") return key;
    } catch {
        // Replace filesystem diagnostics with a bounded provider error.
    }
    throw new ProviderError({ provider, category: "credential", retryable: false });
}

export function combineSignals(signals: readonly AbortSignal[]): AbortSignal {
    const controller = new AbortController();
    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort(signal.reason);
            break;
        }
        signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
}

export async function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw signal.reason ?? new Error("aborted");
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(signal.reason ?? new Error("aborted"));
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            value => {
                signal.removeEventListener("abort", onAbort);
                resolve(value);
            },
            error => {
                signal.removeEventListener("abort", onAbort);
                reject(error);
            },
        );
    });
}

function retryWaitMs(error: ProviderError, defaultWaitMs: number): number {
    if (!RETRYABLE_STATUSES.has(error.status ?? 0)) return 0;
    return error instanceof FetchHttpError && error.retryWaitMs >= 0 ? error.retryWaitMs : defaultWaitMs;
}

function applyTextBudget(items: readonly FetchItem[], maxCharsTotal: number): { items: FetchItem[]; warnings: unknown[] } {
    let remaining = maxCharsTotal;
    const warnings: unknown[] = [];
    const budgeted = items.map(item => {
        if (item.error !== undefined) return { ...item };
        let truncated = false;
        let omittedChars = 0;
        const take = (value: string): string | undefined => {
            const normalized = normalizeLineEndings(value);
            if (normalized.length <= remaining) {
                remaining -= normalized.length;
                return normalized;
            }
            const kept = normalized.slice(0, remaining);
            omittedChars += normalized.length - kept.length;
            remaining = 0;
            truncated = true;
            return kept === "" ? undefined : kept;
        };
        const excerpts = item.excerpts?.flatMap(excerpt => {
            const value = take(excerpt);
            return value === undefined ? [] : [value];
        });
        const content = item.content === undefined ? undefined : take(item.content);
        const { excerpts: originalExcerpts, content: originalContent, ...base } = item;
        void originalExcerpts;
        void originalContent;
        const next: FetchItem = {
            ...base,
            ...(excerpts === undefined ? {} : { excerpts }),
            ...(content === undefined ? {} : { content }),
            ...(truncated ? { truncated: true } : {}),
        };
        if (truncated) warnings.push({ inputIndex: item.inputIndex, reason: "character-budget", omittedChars });
        return next;
    });
    return { items: budgeted, warnings };
}

function createAdapter(provider: FetchProviderId, endpoint: string, apiKey: string, deps: FetchRouterDependencies): FetchAdapter {
    const adapterDeps = { fetch: deps.fetch, now: deps.now };
    return provider === "parallel-extract"
        ? createParallelExtractAdapter({ endpoint, apiKey }, adapterDeps)
        : createExaContentsAdapter({ endpoint, apiKey }, adapterDeps);
}

export async function routeWebFetch(
    request: NormalizedFetchRequest,
    config: WebRetrievalRuntimeConfig,
    deps: FetchRouterDependencies,
    callerSignal?: AbortSignal,
): Promise<FetchRouterResponse> {
    const provider: FetchProviderId = request.mode === "relevant" ? "parallel-extract" : "exa-contents";
    const startedAt = deps.now();
    const deadline = startedAt + config.deadlinesMs.fetch;
    const timeout = AbortSignal.timeout(config.deadlinesMs.fetch);
    const operationSignal = callerSignal === undefined ? timeout : combineSignals([callerSignal, timeout]);
    const terminalError = (): Error | undefined => {
        if (callerSignal?.aborted) return new Error("web_fetch request aborted");
        if (timeout.aborted || deps.now() >= deadline) {
            return new ProviderError({ provider, category: "timeout", retryable: false });
        }
        return undefined;
    };

    const providerConfig = configFor(config, provider);
    let apiKey: string;
    try {
        const terminal = terminalError();
        if (terminal !== undefined) throw terminal;
        apiKey = await raceWithSignal(loadCredential(provider, providerConfig.apiKeyFile, deps.readTextFile), operationSignal);
    } catch (error) {
        throw terminalError() ?? error;
    }
    const adapter = createAdapter(provider, providerConfig.endpoint, apiKey, deps);
    let retryCount: 0 | 1 = 0;

    while (true) {
        const terminal = terminalError();
        if (terminal !== undefined) throw terminal;
        try {
            const response = await raceWithSignal(adapter.fetch(request, operationSignal), operationSignal);
            const budgeted = applyTextBudget(response.items, request.maxCharsTotal);
            return {
                ...response,
                provider,
                latencyMs: Math.max(0, deps.now() - startedAt),
                retryCount,
                items: budgeted.items,
                ...(budgeted.warnings.length === 0
                    ? {}
                    : { warnings: [...(response.warnings ?? []), ...budgeted.warnings] }),
            };
        } catch (error) {
            const stopped = terminalError();
            if (stopped !== undefined) throw stopped;
            if (error instanceof Error && error.name === "TimeoutError") {
                throw new ProviderError({ provider, category: "timeout", retryable: false });
            }
            if (!(error instanceof ProviderError) || !error.retryable || retryCount === 1) throw error;
            const waitMs = retryWaitMs(error, config.retry.defaultWaitMs);
            if (waitMs > deadline - deps.now()) throw new ProviderError({ provider, category: "timeout", retryable: false });
            try {
                await raceWithSignal(deps.sleep(waitMs, operationSignal), operationSignal);
            } catch {
                throw terminalError() ?? new ProviderError({ provider, category: "timeout", retryable: false });
            }
            retryCount = 1;
        }
    }
}

export function fetchResponseDetails(requestId: string, response: FetchRouterResponse): WebFetchDetails["response"] {
    return {
        requestId,
        provider: response.provider,
        latencyMs: response.latencyMs,
        retryCount: response.retryCount,
        items: response.items,
        ...(response.providerRequestId === undefined ? {} : { providerRequestId: response.providerRequestId }),
        ...(response.providerSessionId === undefined ? {} : { providerSessionId: response.providerSessionId }),
        ...(response.warnings === undefined ? {} : { warnings: response.warnings }),
        ...(response.usage === undefined ? {} : { usage: response.usage }),
        ...(response.unsupportedHints === undefined ? {} : { unsupportedHints: response.unsupportedHints }),
    };
}
