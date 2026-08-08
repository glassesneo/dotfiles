import {
    containsUnsafeControls,
    isSafeHttpUrl,
    ProviderError,
    type AdapterFetchResponse,
    type FetchAdapter,
    type FetchItem,
    type FetchProviderId,
    type NormalizedFetchRequest,
} from "./web_retrieval_types.ts";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface FetchAdapterDependencies {
    fetch: FetchLike;
    now: () => number;
}

export interface FetchAdapterConfig {
    endpoint: string;
    apiKey: string;
}

function object(value: unknown, provider: FetchProviderId): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new ProviderError({ provider, category: "invalid-response", retryable: false });
    }
    return value as Record<string, unknown>;
}

function optionalSafeText(value: unknown): string | undefined {
    if (typeof value !== "string" || containsUnsafeControls(value)) return undefined;
    const normalized = normalizeLineEndings(value).trim();
    return normalized === "" ? undefined : normalized;
}

function optionalStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const values = value.flatMap(item => {
        const normalized = optionalSafeText(item);
        return normalized === undefined ? [] : [normalized];
    });
    return values.length === 0 ? undefined : values;
}

function optionalStatus(value: unknown): number | undefined {
    return Number.isInteger(value) && (value as number) >= 100 && (value as number) <= 599
        ? value as number
        : undefined;
}

function itemError(value: unknown): FetchItem["error"] | undefined {
    if (value === undefined || value === null) return undefined;
    const raw = typeof value === "string" ? { message: value } : value;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        return { category: "provider", message: "Provider reported a URL failure" };
    }
    const record = raw as Record<string, unknown>;
    const status = optionalStatus(record.status ?? record.statusCode);
    return {
        category: status === 404 ? "not-found" : status === undefined ? "provider" : "http",
        ...(status === undefined ? {} : { status }),
        message: status === 404 ? "Provider reported URL not found" : "Provider reported a URL failure",
    };
}

function allowlistedMetadata(raw: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> | undefined {
    const metadata: Record<string, unknown> = {};
    for (const field of fields) {
        const value = raw[field];
        if (typeof value === "number" || typeof value === "boolean") metadata[field] = value;
        else {
            const text = optionalSafeText(value);
            if (text !== undefined) metadata[field] = text;
        }
    }
    return Object.keys(metadata).length === 0 ? undefined : metadata;
}

function responseMetadata(root: Record<string, unknown>): Pick<AdapterFetchResponse, "providerRequestId" | "providerSessionId" | "warnings" | "usage"> {
    const providerRequestId = optionalSafeText(root.request_id ?? root.requestId ?? root.extract_id ?? root.extractId);
    const providerSessionId = optionalSafeText(root.session_id ?? root.sessionId);
    return {
        ...(providerRequestId === undefined ? {} : { providerRequestId }),
        ...(providerSessionId === undefined ? {} : { providerSessionId }),
        ...(Array.isArray(root.warnings) ? { warnings: root.warnings } : {}),
        ...(Array.isArray(root.usage) ? { usage: root.usage } : root.usage === undefined ? {} : { usage: [root.usage] }),
    };
}

function projectByInput(
    request: NormalizedFetchRequest,
    provider: FetchProviderId,
    normalized: ReadonlyMap<string, Omit<FetchItem, "inputIndex" | "url" | "source">>,
): FetchItem[] {
    return request.urls.map((url, inputIndex) => {
        const item = normalized.get(url);
        if (item === undefined) {
            return {
                inputIndex,
                url,
                source: { provider },
                error: { category: "not-found", message: "Provider returned no result for this URL" },
            };
        }
        return { inputIndex, url, source: { provider }, ...item };
    });
}

function responseResults(root: Record<string, unknown>, provider: FetchProviderId): unknown[] {
    if (!Array.isArray(root.results)) {
        throw new ProviderError({ provider, category: "invalid-response", retryable: false });
    }
    return root.results;
}

function addReportedErrors(
    root: Record<string, unknown>,
    normalized: Map<string, Omit<FetchItem, "inputIndex" | "url" | "source">>,
): void {
    if (!Array.isArray(root.errors)) return;
    for (const value of root.errors) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
        const raw = value as Record<string, unknown>;
        if (typeof raw.url !== "string" || !isSafeHttpUrl(raw.url)) continue;
        normalized.set(raw.url, { error: itemError(raw.error ?? raw) ?? { category: "provider", message: "Provider reported a URL failure" } });
    }
}

export function buildParallelExtractBody(request: NormalizedFetchRequest): Record<string, unknown> {
    return {
        urls: request.urls,
        ...(request.objective === undefined ? {} : { objective: request.objective }),
        max_chars_total: request.maxCharsTotal,
    };
}

export function normalizeParallelExtractResponse(payload: unknown, request: NormalizedFetchRequest): AdapterFetchResponse {
    const provider = "parallel-extract" as const;
    const root = object(payload, provider);
    const normalized = new Map<string, Omit<FetchItem, "inputIndex" | "url" | "source">>();
    for (const value of responseResults(root, provider)) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
        const raw = value as Record<string, unknown>;
        if (typeof raw.url !== "string" || !isSafeHttpUrl(raw.url)) continue;
        const error = itemError(raw.error);
        if (error !== undefined) {
            normalized.set(raw.url, { error });
            continue;
        }
        const excerpts = optionalStringArray(raw.excerpts);
        normalized.set(raw.url, {
            ...(optionalSafeText(raw.title) === undefined ? {} : { title: optionalSafeText(raw.title) }),
            ...(excerpts === undefined ? {} : { excerpts }),
            ...(allowlistedMetadata(raw, ["id", "result_id"]) === undefined ? {} : { providerMetadata: allowlistedMetadata(raw, ["id", "result_id"]) }),
        });
    }
    addReportedErrors(root, normalized);
    return { items: projectByInput(request, provider, normalized), ...responseMetadata(root) };
}

export function buildExaContentsBody(request: NormalizedFetchRequest): Record<string, unknown> {
    return { urls: request.urls, text: true };
}

export function normalizeExaContentsResponse(payload: unknown, request: NormalizedFetchRequest): AdapterFetchResponse {
    const provider = "exa-contents" as const;
    const root = object(payload, provider);
    const normalized = new Map<string, Omit<FetchItem, "inputIndex" | "url" | "source">>();
    for (const value of responseResults(root, provider)) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
        const raw = value as Record<string, unknown>;
        if (typeof raw.url !== "string" || !isSafeHttpUrl(raw.url)) continue;
        const error = itemError(raw.error);
        if (error !== undefined) {
            normalized.set(raw.url, { error });
            continue;
        }
        const content = optionalSafeText(raw.text);
        normalized.set(raw.url, content === undefined
            ? { error: { category: "invalid-response", message: "Provider returned no text for this URL" } }
            : {
                content,
                ...(optionalSafeText(raw.title) === undefined ? {} : { title: optionalSafeText(raw.title) }),
                ...(allowlistedMetadata(raw, ["id", "author", "publishedDate", "image", "favicon"]) === undefined
                    ? {}
                    : { providerMetadata: allowlistedMetadata(raw, ["id", "author", "publishedDate", "image", "favicon"]) }),
            });
    }
    addReportedErrors(root, normalized);
    return {
        items: projectByInput(request, provider, normalized),
        ...responseMetadata(root),
        ...(request.objective === undefined ? {} : { unsupportedHints: ["objective"] }),
    };
}

export class FetchHttpError extends ProviderError {
    readonly retryWaitMs: number;

    constructor(provider: FetchProviderId, status: number, retryWaitMs: number) {
        super({
            provider,
            category: status === 401 || status === 403 ? "credential" : status === 429 ? "rate-limit" : "http",
            retryable: status === 429 || status === 502 || status === 503 || status === 504,
            status,
        });
        this.retryWaitMs = retryWaitMs;
    }
}

export function parseFetchRetryWaitMs(headers: Headers, defaultWaitMs: number, nowMs = Date.now()): number {
    const retryAfter = headers.get("Retry-After")?.trim();
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
        const retryAt = Date.parse(retryAfter);
        if (Number.isFinite(retryAt)) return Math.max(0, retryAt - nowMs);
    }
    const reset = headers.get("X-RateLimit-Reset")?.split(",")[0]?.trim();
    if (reset) {
        const seconds = Number(reset);
        if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
    }
    return defaultWaitMs;
}

function createAdapter(
    provider: FetchProviderId,
    modes: FetchAdapter["modes"],
    config: FetchAdapterConfig,
    deps: FetchAdapterDependencies,
    body: (request: NormalizedFetchRequest) => Record<string, unknown>,
    normalize: (payload: unknown, request: NormalizedFetchRequest) => AdapterFetchResponse,
): FetchAdapter {
    return {
        id: provider,
        modes,
        async fetch(request, signal) {
            let response: Response;
            try {
                response = await deps.fetch(config.endpoint, {
                    method: "POST",
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                        "x-api-key": config.apiKey,
                    },
                    body: JSON.stringify(body(request)),
                    signal,
                });
            } catch (error) {
                if (signal.aborted || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))) throw error;
                throw new ProviderError({ provider, category: "network", retryable: false });
            }
            if (!response.ok) throw new FetchHttpError(provider, response.status, parseFetchRetryWaitMs(response.headers, -1, deps.now()));
            let payload: unknown;
            try {
                payload = await response.json();
            } catch (error) {
                if (signal.aborted || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))) throw error;
                throw new ProviderError({ provider, category: "invalid-response", retryable: false });
            }
            return normalize(payload, request);
        },
    };
}

export function createParallelExtractAdapter(config: FetchAdapterConfig, deps: FetchAdapterDependencies): FetchAdapter {
    return createAdapter("parallel-extract", ["relevant"], config, deps, buildParallelExtractBody, normalizeParallelExtractResponse);
}

export function createExaContentsAdapter(config: FetchAdapterConfig, deps: FetchAdapterDependencies): FetchAdapter {
    return createAdapter("exa-contents", ["full"], config, deps, buildExaContentsBody, normalizeExaContentsResponse);
}

export function normalizeLineEndings(value: string): string {
    return value.replace(/\r\n?/gu, "\n");
}
