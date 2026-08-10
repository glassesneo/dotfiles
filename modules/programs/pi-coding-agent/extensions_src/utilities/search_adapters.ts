import { parseRetryWaitMs } from "./web_retrieval_runtime.ts";
import {
    ProviderError,
    containsAnyControls,
    isSafeHttpUrl,
    isValidIso8601Timestamp,
    normalizeSearchQuery,
    type AdapterSearchResponse,
    type NormalizationWarning,
    type NormalizedSearchRequest,
    type SearchAdapter,
    type SearchFreshness,
    type SearchProviderId,
    type SearchResult,
    type WebRetrievalProviderConfig,
} from "./web_retrieval_types.ts";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface SearchAdapterDependencies {
    fetch: FetchLike;
    now: () => number;
}

export class SearchRequestError extends ProviderError {
    readonly retryAfterMs?: number;

    constructor(
        provider: SearchProviderId,
        category: "credential" | "rate-limit" | "http",
        status: number,
        retryable: boolean,
        retryAfterMs?: number,
    ) {
        super({ provider, category, status, retryable });
        this.retryAfterMs = retryAfterMs;
    }
}

export class SearchMappingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SearchMappingError";
    }
}

const FRESHNESS_TO_BRAVE: Record<SearchFreshness, string> = {
    day: "pd",
    week: "pw",
    month: "pm",
    year: "py",
};

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function requiredRecord(value: unknown, provider: SearchProviderId): Record<string, unknown> {
    const result = record(value);
    if (result === undefined) throw new ProviderError({ provider, category: "invalid-response", retryable: false });
    return result;
}

function requiredArray(value: unknown, provider: SearchProviderId): unknown[] {
    if (!Array.isArray(value)) throw new ProviderError({ provider, category: "invalid-response", retryable: false });
    return value;
}

function safeText(
    value: unknown,
    provider: SearchProviderId,
    resultIndex: number,
    field: string,
    warnings: NormalizationWarning[],
): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") {
        warnings.push({ provider, resultIndex, field, reason: "expected text" });
        return undefined;
    }
    if (containsAnyControls(value)) {
        warnings.push({ provider, resultIndex, field, reason: "unsafe control characters" });
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
}

function safeTextArray(
    value: unknown,
    provider: SearchProviderId,
    resultIndex: number,
    field: string,
    warnings: NormalizationWarning[],
): string[] | undefined {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value)) {
        warnings.push({ provider, resultIndex, field, reason: "expected text array" });
        return undefined;
    }
    const texts = value.flatMap((item, index) => {
        const text = safeText(item, provider, resultIndex, `${field}[${index}]`, warnings);
        return text === undefined ? [] : [text];
    });
    return texts.length === 0 ? undefined : texts;
}

function safeDate(
    value: unknown,
    provider: SearchProviderId,
    resultIndex: number,
    field: string,
    warnings: NormalizationWarning[],
    metadata: Record<string, unknown>,
): string | undefined {
    const text = safeText(value, provider, resultIndex, field, warnings);
    if (text === undefined) return undefined;
    if (isValidIso8601Timestamp(text)) return text;
    metadata[field] = text;
    warnings.push({ provider, resultIndex, field, reason: "invalid ISO 8601 timestamp" });
    return undefined;
}

function nativeScalar(metadata: Record<string, unknown>, key: string, value: unknown): void {
    if (typeof value === "number" && Number.isFinite(value)) metadata[key] = value;
    else if (typeof value === "boolean") metadata[key] = value;
    else if (typeof value === "string" && !containsAnyControls(value)) metadata[key] = value;
}

function nativeNumberArray(metadata: Record<string, unknown>, key: string, value: unknown): void {
    if (Array.isArray(value) && value.every(item => typeof item === "number" && Number.isFinite(item))) {
        metadata[key] = value;
    }
}

function nativeStringArray(metadata: Record<string, unknown>, key: string, value: unknown): void {
    if (Array.isArray(value) && value.every(item => typeof item === "string" && !containsAnyControls(item))) {
        metadata[key] = value;
    }
}

function commonResult(
    item: Record<string, unknown>,
    provider: SearchProviderId,
    index: number,
    warnings: NormalizationWarning[],
    fields: { excerpts?: unknown; summary?: unknown; publishedAt?: unknown; publishedField?: string; resultId?: unknown },
    metadata: Record<string, unknown> = {},
): SearchResult | undefined {
    if (typeof item.url !== "string" || !isSafeHttpUrl(item.url)) {
        warnings.push({ provider, resultIndex: index, field: "url", reason: "unsafe or missing HTTP(S) URL" });
        return undefined;
    }
    const title = safeText(item.title, provider, index, "title", warnings);
    const excerpts = safeTextArray(fields.excerpts, provider, index, "excerpts", warnings);
    const summary = safeText(fields.summary, provider, index, "summary", warnings);
    const publishedAt = safeDate(
        fields.publishedAt,
        provider,
        index,
        fields.publishedField ?? "publishedAt",
        warnings,
        metadata,
    );
    const resultId = safeText(fields.resultId, provider, index, "id", warnings);
    return {
        url: item.url,
        ...(title === undefined ? {} : { title }),
        ...(excerpts === undefined ? {} : { excerpts }),
        ...(summary === undefined ? {} : { summary }),
        ...(publishedAt === undefined ? {} : { publishedAt }),
        source: { provider, rank: index + 1, ...(resultId === undefined ? {} : { resultId }) },
        ...(Object.keys(metadata).length === 0 ? {} : { providerMetadata: metadata }),
    };
}

function normalizeParallel(payload: unknown): AdapterSearchResponse {
    const provider = "parallel-search" as const;
    const root = requiredRecord(payload, provider);
    const rawResults = requiredArray(root.results, provider);
    const normalizationWarnings: NormalizationWarning[] = [];
    const results = rawResults.flatMap((raw, index) => {
        const item = record(raw);
        if (item === undefined) {
            normalizationWarnings.push({ provider, resultIndex: index, reason: "expected result object" });
            return [];
        }
        const metadata: Record<string, unknown> = {};
        const result = commonResult(item, provider, index, normalizationWarnings, {
            excerpts: item.excerpts,
            publishedAt: item.publish_date,
            publishedField: "publish_date",
        }, metadata);
        return result === undefined ? [] : [result];
    });
    return {
        results,
        ...(typeof root.search_id === "string" ? { providerRequestId: root.search_id } : {}),
        ...(typeof root.session_id === "string" ? { providerSessionId: root.session_id } : {}),
        ...(Array.isArray(root.warnings) ? { warnings: root.warnings } : {}),
        ...(Array.isArray(root.usage) ? { usage: root.usage } : {}),
        normalizationWarnings,
        providerResultCount: rawResults.length,
    };
}

function normalizeBraveLlm(payload: unknown, request: NormalizedSearchRequest): AdapterSearchResponse {
    const provider = "brave-llm-context" as const;
    const root = requiredRecord(payload, provider);
    const grounding = requiredRecord(root.grounding, provider);
    const rawResults = requiredArray(grounding.generic, provider);
    const sources = root.sources === undefined ? {} : requiredRecord(root.sources, provider);
    const normalizationWarnings: NormalizationWarning[] = [];
    const results = rawResults.flatMap((raw, index) => {
        const item = record(raw);
        if (item === undefined) {
            normalizationWarnings.push({ provider, resultIndex: index, reason: "expected result object" });
            return [];
        }
        const metadata: Record<string, unknown> = {};
        const source = typeof item.url === "string" ? record(sources[item.url]) : undefined;
        if (source !== undefined) {
            nativeScalar(metadata, "hostname", source.hostname);
            nativeStringArray(metadata, "age", source.age);
        }
        const age = source?.age;
        const publishedAt = Array.isArray(age) ? age[3] : undefined;
        const result = commonResult(item, provider, index, normalizationWarnings, {
            excerpts: item.snippets,
            publishedAt,
            publishedField: "age",
        }, metadata);
        return result === undefined ? [] : [result];
    });
    const unsupportedHints = [
        ...(request.objective === undefined ? [] : ["objective"]),
        ...(request.includeDomains === undefined && request.excludeDomains === undefined ? [] : ["domains"]),
    ];
    return {
        results,
        ...(unsupportedHints.length === 0 ? {} : { unsupportedHints }),
        normalizationWarnings,
        providerResultCount: rawResults.length,
    };
}

function normalizeBraveWeb(payload: unknown, request: NormalizedSearchRequest): AdapterSearchResponse {
    const provider = "brave-web-search" as const;
    const root = requiredRecord(payload, provider);
    const web = requiredRecord(root.web, provider);
    const rawResults = requiredArray(web.results, provider);
    const normalizationWarnings: NormalizationWarning[] = [];
    const results = rawResults.flatMap((raw, index) => {
        const item = record(raw);
        if (item === undefined) {
            normalizationWarnings.push({ provider, resultIndex: index, reason: "expected result object" });
            return [];
        }
        const metadata: Record<string, unknown> = {};
        nativeScalar(metadata, "age", item.age);
        const result = commonResult(item, provider, index, normalizationWarnings, {
            excerpts: item.description === undefined ? undefined : [item.description],
        }, metadata);
        return result === undefined ? [] : [result];
    });
    return {
        results,
        ...(request.objective === undefined ? {} : { unsupportedHints: ["objective"] }),
        normalizationWarnings,
        providerResultCount: rawResults.length,
    };
}

function normalizeExa(payload: unknown): AdapterSearchResponse {
    const provider = "exa-search" as const;
    const root = requiredRecord(payload, provider);
    const rawResults = requiredArray(root.results, provider);
    const normalizationWarnings: NormalizationWarning[] = [];
    const results = rawResults.flatMap((raw, index) => {
        const item = record(raw);
        if (item === undefined) {
            normalizationWarnings.push({ provider, resultIndex: index, reason: "expected result object" });
            return [];
        }
        const metadata: Record<string, unknown> = {};
        for (const key of ["author", "image", "favicon", "score"] as const) nativeScalar(metadata, key, item[key]);
        nativeNumberArray(metadata, "highlightScores", item.highlightScores);
        const result = commonResult(item, provider, index, normalizationWarnings, {
            excerpts: item.highlights,
            summary: item.summary,
            publishedAt: item.publishedDate,
            publishedField: "publishedDate",
            resultId: item.id,
        }, metadata);
        return result === undefined ? [] : [result];
    });
    return {
        results,
        ...(typeof root.requestId === "string" ? { providerRequestId: root.requestId } : {}),
        ...(root.cost === undefined ? {} : { usage: [root.cost] }),
        normalizationWarnings,
        providerResultCount: rawResults.length,
    };
}

async function sendJson(
    provider: SearchProviderId,
    endpoint: string,
    init: RequestInit,
    signal: AbortSignal,
    deps: SearchAdapterDependencies,
    defaultRetryWaitMs: number,
): Promise<unknown> {
    let response: Response;
    try {
        response = await deps.fetch(endpoint, { ...init, signal });
    } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        throw new ProviderError({ provider, category: "network", retryable: true });
    }
    if (!response.ok) {
        const credentialFailure = response.status === 401 || response.status === 403;
        const retryable = response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504;
        throw new SearchRequestError(
            provider,
            credentialFailure ? "credential" : response.status === 429 ? "rate-limit" : "http",
            response.status,
            retryable,
            retryable ? parseRetryWaitMs(response.headers, defaultRetryWaitMs, deps.now()) : undefined,
        );
    }
    try {
        return await response.json();
    } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        throw new ProviderError({ provider, category: "invalid-response", retryable: false });
    }
}

function exaStartDate(freshness: SearchFreshness, nowMs: number): string {
    const date = new Date(nowMs);
    if (freshness === "day") date.setUTCDate(date.getUTCDate() - 1);
    else if (freshness === "week") date.setUTCDate(date.getUTCDate() - 7);
    else if (freshness === "month") date.setUTCMonth(date.getUTCMonth() - 1);
    else date.setUTCFullYear(date.getUTCFullYear() - 1);
    return date.toISOString();
}

export function buildParallelSearchBody(request: NormalizedSearchRequest): Record<string, unknown> {
    return {
        mode: "turbo",
        search_queries: [request.query],
        ...(request.objective === undefined ? {} : { objective: request.objective }),
        max_chars_total: 20_000,
    };
}

export function buildBraveLlmContextBody(request: NormalizedSearchRequest): Record<string, unknown> {
    return {
        q: request.query,
        count: request.maxResults,
        maximum_number_of_urls: request.maxResults,
        maximum_number_of_tokens: 4_096,
        maximum_number_of_snippets: Math.min(3 * request.maxResults, 256),
        context_threshold_mode: "balanced",
        safesearch: "moderate",
        enable_source_metadata: true,
        ...(request.freshness === undefined ? {} : { freshness: FRESHNESS_TO_BRAVE[request.freshness] }),
    };
}

export function buildBraveWebSearchUrl(endpoint: string, request: NormalizedSearchRequest): string {
    const operators = [
        ...(request.includeDomains ?? []).map(domain => `site:${domain}`),
        ...(request.excludeDomains ?? []).map(domain => `-site:${domain}`),
    ];
    let query: string;
    try {
        query = normalizeSearchQuery([request.query, ...operators].join(" "));
    } catch {
        throw new SearchMappingError("query with domain operators exceeds Brave Web Search limits");
    }
    const url = new URL(endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(request.maxResults));
    if (request.freshness !== undefined) url.searchParams.set("freshness", FRESHNESS_TO_BRAVE[request.freshness]);
    return url.toString();
}

export function buildExaSearchBody(request: NormalizedSearchRequest, nowMs: number): Record<string, unknown> {
    return {
        query: request.objective === undefined
            ? request.query
            : `${request.query}\n\nSearch objective: ${request.objective}`,
        type: "auto",
        numResults: request.maxResults,
        contents: { highlights: true },
        ...(request.includeDomains === undefined ? {} : { includeDomains: request.includeDomains }),
        ...(request.excludeDomains === undefined ? {} : { excludeDomains: request.excludeDomains }),
        ...(request.freshness === undefined ? {} : { startPublishedDate: exaStartDate(request.freshness, nowMs) }),
    };
}

export function createSearchAdapter(
    config: WebRetrievalProviderConfig,
    apiKey: string,
    deps: SearchAdapterDependencies,
    defaultRetryWaitMs: number,
): SearchAdapter {
    const jsonHeaders = { Accept: "application/json", "Content-Type": "application/json" };
    if (config.id === "parallel-search") return {
        id: config.id,
        family: "parallel",
        capabilities: { lanes: ["general"], freshness: false, domains: false, objective: true },
        async search(request, signal) {
            const payload = await sendJson(config.id, config.endpoint, {
                method: "POST",
                headers: { ...jsonHeaders, "x-api-key": apiKey },
                body: JSON.stringify(buildParallelSearchBody(request)),
            }, signal, deps, defaultRetryWaitMs);
            return normalizeParallel(payload);
        },
    };
    if (config.id === "brave-llm-context") return {
        id: config.id,
        family: "brave",
        capabilities: { lanes: ["general"], freshness: true, domains: false, objective: false },
        async search(request, signal) {
            const payload = await sendJson(config.id, config.endpoint, {
                method: "POST",
                headers: { ...jsonHeaders, "X-Subscription-Token": apiKey },
                body: JSON.stringify(buildBraveLlmContextBody(request)),
            }, signal, deps, defaultRetryWaitMs);
            return normalizeBraveLlm(payload, request);
        },
    };
    if (config.id === "brave-web-search") return {
        id: config.id,
        family: "brave",
        capabilities: { lanes: ["general"], freshness: true, domains: true, objective: false },
        async search(request, signal) {
            const payload = await sendJson(config.id, buildBraveWebSearchUrl(config.endpoint, request), {
                method: "GET",
                headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
            }, signal, deps, defaultRetryWaitMs);
            return normalizeBraveWeb(payload, request);
        },
    };
    if (config.id === "exa-search") return {
        id: config.id,
        family: "exa",
        capabilities: { lanes: ["discovery"], freshness: true, domains: true, objective: true },
        async search(request, signal) {
            const payload = await sendJson(config.id, config.endpoint, {
                method: "POST",
                headers: { ...jsonHeaders, "x-api-key": apiKey },
                body: JSON.stringify(buildExaSearchBody(request, deps.now())),
            }, signal, deps, defaultRetryWaitMs);
            return normalizeExa(payload);
        },
    };
    throw new Error(`provider ${config.id} is not a search provider`);
}
