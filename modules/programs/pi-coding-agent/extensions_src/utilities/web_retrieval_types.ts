export const WEB_RETRIEVAL_CONFIG_SCHEMA_VERSION = 2 as const;
export const WEB_SEARCH_DETAILS_SCHEMA_VERSION = 2 as const;
export const WEB_FETCH_DETAILS_SCHEMA_VERSION = 1 as const;
export const WEB_SEARCH_QUERY_MAX_CHARS = 400;
export const WEB_SEARCH_QUERY_MAX_WORDS = 50;
export const WEB_RETRIEVAL_OBJECTIVE_MAX_CHARS = 2_000;
export const WEB_SEARCH_DEFAULT_MAX_RESULTS = 10;
export const WEB_FETCH_DEFAULT_MAX_CHARS_TOTAL = 24_000;
export const WEB_SEARCH_DEADLINE_MS = 30_000;
export const WEB_FETCH_DEADLINE_MS = 60_000;
export const WEB_RETRIEVAL_DEFAULT_RETRY_WAIT_MS = 1_000;

export type SearchProviderId =
    | "parallel-search"
    | "brave-llm-context"
    | "brave-web-search"
    | "exa-search";
export type FetchProviderId = "parallel-extract" | "exa-contents";
export type WebRetrievalProviderId = SearchProviderId | FetchProviderId;
export type ProviderFamily = "parallel" | "brave" | "exa";
export type SearchIntent = "auto" | "general" | "discovery";
export type SearchLane = "general" | "discovery";
export type SearchFreshness = "day" | "week" | "month" | "year";
export type FetchMode = "relevant" | "full";
export type ProviderErrorCategory =
    | "credential"
    | "network"
    | "timeout"
    | "rate-limit"
    | "http"
    | "invalid-response"
    | "unavailable";

export interface WebSearchInput {
    query: string;
    objective?: string;
    intent?: SearchIntent;
    freshness?: SearchFreshness;
    includeDomains?: string[];
    excludeDomains?: string[];
    maxResults?: number;
}

export interface NormalizedSearchRequest extends WebSearchInput {
    intent: SearchIntent;
    maxResults: number;
}

export interface WebFetchInput {
    urls: string[];
    objective?: string;
    mode?: FetchMode;
    maxCharsTotal?: number;
}

export interface NormalizedFetchRequest extends WebFetchInput {
    mode: FetchMode;
    maxCharsTotal: number;
}

export interface SearchResult {
    url: string;
    title?: string;
    excerpts?: string[];
    summary?: string;
    publishedAt?: string;
    source: {
        provider: SearchProviderId;
        rank: number;
        resultId?: string;
    };
    providerMetadata?: Record<string, unknown>;
}

export interface NormalizationWarning {
    provider: SearchProviderId;
    resultIndex?: number;
    field?: string;
    reason: string;
}

export interface AdapterSearchResponse {
    results: SearchResult[];
    providerRequestId?: string;
    providerSessionId?: string;
    warnings?: unknown[];
    usage?: unknown[];
    unsupportedHints?: string[];
    normalizationWarnings: NormalizationWarning[];
    providerResultCount: number;
}

export interface FetchItem {
    inputIndex: number;
    url: string;
    title?: string;
    excerpts?: string[];
    content?: string;
    source: { provider: FetchProviderId };
    providerMetadata?: Record<string, unknown>;
    truncated?: boolean;
    error?: {
        category: "provider" | "not-found" | "http" | "invalid-response";
        status?: number;
        message: string;
    };
}

export interface AdapterFetchResponse {
    items: FetchItem[];
    providerRequestId?: string;
    providerSessionId?: string;
    warnings?: unknown[];
    usage?: unknown[];
    unsupportedHints?: string[];
}

export interface SearchAdapter {
    readonly id: SearchProviderId;
    readonly family: ProviderFamily;
    readonly capabilities: {
        lanes: readonly SearchLane[];
        freshness: boolean;
        domains: boolean;
        objective: boolean;
    };
    search(request: NormalizedSearchRequest, signal: AbortSignal): Promise<AdapterSearchResponse>;
}

export interface FetchAdapter {
    readonly id: FetchProviderId;
    readonly modes: readonly FetchMode[];
    fetch(request: NormalizedFetchRequest, signal: AbortSignal): Promise<AdapterFetchResponse>;
}

export interface ProviderErrorDetails {
    provider: WebRetrievalProviderId;
    category: ProviderErrorCategory;
    retryable: boolean;
    status?: number;
}

/** A bounded provider failure safe to place in diagnostics; it never accepts raw response data. */
export class ProviderError extends Error implements ProviderErrorDetails {
    readonly provider: WebRetrievalProviderId;
    readonly category: ProviderErrorCategory;
    readonly retryable: boolean;
    readonly status?: number;

    constructor(details: ProviderErrorDetails) {
        super(`provider ${details.provider} failed (${details.category})`);
        this.name = "ProviderError";
        this.provider = details.provider;
        this.category = details.category;
        this.retryable = details.retryable;
        this.status = details.status;
    }
}

export interface SearchAttempt {
    provider: SearchProviderId;
    latencyMs: number;
    retryCount: 0 | 1;
    outcome: "success" | "error";
    error?: Omit<ProviderErrorDetails, "provider">;
}

export interface SearchEligibilityDiagnostic {
    provider: SearchProviderId;
    category: "credential" | "capability";
    reason: "not-configured" | "unreadable" | "empty" | "lane" | "freshness" | "domains";
}

export interface PrivateTruncationDetails {
    truncated: boolean;
    truncatedBy: "lines" | "bytes" | null;
    totalLines: number;
    totalBytes: number;
    outputLines: number;
    outputBytes: number;
    fullOutputPath?: string;
}

export interface WebSearchDetails {
    schemaVersion: 2;
    request: NormalizedSearchRequest;
    response: {
        requestId: string;
        lane: SearchLane;
        initialProvider: SearchProviderId;
        provider: SearchProviderId;
        results: SearchResult[];
        fallback: boolean;
        attempts: SearchAttempt[];
        eligibilityDiagnostics: SearchEligibilityDiagnostic[];
        providerRequestId?: string;
        providerSessionId?: string;
        warnings?: unknown[];
        usage?: unknown[];
        unsupportedHints?: string[];
        normalizationWarnings: NormalizationWarning[];
        providerResultCount: number;
        returnedResultCount: number;
    };
    truncation?: PrivateTruncationDetails;
}

export interface WebFetchDetails {
    schemaVersion: 1;
    request: NormalizedFetchRequest;
    response: {
        requestId: string;
        provider: FetchProviderId;
        providerRequestId?: string;
        providerSessionId?: string;
        latencyMs: number;
        retryCount: 0 | 1;
        items: FetchItem[];
        warnings?: unknown[];
        usage?: unknown[];
        unsupportedHints?: string[];
    };
    truncation?: PrivateTruncationDetails;
}

interface ProviderConfigBase {
    endpoint: string;
    apiKeyFile: string | null;
}

export type WebRetrievalProviderConfig = {
    [Id in WebRetrievalProviderId]: ProviderConfigBase & { id: Id; kind: Id };
}[WebRetrievalProviderId];

export interface WebRetrievalRuntimeConfig {
    schemaVersion: 2;
    providers: WebRetrievalProviderConfig[];
    routing: {
        generalFamilies: { parallel: number; brave: number };
        braveProviders: { "brave-llm-context": number; "brave-web-search": number };
    };
    deadlinesMs: { search: number; fetch: number };
    retry: { maxRetries: 1; defaultWaitMs: number };
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
    const unknown = Object.keys(value).filter(key => !allowed.includes(key));
    if (unknown.length > 0) throw new Error(`${label} contains unknown keys: ${unknown.join(", ")}`);
}

function nonBlank(value: unknown, label: string): string {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
    return value.trim();
}

function optionalObjective(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new Error("objective must be a string");
    if (containsUnsafeControls(value)) throw new Error("objective must not contain control characters");
    const objective = value.trim();
    if (objective.length < 1 || objective.length > WEB_RETRIEVAL_OBJECTIVE_MAX_CHARS) {
        throw new Error(`objective must be 1..${WEB_RETRIEVAL_OBJECTIVE_MAX_CHARS} characters after trim`);
    }
    return objective;
}

function integerInRange(value: unknown, minimum: number, maximum: number, label: string): number {
    if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
    }
    return value as number;
}

function positiveInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} must be a positive integer`);
    return value as number;
}

export function containsUnsafeControls(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) return true;
    }
    return false;
}

export function containsAnyControls(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x061c || (code >= 0x200e && code <= 0x200f) || (code >= 0x2028 && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true;
    }
    return false;
}

export function isSafeHttpUrl(value: string): boolean {
    if (value !== value.trim() || containsAnyControls(value)) return false;
    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:")
            && url.hostname !== ""
            && url.username === ""
            && url.password === "";
    } catch {
        return false;
    }
}

export function normalizeDomain(value: unknown, label = "domain"): string {
    if (typeof value !== "string" || value === "" || value !== value.trim() || containsAnyControls(value)) {
        throw new Error(`${label} must be a bare hostname`);
    }
    if (/[/:?#@\\]/u.test(value)) throw new Error(`${label} must be a bare hostname`);
    try {
        const url = new URL(`http://${value}`);
        if (url.hostname === "" || url.port !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
            throw new Error();
        }
        return url.hostname.toLowerCase();
    } catch {
        throw new Error(`${label} must be a bare hostname`);
    }
}

function normalizeDomains(value: unknown, label: string): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new Error(`${label} must contain 1..20 domains`);
    const normalized = value.map((domain, index) => normalizeDomain(domain, `${label}[${index}]`));
    if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicate domains`);
    return normalized;
}

export function normalizeSearchQuery(value: unknown): string {
    if (typeof value !== "string") throw new Error("query must be a string");
    if (containsUnsafeControls(value)) throw new Error("query must not contain control characters");
    const query = value.trim().replace(/\s+/gu, " ");
    if (query.length < 1 || query.length > WEB_SEARCH_QUERY_MAX_CHARS) throw new Error(`query must be 1..${WEB_SEARCH_QUERY_MAX_CHARS} characters after trim`);
    if (query.split(" ").length > WEB_SEARCH_QUERY_MAX_WORDS) throw new Error(`query must contain at most ${WEB_SEARCH_QUERY_MAX_WORDS} words`);
    return query;
}

export function parseWebSearchInput(value: unknown): NormalizedSearchRequest {
    const input = object(value, "web_search input");
    exactKeys(input, ["query", "objective", "intent", "freshness", "includeDomains", "excludeDomains", "maxResults"], "web_search input");
    const intent = input.intent ?? "auto";
    if (intent !== "auto" && intent !== "general" && intent !== "discovery") throw new Error("intent must be auto, general, or discovery");
    const freshness = input.freshness;
    if (freshness !== undefined && freshness !== "day" && freshness !== "week" && freshness !== "month" && freshness !== "year") throw new Error("freshness must be day, week, month, or year");
    const includeDomains = normalizeDomains(input.includeDomains, "includeDomains");
    const excludeDomains = normalizeDomains(input.excludeDomains, "excludeDomains");
    const overlap = includeDomains?.find(domain => excludeDomains?.includes(domain));
    if (overlap !== undefined) throw new Error("includeDomains and excludeDomains must not overlap");
    const objective = optionalObjective(input.objective);
    return {
        query: normalizeSearchQuery(input.query),
        ...(objective === undefined ? {} : { objective }),
        intent,
        ...(freshness === undefined ? {} : { freshness }),
        ...(includeDomains === undefined ? {} : { includeDomains }),
        ...(excludeDomains === undefined ? {} : { excludeDomains }),
        maxResults: input.maxResults === undefined ? WEB_SEARCH_DEFAULT_MAX_RESULTS : integerInRange(input.maxResults, 1, 20, "maxResults"),
    };
}

export function parseWebFetchInput(value: unknown): NormalizedFetchRequest {
    const input = object(value, "web_fetch input");
    exactKeys(input, ["urls", "objective", "mode", "maxCharsTotal"], "web_fetch input");
    if (!Array.isArray(input.urls) || input.urls.length < 1 || input.urls.length > 20) throw new Error("urls must contain 1..20 URLs");
    const urls = input.urls.map((url, index) => {
        if (typeof url !== "string" || !isSafeHttpUrl(url)) throw new Error(`urls[${index}] must be a safe HTTP(S) URL`);
        return url;
    });
    const mode = input.mode ?? "relevant";
    if (mode !== "relevant" && mode !== "full") throw new Error("mode must be relevant or full");
    const objective = optionalObjective(input.objective);
    return {
        urls,
        ...(objective === undefined ? {} : { objective }),
        mode,
        maxCharsTotal: input.maxCharsTotal === undefined
            ? WEB_FETCH_DEFAULT_MAX_CHARS_TOTAL
            : integerInRange(input.maxCharsTotal, 1_000, 200_000, "maxCharsTotal"),
    };
}

function daysInGregorianMonth(year: number, month: number): number {
    if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
    return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

export function isValidIso8601Timestamp(value: string): boolean {
    if (containsAnyControls(value)) return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
    if (!match) return false;
    const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
    return month >= 1 && month <= 12 && day >= 1 && day <= daysInGregorianMonth(year, month) && hour <= 23 && minute <= 59 && second <= 59 && !Number.isNaN(Date.parse(value));
}

const PROVIDER_IDS: readonly WebRetrievalProviderId[] = [
    "parallel-search", "brave-llm-context", "brave-web-search", "exa-search", "parallel-extract", "exa-contents",
];

function providerId(value: unknown, label: string): WebRetrievalProviderId {
    const id = nonBlank(value, label);
    if (!PROVIDER_IDS.includes(id as WebRetrievalProviderId)) throw new Error(`${label} is not a supported provider ID`);
    return id as WebRetrievalProviderId;
}

export function validateWebRetrievalRuntimeConfig(value: unknown): WebRetrievalRuntimeConfig {
    const root = object(value, "web-retrieval config");
    exactKeys(root, ["schemaVersion", "providers", "routing", "deadlinesMs", "retry"], "web-retrieval config");
    if (root.schemaVersion !== WEB_RETRIEVAL_CONFIG_SCHEMA_VERSION) throw new Error("Unsupported web-retrieval config schemaVersion");
    if (!Array.isArray(root.providers)) throw new Error("web-retrieval config providers must be an array");
    const providers = root.providers.map((raw, index): WebRetrievalProviderConfig => {
        const label = `providers[${index}]`;
        const item = object(raw, label);
        exactKeys(item, ["id", "kind", "endpoint", "apiKeyFile"], label);
        const id = providerId(item.id, `${label}.id`);
        if (item.kind !== id) throw new Error(`${label}.kind must match its provider ID`);
        const endpoint = nonBlank(item.endpoint, `${label}.endpoint`);
        if (!isSafeHttpUrl(endpoint)) throw new Error(`${label}.endpoint must be a safe HTTP(S) URL`);
        const apiKeyFile = item.apiKeyFile === null ? null : nonBlank(item.apiKeyFile, `${label}.apiKeyFile`);
        return { id, kind: id, endpoint, apiKeyFile } as WebRetrievalProviderConfig;
    });
    const ids = providers.map(provider => provider.id);
    if (new Set(ids).size !== ids.length) throw new Error("web-retrieval config provider IDs must be unique");
    if (PROVIDER_IDS.some(id => !ids.includes(id))) throw new Error("web-retrieval config must define all supported provider IDs");

    const routing = object(root.routing, "routing");
    exactKeys(routing, ["generalFamilies", "braveProviders"], "routing");
    const families = object(routing.generalFamilies, "routing.generalFamilies");
    exactKeys(families, ["parallel", "brave"], "routing.generalFamilies");
    const brave = object(routing.braveProviders, "routing.braveProviders");
    exactKeys(brave, ["brave-llm-context", "brave-web-search"], "routing.braveProviders");

    const deadlines = object(root.deadlinesMs, "deadlinesMs");
    exactKeys(deadlines, ["search", "fetch"], "deadlinesMs");
    const retry = object(root.retry, "retry");
    exactKeys(retry, ["maxRetries", "defaultWaitMs"], "retry");
    if (retry.maxRetries !== 1) throw new Error("retry.maxRetries must be 1");

    return {
        schemaVersion: 2,
        providers,
        routing: {
            generalFamilies: { parallel: positiveInteger(families.parallel, "routing.generalFamilies.parallel"), brave: positiveInteger(families.brave, "routing.generalFamilies.brave") },
            braveProviders: {
                "brave-llm-context": positiveInteger(brave["brave-llm-context"], "routing.braveProviders.brave-llm-context"),
                "brave-web-search": positiveInteger(brave["brave-web-search"], "routing.braveProviders.brave-web-search"),
            },
        },
        deadlinesMs: {
            search: integerInRange(deadlines.search, 1_000, 120_000, "deadlinesMs.search"),
            fetch: integerInRange(deadlines.fetch, 1_000, 300_000, "deadlinesMs.fetch"),
        },
        retry: { maxRetries: 1, defaultWaitMs: integerInRange(retry.defaultWaitMs, 0, 30_000, "retry.defaultWaitMs") },
    };
}
