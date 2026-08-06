import {
    WEB_SEARCH_DEFAULT_RETRY_WAIT_MS,
    WEB_SEARCH_REQUEST_TIMEOUT_MS,
    containsAnyControls,
    isSafeHttpUrl,
    isValidIso8601Timestamp,
    type BraveLlmContextProviderConfig,
    type SearchBudget,
    type SearchDocument,
    type SearchFreshness,
    type SearchProvider,
    type SearchRequest,
    type SearchResponse,
} from "./web_search_types.ts";

export interface BudgetLimits {
    count: number;
    maximum_number_of_urls: number;
    maximum_number_of_tokens: number;
    maximum_number_of_snippets: number;
}

export const BUDGET_LIMITS: Record<SearchBudget, BudgetLimits> = {
    small: {
        count: 5,
        maximum_number_of_urls: 5,
        maximum_number_of_tokens: 2048,
        maximum_number_of_snippets: 15,
    },
    standard: {
        count: 20,
        maximum_number_of_urls: 10,
        maximum_number_of_tokens: 4096,
        maximum_number_of_snippets: 30,
    },
    large: {
        count: 50,
        maximum_number_of_urls: 20,
        maximum_number_of_tokens: 8192,
        maximum_number_of_snippets: 50,
    },
};

export const FRESHNESS_TO_BRAVE: Record<SearchFreshness, string> = {
    day: "pd",
    week: "pw",
    month: "pm",
    year: "py",
};

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export type ReadTextFile = (path: string) => Promise<string>;
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;
export type Now = () => number;

export interface BraveLlmContextDependencies {
    fetch: FetchLike;
    readTextFile: ReadTextFile;
    sleep: Sleep;
    now: Now;
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`provider brave returned an invalid ${label}`);
    }
    return value as Record<string, unknown>;
}

export function buildBraveLlmContextBody(request: SearchRequest): Record<string, unknown> {
    const limits = BUDGET_LIMITS[request.budget];
    const body: Record<string, unknown> = {
        q: request.query,
        count: limits.count,
        maximum_number_of_urls: limits.maximum_number_of_urls,
        maximum_number_of_tokens: limits.maximum_number_of_tokens,
        maximum_number_of_snippets: limits.maximum_number_of_snippets,
        context_threshold_mode: "balanced",
        safesearch: "moderate",
        enable_source_metadata: true,
    };
    if (request.freshness !== undefined) {
        body.freshness = FRESHNESS_TO_BRAVE[request.freshness];
    }
    return body;
}

export function normalizeBraveLlmContextResponse(
    payload: unknown,
    request: SearchRequest,
    providerId: string,
): SearchResponse {
    const root = object(payload, "response");
    const grounding = object(root.grounding, "grounding");
    if (!Array.isArray(grounding.generic)) {
        throw new Error("provider brave returned an invalid grounding.generic");
    }
    const sourcesRaw = root.sources === undefined ? {} : object(root.sources, "sources");
    const documents: SearchDocument[] = [];
    for (const raw of grounding.generic) {
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
        const item = raw as Record<string, unknown>;
        if (typeof item.url !== "string" || typeof item.title !== "string" || !Array.isArray(item.snippets)) continue;
        // Reject controls on the raw provider strings before trim can strip boundary controls.
        if (containsAnyControls(item.url) || containsAnyControls(item.title)) continue;
        const url = item.url.trim();
        const title = item.title.trim();
        if (!isSafeHttpUrl(url) || title === "") continue;
        const snippets: string[] = [];
        let snippetsSafe = true;
        for (const snippet of item.snippets) {
            if (typeof snippet !== "string") {
                snippetsSafe = false;
                break;
            }
            if (containsAnyControls(snippet)) {
                snippetsSafe = false;
                break;
            }
            const trimmed = snippet.trim();
            if (trimmed !== "") snippets.push(trimmed);
        }
        if (!snippetsSafe || snippets.length === 0) continue;
        const document: SearchDocument = { url, title, snippets };
        const source = sourcesRaw[document.url];
        if (source !== null && typeof source === "object" && !Array.isArray(source)) {
            const age = (source as Record<string, unknown>).age;
            if (Array.isArray(age) && typeof age[3] === "string" && isValidIso8601Timestamp(age[3])) {
                document.publishedAt = age[3];
            }
        }
        documents.push(document);
    }
    return {
        query: request.query,
        providerId,
        documents,
    };
}

function headerValue(headers: Headers, name: string): string | undefined {
    const value = headers.get(name);
    return value === null || value.trim() === "" ? undefined : value.trim();
}

export function parseRetryWaitMs(headers: Headers, nowMs = Date.now()): number {
    const retryAfter = headerValue(headers, "Retry-After");
    if (retryAfter !== undefined) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
        const retryAt = Date.parse(retryAfter);
        if (Number.isFinite(retryAt)) return Math.max(0, retryAt - nowMs);
    }
    const reset = headerValue(headers, "X-RateLimit-Reset");
    if (reset !== undefined) {
        const first = reset.split(",")[0]?.trim();
        const seconds = Number(first);
        if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    }
    return WEB_SEARCH_DEFAULT_RETRY_WAIT_MS;
}

function statusError(providerId: string, status: number, waitMs?: number): Error {
    if (waitMs === undefined) return new Error(`provider ${providerId} request failed with status ${status}`);
    return new Error(`provider ${providerId} request failed with status ${status} (retry after ${waitMs}ms)`);
}

async function sleepWithSignal(ms: number, signal: AbortSignal | undefined, sleep: Sleep): Promise<void> {
    if (ms <= 0) return;
    await sleep(ms, signal);
}

function combineSignals(signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();
    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort(signal.reason);
            return controller.signal;
        }
        signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
}

export function createBraveLlmContextProvider(
    config: BraveLlmContextProviderConfig,
    deps: BraveLlmContextDependencies,
): SearchProvider {
    return {
        id: config.id,
        async search(request, callerSignal) {
            if (config.apiKeyFile === null) {
                throw new Error(`provider ${config.id} is unavailable`);
            }
            let apiKey: string;
            try {
                apiKey = (await deps.readTextFile(config.apiKeyFile)).trim();
            } catch {
                throw new Error(`provider ${config.id} could not read its API key`);
            }
            if (apiKey === "") {
                throw new Error(`provider ${config.id} API key is empty`);
            }

            const deadline = deps.now() + WEB_SEARCH_REQUEST_TIMEOUT_MS;
            const body = JSON.stringify(buildBraveLlmContextBody(request));
            let attempt = 0;
            while (true) {
                attempt += 1;
                const remaining = deadline - deps.now();
                if (remaining <= 0) throw new Error(`provider ${config.id} request timed out`);
                const timeout = AbortSignal.timeout(remaining);
                const signal = callerSignal === undefined ? timeout : combineSignals([callerSignal, timeout]);
                let response: Response;
                try {
                    response = await deps.fetch(config.endpoint, {
                        method: "POST",
                        headers: {
                            Accept: "application/json",
                            "Accept-Encoding": "gzip",
                            "Content-Type": "application/json",
                            "X-Subscription-Token": apiKey,
                        },
                        body,
                        signal,
                    });
                } catch (error) {
                    if (callerSignal?.aborted) throw new Error(`provider ${config.id} request aborted`);
                    if (deps.now() >= deadline || (error instanceof Error && error.name === "TimeoutError")) {
                        throw new Error(`provider ${config.id} request timed out`);
                    }
                    if (error instanceof Error && error.name === "AbortError") {
                        throw new Error(`provider ${config.id} request aborted`);
                    }
                    throw new Error(`provider ${config.id} request failed`);
                }

                if (response.ok) {
                    let payload: unknown;
                    try {
                        payload = await response.json();
                    } catch (error) {
                        if (callerSignal?.aborted) throw new Error(`provider ${config.id} request aborted`);
                        if (deps.now() >= deadline || (error instanceof Error && error.name === "TimeoutError")) {
                            throw new Error(`provider ${config.id} request timed out`);
                        }
                        if (error instanceof Error && error.name === "AbortError") {
                            throw new Error(`provider ${config.id} request aborted`);
                        }
                        throw new Error(`provider ${config.id} returned an invalid response`);
                    }
                    return normalizeBraveLlmContextResponse(payload, request, config.id);
                }

                const waitMs = parseRetryWaitMs(response.headers, deps.now());
                const retryable = RETRYABLE_STATUSES.has(response.status);
                if (!retryable || attempt > 1) {
                    throw statusError(config.id, response.status, retryable ? waitMs : undefined);
                }
                const remainingAfterWait = deadline - deps.now();
                if (waitMs > remainingAfterWait) {
                    throw new Error(`provider ${config.id} request timed out`);
                }
                try {
                    await sleepWithSignal(waitMs, callerSignal, deps.sleep);
                } catch {
                    throw new Error(`provider ${config.id} request aborted`);
                }
            }
        },
    };
}

export async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason ?? new Error("aborted");
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason ?? new Error("aborted"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
