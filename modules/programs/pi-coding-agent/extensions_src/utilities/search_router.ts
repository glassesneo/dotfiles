import { randomUUID } from "node:crypto";
import type { readFile as nodeReadFile } from "node:fs/promises";
import {
    ProviderError,
    type AdapterSearchResponse,
    type NormalizedSearchRequest,
    type SearchAdapter,
    type SearchAttempt,
    type SearchEligibilityDiagnostic,
    type SearchLane,
    type SearchProviderId,
    type WebRetrievalRuntimeConfig,
    type WebSearchDetails,
} from "./web_retrieval_types.ts";
import {
    SearchMappingError,
    SearchRequestError,
    createSearchAdapter,
    type FetchLike,
} from "./search_adapters.ts";

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export interface SearchRouterDependencies {
    fetch: FetchLike;
    readTextFile: (path: string, signal: AbortSignal) => Promise<string>;
    sleep: Sleep;
    now: () => number;
    rng: () => number;
    requestId: () => string;
}

export interface SearchRouter {
    search(
        config: WebRetrievalRuntimeConfig,
        request: NormalizedSearchRequest,
        callerSignal?: AbortSignal,
    ): Promise<WebSearchDetails["response"]>;
}

class DeadlineError extends Error {
    constructor() {
        super("deadline exceeded");
        this.name = "DeadlineError";
    }
}

export async function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw signal.reason ?? new Error("aborted");
    await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason ?? new Error("aborted"));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

export function defaultSearchRouterDependencies(
    readTextFile: typeof nodeReadFile,
): SearchRouterDependencies {
    return {
        fetch: globalThis.fetch.bind(globalThis),
        readTextFile: (path, signal) => readTextFile(path, { encoding: "utf8", signal }),
        sleep: defaultSleep,
        now: () => Date.now(),
        rng: () => Math.random(),
        requestId: () => randomUUID(),
    };
}

function combineSignals(caller: AbortSignal | undefined, deadlineMs: number): {
    signal: AbortSignal;
    deadlineController: AbortController;
    cancel: () => void;
} {
    const controller = new AbortController();
    const deadlineController = new AbortController();
    const forwardCaller = () => controller.abort(caller?.reason);
    const forwardDeadline = () => controller.abort(deadlineController.signal.reason);
    if (caller?.aborted) forwardCaller();
    else caller?.addEventListener("abort", forwardCaller, { once: true });
    deadlineController.signal.addEventListener("abort", forwardDeadline, { once: true });
    const timer = setTimeout(() => deadlineController.abort(new DeadlineError()), deadlineMs);
    return {
        signal: controller.signal,
        deadlineController,
        cancel() {
            clearTimeout(timer);
            caller?.removeEventListener("abort", forwardCaller);
            deadlineController.signal.removeEventListener("abort", forwardDeadline);
        },
    };
}

function capabilityDiagnostics(
    adapter: SearchAdapter,
    request: NormalizedSearchRequest,
    lane: SearchLane,
): SearchEligibilityDiagnostic[] {
    const diagnostics: SearchEligibilityDiagnostic[] = [];
    if (!adapter.capabilities.lanes.includes(lane)) {
        diagnostics.push({ provider: adapter.id, category: "capability", reason: "lane" });
    }
    const hasDomains = request.includeDomains !== undefined || request.excludeDomains !== undefined;
    if (hasDomains && !adapter.capabilities.domains) {
        diagnostics.push({ provider: adapter.id, category: "capability", reason: "domains" });
    }
    return diagnostics;
}

function weightedChoice<T>(choices: Array<{ value: T; weight: number }>, rng: () => number): T {
    if (choices.length === 0) throw new Error("no weighted choices");
    if (choices.length === 1) return choices[0]!.value;
    const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
    const sample = Math.min(Math.max(rng(), 0), 1 - Number.EPSILON) * total;
    let cumulative = 0;
    for (const choice of choices) {
        cumulative += choice.weight;
        if (sample < cumulative) return choice.value;
    }
    return choices.at(-1)!.value;
}

export function selectSearchAdapter(
    eligible: SearchAdapter[],
    lane: SearchLane,
    config: WebRetrievalRuntimeConfig,
    rng: () => number,
): SearchAdapter {
    if (lane === "discovery") {
        const exa = eligible.find(adapter => adapter.id === "exa-search");
        if (exa === undefined) throw new Error("web_search has no eligible discovery provider");
        return exa;
    }
    const parallel = eligible.find(adapter => adapter.id === "parallel-search");
    const brave = eligible.filter(adapter => adapter.family === "brave");
    const families: Array<{ value: "parallel" | "brave"; weight: number }> = [];
    if (parallel !== undefined) families.push({ value: "parallel", weight: config.routing.generalFamilies.parallel });
    if (brave.length > 0) families.push({ value: "brave", weight: config.routing.generalFamilies.brave });
    const family = weightedChoice(families, rng);
    if (family === "parallel") return parallel!;
    return weightedChoice(brave.map(adapter => ({
        value: adapter,
        weight: config.routing.braveProviders[adapter.id as "brave-llm-context" | "brave-web-search"],
    })), rng);
}

async function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw signal.reason ?? new Error("aborted");
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(signal.reason ?? new Error("aborted"));
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort)).catch(() => {});
    });
}

async function loadEligibleAdapters(
    config: WebRetrievalRuntimeConfig,
    deps: SearchRouterDependencies,
    signal: AbortSignal,
): Promise<{ adapters: SearchAdapter[]; diagnostics: SearchEligibilityDiagnostic[] }> {
    const searchIds = new Set<SearchProviderId>([
        "parallel-search", "brave-llm-context", "brave-web-search", "exa-search",
    ]);
    const adapters: SearchAdapter[] = [];
    const diagnostics: SearchEligibilityDiagnostic[] = [];
    for (const provider of config.providers) {
        if (!searchIds.has(provider.id as SearchProviderId)) continue;
        const providerId = provider.id as SearchProviderId;
        if (provider.apiKeyFile === null) {
            diagnostics.push({ provider: providerId, category: "credential", reason: "not-configured" });
            continue;
        }
        let key: string;
        try {
            key = (await awaitWithSignal(deps.readTextFile(provider.apiKeyFile, signal), signal)).trim();
        } catch (error) {
            if (signal.aborted) throw signal.reason ?? error;
            diagnostics.push({ provider: providerId, category: "credential", reason: "unreadable" });
            continue;
        }
        if (key === "") {
            diagnostics.push({ provider: providerId, category: "credential", reason: "empty" });
            continue;
        }
        adapters.push(createSearchAdapter(provider, key, { fetch: deps.fetch, now: deps.now }, config.retry.defaultWaitMs));
    }
    return { adapters, diagnostics };
}

function providerFailure(error: unknown, provider: SearchProviderId, timedOut: boolean): ProviderError {
    if (error instanceof ProviderError) return error;
    if (timedOut || error instanceof DeadlineError) {
        return new ProviderError({ provider, category: "timeout", retryable: true });
    }
    return new ProviderError({ provider, category: "network", retryable: true });
}

type AttemptOutcome =
    | { response: AdapterSearchResponse; attempt: SearchAttempt & { outcome: "success" } }
    | { attempt: SearchAttempt & { outcome: "error" } };

async function runAttempt(
    adapter: SearchAdapter,
    request: NormalizedSearchRequest,
    signal: AbortSignal,
    deadlineController: AbortController,
    deadlineAt: number,
    deps: SearchRouterDependencies,
): Promise<AttemptOutcome> {
    const started = deps.now();
    let retryCount: 0 | 1 = 0;
    while (true) {
        try {
            const response = await adapter.search(request, signal);
            return {
                response,
                attempt: { provider: adapter.id, latencyMs: Math.max(0, deps.now() - started), retryCount, outcome: "success" },
            };
        } catch (error) {
            if (error instanceof SearchMappingError) throw error;
            const failure = providerFailure(error, adapter.id, deadlineController.signal.aborted);
            const retryWait = error instanceof SearchRequestError ? error.retryAfterMs : undefined;
            const canRetry = retryCount === 0
                && error instanceof SearchRequestError
                && error.retryable
                && retryWait !== undefined
                && deps.now() + retryWait < deadlineAt
                && !signal.aborted;
            if (canRetry) {
                try {
                    await deps.sleep(retryWait, signal);
                    retryCount = 1;
                    continue;
                } catch {
                    const interrupted = providerFailure(undefined, adapter.id, deadlineController.signal.aborted);
                    return {
                        attempt: {
                            provider: adapter.id,
                            latencyMs: Math.max(0, deps.now() - started),
                            retryCount,
                            outcome: "error",
                            error: { category: interrupted.category, retryable: interrupted.retryable },
                        },
                    };
                }
            }
            return {
                attempt: {
                    provider: adapter.id,
                    latencyMs: Math.max(0, deps.now() - started),
                    retryCount,
                    outcome: "error",
                    error: {
                        category: failure.category,
                        ...(failure.status === undefined ? {} : { status: failure.status }),
                        retryable: failure.retryable,
                    },
                },
            };
        }
    }
}

export class SearchRoutingError extends Error {
    readonly eligibilityDiagnostics: SearchEligibilityDiagnostic[];
    readonly attempts: SearchAttempt[];

    constructor(message: string, eligibilityDiagnostics: SearchEligibilityDiagnostic[], attempts: SearchAttempt[] = []) {
        super(message);
        this.name = "SearchRoutingError";
        this.eligibilityDiagnostics = eligibilityDiagnostics;
        this.attempts = attempts;
    }
}

function exhaustion(attempts: SearchAttempt[], diagnostics: SearchEligibilityDiagnostic[]): SearchRoutingError {
    const summary = attempts.map(attempt => {
        const status = attempt.error?.status === undefined ? "" : `/${attempt.error.status}`;
        return `${attempt.provider}:${attempt.error?.category ?? "unknown"}${status}`;
    }).join(",");
    return new SearchRoutingError(
        `web_search providers exhausted after ${attempts.length} attempt(s): ${summary}`,
        diagnostics,
        attempts,
    );
}

export function createSearchRouter(deps: SearchRouterDependencies): SearchRouter {
    return {
        async search(config, request, callerSignal) {
            const lane: SearchLane = request.intent === "discovery" ? "discovery" : "general";
            const deadlineMs = config.deadlinesMs.search;
            const deadlineAt = deps.now() + deadlineMs;
            const combined = combineSignals(callerSignal, deadlineMs);
            try {
                let loaded: Awaited<ReturnType<typeof loadEligibleAdapters>>;
                try {
                    loaded = await loadEligibleAdapters(config, deps, combined.signal);
                } catch (error) {
                    if (callerSignal?.aborted) throw new Error("web_search request aborted");
                    if (combined.deadlineController.signal.aborted) throw new Error("web_search deadline exceeded");
                    throw error;
                }
                if (callerSignal?.aborted) throw new Error("web_search request aborted");
                const capability = loaded.adapters.flatMap(adapter => capabilityDiagnostics(adapter, request, lane));
                const diagnostics = [...loaded.diagnostics, ...capability];
                const adapters = loaded.adapters.filter(adapter => capabilityDiagnostics(adapter, request, lane).length === 0);
                if (adapters.length === 0) {
                    throw new SearchRoutingError(`web_search has no eligible ${lane} provider`, diagnostics);
                }
                const remaining = [...adapters];
                const attempts: SearchAttempt[] = [];
                const initial = selectSearchAdapter(remaining, lane, config, deps.rng);
                let selected = initial;
                while (true) {
                    const outcome = await runAttempt(
                        selected, request, combined.signal, combined.deadlineController, deadlineAt, deps,
                    );
                    attempts.push(outcome.attempt);
                    if ("response" in outcome) {
                        const response = outcome.response;
                        const results = response.results.slice(0, request.maxResults);
                        const unsupportedHints = [...new Set([
                            ...(response.unsupportedHints ?? []),
                            ...(request.freshness !== undefined && !selected.capabilities.freshness ? ["freshness"] : []),
                        ])];
                        return {
                            requestId: deps.requestId(),
                            lane,
                            initialProvider: initial.id,
                            provider: selected.id,
                            results,
                            fallback: selected.id !== initial.id,
                            attempts,
                            eligibilityDiagnostics: diagnostics,
                            ...(response.providerRequestId === undefined ? {} : { providerRequestId: response.providerRequestId }),
                            ...(response.providerSessionId === undefined ? {} : { providerSessionId: response.providerSessionId }),
                            ...(response.warnings === undefined ? {} : { warnings: response.warnings }),
                            ...(response.usage === undefined ? {} : { usage: response.usage }),
                            ...(unsupportedHints.length === 0 ? {} : { unsupportedHints }),
                            normalizationWarnings: response.normalizationWarnings,
                            providerResultCount: response.providerResultCount,
                            returnedResultCount: results.length,
                        };
                    }
                    if (callerSignal?.aborted) throw new Error("web_search request aborted");
                    const index = remaining.findIndex(adapter => adapter.id === selected.id);
                    if (index >= 0) remaining.splice(index, 1);
                    if (remaining.length === 0 || combined.deadlineController.signal.aborted) {
                        throw exhaustion(attempts, diagnostics);
                    }
                    selected = selectSearchAdapter(remaining, lane, config, deps.rng);
                }
            } finally {
                combined.cancel();
            }
        },
    };
}
