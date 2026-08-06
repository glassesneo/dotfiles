export const WEB_SEARCH_CONFIG_SCHEMA_VERSION = 1 as const;
export const WEB_SEARCH_RESULT_SCHEMA_VERSION = 1 as const;
export const WEB_SEARCH_QUERY_MAX_CHARS = 400;
export const WEB_SEARCH_QUERY_MAX_WORDS = 50;
export const WEB_SEARCH_REQUEST_TIMEOUT_MS = 30_000;
export const WEB_SEARCH_DEFAULT_RETRY_WAIT_MS = 1_000;
export const WEB_SEARCH_CONFIG_UNAVAILABLE = "web_search configuration is unavailable";

export type SearchBudget = "small" | "standard" | "large";
export type SearchFreshness = "day" | "week" | "month" | "year";

export interface SearchRequest {
    query: string;
    budget: SearchBudget;
    freshness?: SearchFreshness;
}

export interface SearchDocument {
    url: string;
    title: string;
    snippets: string[];
    publishedAt?: string;
}

export interface SearchResponse {
    query: string;
    providerId: string;
    documents: SearchDocument[];
}

export interface SearchProvider {
    readonly id: string;
    search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse>;
}

export interface BraveLlmContextProviderConfig {
    id: string;
    kind: "brave-llm-context";
    endpoint: string;
    apiKeyFile: string | null;
}

export type WebSearchProviderConfig = BraveLlmContextProviderConfig;

export interface WebSearchRuntimeConfig {
    schemaVersion: 1;
    providers: WebSearchProviderConfig[];
}

export interface WebSearchToolDetails {
    schemaVersion: 1;
    request: SearchRequest;
    response: SearchResponse;
    truncation?: {
        truncated: boolean;
        truncatedBy: "lines" | "bytes" | null;
        totalLines: number;
        totalBytes: number;
        outputLines: number;
        outputBytes: number;
        fullOutputPath?: string;
    };
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

function optionalStringOrNull(value: unknown, label: string): string | null {
    if (value === null) return null;
    return nonBlank(value, label);
}

function isSearchBudget(value: unknown): value is SearchBudget {
    return value === "small" || value === "standard" || value === "large";
}

function isSearchFreshness(value: unknown): value is SearchFreshness {
    return value === "day" || value === "week" || value === "month" || value === "year";
}

/** Shared UTF-16 code-unit length used by schema docs and runtime validation. */
export function queryCharacterCount(value: string): number {
    return value.length;
}

/** Reject C0/C1 controls except tab/LF/CR so formatted multiline text remains valid. */
export function containsUnsafeControls(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (
            code <= 0x08
            || code === 0x0b
            || code === 0x0c
            || (code >= 0x0e && code <= 0x1f)
            || (code >= 0x7f && code <= 0x9f)
        ) {
            return true;
        }
    }
    return false;
}

/** Reject controls and Unicode text-direction/line structure characters in citation fields. */
export function containsAnyControls(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (
            code <= 0x1f
            || (code >= 0x7f && code <= 0x9f)
            || code === 0x061c
            || (code >= 0x200e && code <= 0x200f)
            || (code >= 0x2028 && code <= 0x202e)
            || (code >= 0x2066 && code <= 0x2069)
        ) {
            return true;
        }
    }
    return false;
}

export function isSafeHttpUrl(value: string): boolean {
    if (containsAnyControls(value)) return false;
    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
    } catch {
        return false;
    }
}

export function validateWebSearchRuntimeConfig(value: unknown): WebSearchRuntimeConfig {
    const root = object(value, "web-search config");
    exactKeys(root, ["schemaVersion", "providers"], "web-search config");
    if (root.schemaVersion !== WEB_SEARCH_CONFIG_SCHEMA_VERSION) {
        throw new Error("Unsupported web-search config schemaVersion");
    }
    if (!Array.isArray(root.providers)) throw new Error("web-search config providers must be an array");
    const providers: WebSearchProviderConfig[] = root.providers.map((raw, index) => {
        const label = `providers[${index}]`;
        const provider = object(raw, label);
        exactKeys(provider, ["id", "kind", "endpoint", "apiKeyFile"], label);
        const id = nonBlank(provider.id, `${label}.id`);
        const kind = nonBlank(provider.kind, `${label}.kind`);
        if (kind !== "brave-llm-context") throw new Error(`${label}.kind must be brave-llm-context`);
        return {
            id,
            kind,
            endpoint: nonBlank(provider.endpoint, `${label}.endpoint`),
            apiKeyFile: optionalStringOrNull(provider.apiKeyFile, `${label}.apiKeyFile`),
        };
    });
    const ids = providers.map(provider => provider.id);
    if (new Set(ids).size !== ids.length) throw new Error("web-search config provider ids must be unique");
    return { schemaVersion: 1, providers };
}

export function normalizeSearchQuery(raw: unknown): string {
    if (typeof raw !== "string") throw new Error("query must be a string");
    const query = raw.trim().replace(/\s+/gu, " ");
    if (queryCharacterCount(query) < 1 || queryCharacterCount(query) > WEB_SEARCH_QUERY_MAX_CHARS) {
        throw new Error(`query must be 1..${WEB_SEARCH_QUERY_MAX_CHARS} characters after trim`);
    }
    if (containsUnsafeControls(query)) {
        throw new Error("query must not contain control characters");
    }
    const words = query.split(" ").filter(Boolean);
    if (words.length > WEB_SEARCH_QUERY_MAX_WORDS) {
        throw new Error(`query must contain at most ${WEB_SEARCH_QUERY_MAX_WORDS} words`);
    }
    return query;
}

export function parseSearchRequest(params: { query: unknown; budget?: unknown; freshness?: unknown }): SearchRequest {
    const query = normalizeSearchQuery(params.query);
    const budget = params.budget === undefined ? "standard" : params.budget;
    if (!isSearchBudget(budget)) throw new Error("budget must be small, standard, or large");
    if (params.freshness === undefined) return { query, budget };
    if (!isSearchFreshness(params.freshness)) throw new Error("freshness must be day, week, month, or year");
    return { query, budget, freshness: params.freshness };
}

export function requireSingleBraveProvider(config: WebSearchRuntimeConfig): BraveLlmContextProviderConfig {
    const enabled = config.providers.filter(provider => provider.kind === "brave-llm-context");
    if (enabled.length !== 1) {
        throw new Error("web_search requires exactly one configured brave provider");
    }
    return enabled[0]!;
}

function daysInGregorianMonth(year: number, month: number): number {
    if (month === 2) {
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        return leap ? 29 : 28;
    }
    return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

export function isValidIso8601Timestamp(value: string): boolean {
    if (containsAnyControls(value)) return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
    if (day > daysInGregorianMonth(year, month)) return false;
    return !Number.isNaN(Date.parse(value));
}

export function formatSearchResultText(response: SearchResponse): string {
    const lines = [
        `Query: ${response.query}`,
        `Documents: ${response.documents.length}`,
        "",
    ];
    if (response.documents.length === 0) {
        lines.push("No documents were returned for this query.");
        return lines.join("\n");
    }
    for (const [index, document] of response.documents.entries()) {
        lines.push(`Source ${index + 1}: ${document.title}`);
        lines.push(`URL: ${document.url}`);
        if (document.publishedAt !== undefined) lines.push(`Published: ${document.publishedAt}`);
        lines.push("Snippets:");
        for (const snippet of document.snippets) {
            lines.push(`- ${snippet}`);
        }
        lines.push("");
    }
    return lines.join("\n").trimEnd();
}
