import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import Value from "typebox/value";
import {
    buildBraveLlmContextBody,
    buildBraveWebSearchUrl,
    buildExaSearchBody,
    buildParallelSearchBody,
    createSearchAdapter,
} from "../extensions_src/utilities/search_adapters.ts";
import {
    SearchRoutingError,
    createSearchRouter,
    selectSearchAdapter,
    type SearchRouterDependencies,
} from "../extensions_src/utilities/search_router.ts";
import {
    parseWebSearchInput,
    type NormalizedSearchRequest,
    type SearchAdapter,
    type WebRetrievalRuntimeConfig,
    type WebSearchDetails,
} from "../extensions_src/utilities/web_retrieval_types.ts";
import {
    createWebSearchToolDefinition,
    registerWebSearch,
    webSearchParameters,
} from "../extensions_src/web_search.ts";

const endpoints = {
    "parallel-search": "https://parallel.example/search",
    "brave-llm-context": "https://brave.example/context",
    "brave-web-search": "https://brave.example/web",
    "exa-search": "https://exa.example/search",
    "parallel-extract": "https://parallel.example/extract",
    "exa-contents": "https://exa.example/contents",
} as const;

function config(apiKeyFile: string | null = "/key"): WebRetrievalRuntimeConfig {
    return {
        schemaVersion: 2,
        providers: Object.entries(endpoints).map(([id, endpoint]) => ({ id, kind: id, endpoint, apiKeyFile })) as WebRetrievalRuntimeConfig["providers"],
        routing: {
            generalFamilies: { parallel: 5, brave: 1 },
            braveProviders: { "brave-llm-context": 2, "brave-web-search": 1 },
        },
        deadlinesMs: { search: 30_000, fetch: 60_000 },
        retry: { maxRetries: 1, defaultWaitMs: 1_000 },
    };
}

function request(overrides: Partial<NormalizedSearchRequest> = {}): NormalizedSearchRequest {
    return { query: "web retrieval", intent: "auto", maxResults: 10, ...overrides };
}

function adapter(id: SearchAdapter["id"], family: SearchAdapter["family"]): SearchAdapter {
    return {
        id,
        family,
        capabilities: {
            lanes: id === "exa-search" ? ["discovery"] : ["general"],
            freshness: id !== "parallel-search",
            domains: id === "brave-web-search" || id === "exa-search",
            objective: id === "parallel-search" || id === "exa-search",
        },
        async search() {
            return { results: [], normalizationWarnings: [], providerResultCount: 0 };
        },
    };
}

function deps(overrides: Partial<SearchRouterDependencies> = {}): SearchRouterDependencies {
    return {
        fetch: async () => Response.json({ results: [] }),
        readTextFile: async () => "credential",
        sleep: async () => {},
        now: () => 1_000,
        rng: () => 0,
        requestId: () => "local-request-id",
        ...overrides,
    };
}

void test("AC1: public input normalizes defaults and rejects material invalid shapes", () => {
    assert.deepEqual(parseWebSearchInput({
        query: "  provider   independent search  ",
        objective: "  compare sources  ",
        includeDomains: ["EXAMPLE.COM"],
    }), {
        query: "provider independent search",
        objective: "compare sources",
        intent: "auto",
        includeDomains: ["example.com"],
        maxResults: 10,
    });
    assert.throws(() => parseWebSearchInput({ query: "ok", provider: "exa" }), /unknown keys/);
    assert.throws(() => parseWebSearchInput({ query: "ok", includeDomains: ["https://example.com"] }), /bare hostname/);
    assert.throws(() => parseWebSearchInput({ query: "ok", includeDomains: ["a.example"], excludeDomains: ["A.EXAMPLE"] }), /overlap/);
    assert.throws(() => parseWebSearchInput({ query: "x".repeat(401) }), /1\.\.400/);
    assert.equal(Value.Check(webSearchParameters, { query: "query", intent: "discovery", maxResults: 20 }), true);
    assert.equal(Value.Check(webSearchParameters, { query: "query", provider: "exa-search" }), false);
});

void test("AC2: hierarchical RNG boundaries implement 5:1 then 2:1 routing", () => {
    const choices = [
        adapter("parallel-search", "parallel"),
        adapter("brave-llm-context", "brave"),
        adapter("brave-web-search", "brave"),
    ];
    const draws = (values: number[]) => {
        let index = 0;
        return () => values[index++]!;
    };
    assert.equal(selectSearchAdapter(choices, "general", config(), draws([5 / 6 - Number.EPSILON])).id, "parallel-search");
    assert.equal(selectSearchAdapter(choices, "general", config(), draws([5 / 6, 2 / 3 - Number.EPSILON])).id, "brave-llm-context");
    assert.equal(selectSearchAdapter(choices, "general", config(), draws([5 / 6, 2 / 3])).id, "brave-web-search");
});

// Given a freshness general request at the existing 5:1 boundary, when it crosses routing, the caller observes Parallel with one unsupported freshness hint and no freshness capability diagnostic.
void test("freshness remains best-effort at the Parallel 5:1 routing boundary", async () => {
    const router = createSearchRouter(deps({ rng: () => 5 / 6 - Number.EPSILON }));

    const result = await router.search(config(), request({ freshness: "week" }));

    assert.equal(result.provider, "parallel-search");
    assert.deepEqual(result.unsupportedHints, ["freshness"]);
    assert.equal(result.eligibilityDiagnostics.some(item => item.reason === "freshness"), false);
});

void test("AC3: credential and capability eligibility preserve lane and native constraints", async () => {
    const seen: string[] = [];
    const runtime = config("/key");
    runtime.providers.find(provider => provider.id === "parallel-search")!.apiKeyFile = null;
    const router = createSearchRouter(deps({
        fetch: async input => {
            seen.push(input);
            if (input.startsWith(endpoints["exa-search"])) return Response.json({ results: [] });
            return input.startsWith(endpoints["brave-web-search"])
                ? Response.json({ web: { results: [] } })
                : Response.json({ results: [] });
        },
    }));
    const domainResult = await router.search(runtime, request({ includeDomains: ["example.com"] }));
    assert.equal(domainResult.provider, "brave-web-search");
    assert.equal(domainResult.eligibilityDiagnostics.some(item =>
        item.provider === "parallel-search" && item.category === "credential" && item.reason === "not-configured"), true);
    assert.equal(domainResult.eligibilityDiagnostics.some(item =>
        item.provider === "brave-llm-context" && item.category === "capability" && item.reason === "domains"), true);
    const discoveryResult = await router.search(runtime, request({ intent: "discovery" }));
    assert.equal(discoveryResult.provider, "exa-search");
    assert.equal(seen.some(url => url.startsWith(endpoints["parallel-search"])), false);

    const ineligible = config("/valid");
    ineligible.providers.find(provider => provider.id === "parallel-search")!.apiKeyFile = null;
    ineligible.providers.find(provider => provider.id === "brave-llm-context")!.apiKeyFile = "/private/unreadable";
    ineligible.providers.find(provider => provider.id === "brave-web-search")!.apiKeyFile = "/private/empty";
    await assert.rejects(
        createSearchRouter(deps({
            readTextFile: async path => {
                if (path.endsWith("unreadable")) throw new Error(`ENOENT ${path}`);
                return path.endsWith("empty") ? "  \n" : "credential";
            },
        })).search(ineligible, request()),
        error => {
            assert.ok(error instanceof SearchRoutingError);
            assert.match(error.message, /no eligible general provider/);
            assert.doesNotMatch(String(error), /private|unreadable|empty|ENOENT/);
            assert.deepEqual(error.eligibilityDiagnostics, [
                { provider: "parallel-search", category: "credential", reason: "not-configured" },
                { provider: "brave-llm-context", category: "credential", reason: "unreadable" },
                { provider: "brave-web-search", category: "credential", reason: "empty" },
                { provider: "exa-search", category: "capability", reason: "lane" },
            ]);
            return true;
        },
    );
});

// Given config or credential I/O that never settles, the tool/router boundary observes caller cancellation or its owning deadline without waiting for that I/O.
void test("delayed config and credential reads obey cancellation and deadlines", async () => {
    const never = new Promise<never>(() => {});
    let routerCalls = 0;
    const configCaller = new AbortController();
    const configTool = createWebSearchToolDefinition({
        loadConfig: async () => never,
        router: { search: async () => { routerCalls += 1; throw new Error("unexpected"); } },
        toolDeadlineMs: 1_000,
    });
    const cancelledConfig = configTool.execute("call", { query: "evidence" }, configCaller.signal, undefined, { cwd: "/work" } as never);
    configCaller.abort("/private/caller-reason");
    await assert.rejects(cancelledConfig, error => {
        assert.match(String(error), /request aborted/);
        assert.doesNotMatch(String(error), /private|caller-reason/);
        return true;
    });
    assert.equal(routerCalls, 0);

    const deadlineTool = createWebSearchToolDefinition({
        loadConfig: async () => never,
        router: { search: async () => { routerCalls += 1; throw new Error("unexpected"); } },
        toolDeadlineMs: 5,
    });
    await assert.rejects(
        deadlineTool.execute("call", { query: "evidence" }, undefined, undefined, { cwd: "/work" } as never),
        /deadline exceeded/,
    );
    assert.equal(routerCalls, 0);

    const credentialCaller = new AbortController();
    const cancelledCredential = createSearchRouter(deps({ readTextFile: async () => never }))
        .search(config(), request(), credentialCaller.signal);
    credentialCaller.abort("/private/credential-abort");
    await assert.rejects(cancelledCredential, error => {
        assert.match(String(error), /request aborted/);
        assert.doesNotMatch(String(error), /private|credential-abort|\/key/);
        return true;
    });

    const short = config();
    short.deadlinesMs.search = 5;
    await assert.rejects(
        createSearchRouter(deps({ readTextFile: async () => never })).search(short, request()),
        /deadline exceeded/,
    );
});

void test("AC4: retryable status retries once, then falls back with bounded attempts", async () => {
    let parallelCalls = 0;
    const sleeps: number[] = [];
    const router = createSearchRouter(deps({
        fetch: async input => {
            if (input === endpoints["parallel-search"]) {
                parallelCalls += 1;
                return new Response("opaque provider body", { status: 503, headers: { "Retry-After": "0" } });
            }
            return Response.json({ grounding: { generic: [] }, sources: {} });
        },
        sleep: async ms => { sleeps.push(ms); },
        rng: () => 0,
    }));
    const result = await router.search(config(), request());
    assert.equal(parallelCalls, 2);
    assert.deepEqual(sleeps, [0]);
    assert.equal(result.initialProvider, "parallel-search");
    assert.equal(result.provider, "brave-llm-context");
    assert.equal(result.fallback, true);
    assert.deepEqual(result.attempts.map(item => ({ provider: item.provider, retryCount: item.retryCount, outcome: item.outcome, status: item.error?.status })), [
        { provider: "parallel-search", retryCount: 1, outcome: "error", status: 503 },
        { provider: "brave-llm-context", retryCount: 0, outcome: "success", status: undefined },
    ]);
    assert.doesNotMatch(JSON.stringify(result), /opaque provider body|credential|\/key/);

    const caller = new AbortController();
    caller.abort("private caller reason");
    let calls = 0;
    await assert.rejects(
        createSearchRouter(deps({ fetch: async () => { calls += 1; return Response.json({}); } })).search(config(), request(), caller.signal),
        /aborted/,
    );
    assert.equal(calls, 0);

    const duringRetry = new AbortController();
    let fallbackCalls = 0;
    const abortingRouter = createSearchRouter(deps({
        fetch: async input => {
            if (input !== endpoints["parallel-search"]) fallbackCalls += 1;
            return new Response("busy", { status: 503, headers: { "Retry-After": "1" } });
        },
        sleep: async () => {
            duringRetry.abort("private abort detail");
            throw new Error("private abort detail");
        },
    }));
    await assert.rejects(abortingRouter.search(config(), request(), duringRetry.signal), error => {
        assert.match(String(error), /aborted/);
        assert.doesNotMatch(String(error), /private abort detail/);
        return true;
    });
    assert.equal(fallbackCalls, 0);

    const deadlineConfig = config();
    deadlineConfig.deadlinesMs.search = 5;
    let deadlineCalls = 0;
    const deadlineRouter = createSearchRouter(deps({
        fetch: (_input, init) => {
            deadlineCalls += 1;
            return new Promise<Response>((_resolve, reject) => {
                init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
            });
        },
    }));
    await assert.rejects(deadlineRouter.search(deadlineConfig, request()), error => {
        assert.match(String(error), /timeout/);
        assert.doesNotMatch(String(error), /deadline exceeded/);
        return true;
    });
    assert.equal(deadlineCalls, 1);
});

// Given an HTTP authentication rejection at the provider boundary, callers observe a non-retryable credential classification and sanitized exhaustion diagnostics.
void test("HTTP 401 and 403 are credential failures and do not retry", async () => {
    for (const status of [401, 403]) {
        const created = createSearchAdapter(
            config().providers.find(provider => provider.id === "parallel-search")!,
            "secret-sentinel",
            { now: () => 0, fetch: async () => new Response("opaque body", { status }) },
            1_000,
        );
        await assert.rejects(created.search(request(), new AbortController().signal), error => {
            assert.equal(error instanceof Error && "category" in error && error.category, "credential");
            assert.equal(error instanceof Error && "retryable" in error && error.retryable, false);
            assert.equal(error instanceof Error && "status" in error && error.status, status);
            assert.doesNotMatch(String(error), /opaque|secret-sentinel/);
            return true;
        });
    }

    const runtime = config(null);
    runtime.providers.find(provider => provider.id === "parallel-search")!.apiKeyFile = "/key";
    let calls = 0;
    await assert.rejects(
        createSearchRouter(deps({
            fetch: async () => { calls += 1; return new Response("private provider body", { status: 401 }); },
        })).search(runtime, request()),
        error => {
            assert.ok(error instanceof SearchRoutingError);
            assert.equal(error.attempts[0]?.error?.category, "credential");
            assert.equal(error.attempts[0]?.error?.retryable, false);
            assert.equal(error.eligibilityDiagnostics.every(item => item.reason === "not-configured"), true);
            assert.doesNotMatch(String(error), /private provider body|\/key/);
            return true;
        },
    );
    assert.equal(calls, 1);
});

void test("AC5-AC7: adapters map native requests and retain safe URL results without optional-field loss", async () => {
    const nativeRequest = request({
        objective: "find primary evidence",
        freshness: "week",
        includeDomains: ["docs.example"],
        excludeDomains: ["blog.example"],
        maxResults: 4,
    });
    assert.deepEqual(buildParallelSearchBody(nativeRequest), {
        mode: "turbo", search_queries: ["web retrieval"], objective: "find primary evidence", max_chars_total: 20_000,
    });
    assert.deepEqual(buildBraveLlmContextBody(nativeRequest), {
        q: "web retrieval", count: 4, maximum_number_of_urls: 4, maximum_number_of_tokens: 4_096,
        maximum_number_of_snippets: 12, context_threshold_mode: "balanced", safesearch: "moderate",
        enable_source_metadata: true, freshness: "pw",
    });
    const braveUrl = new URL(buildBraveWebSearchUrl(endpoints["brave-web-search"], nativeRequest));
    assert.equal(braveUrl.searchParams.get("q"), "web retrieval site:docs.example -site:blog.example");
    assert.equal(braveUrl.searchParams.get("count"), "4");
    assert.equal(braveUrl.searchParams.get("freshness"), "pw");
    assert.deepEqual(buildExaSearchBody(nativeRequest, Date.parse("2026-08-08T12:00:00Z")), {
        query: "web retrieval\n\nSearch objective: find primary evidence",
        type: "auto",
        numResults: 4,
        contents: { highlights: true },
        includeDomains: ["docs.example"],
        excludeDomains: ["blog.example"],
        startPublishedDate: "2026-08-01T12:00:00.000Z",
    });

    const payloads: Record<string, unknown> = {
        "parallel-search": {
            search_id: "parallel-request", session_id: "parallel-session", warnings: ["bounded"], usage: [{ searches: 1 }],
            results: [
                { url: "https://same.example/", title: "", excerpts: [], score: 0.8 },
                { url: "https://same.example/", title: "unsafe\u2028title", publish_date: "not-a-date" },
                { url: "javascript:alert(1)", title: "drop only this item" },
            ],
        },
        "brave-llm-context": {
            grounding: { generic: [{ url: "https://brave.example/a", snippets: ["context"] }] },
            sources: { "https://brave.example/a": { hostname: "brave.example", age: ["", "", "", "2026-08-01T00:00:00Z"] } },
        },
        "brave-web-search": { web: { results: [{ url: "https://web.example/a", description: "description", age: "2 days ago" }] } },
        "exa-search": {
            requestId: "exa-request", cost: { total: 0.01 },
            results: [{ id: "exa-id", url: "https://exa.example/a", highlights: ["highlight"], score: 0.7, author: "Author" }],
        },
    };
    for (const id of ["parallel-search", "brave-llm-context", "brave-web-search", "exa-search"] as const) {
        const providerConfig = config().providers.find(provider => provider.id === id)!;
        const created = createSearchAdapter(providerConfig, "secret-sentinel", {
            now: () => Date.parse("2026-08-08T12:00:00Z"),
            fetch: async (_input, init) => {
                assert.equal(JSON.stringify(init.body ?? "").includes("secret-sentinel"), false);
                return Response.json(payloads[id]);
            },
        }, 1_000);
        const response = await created.search(nativeRequest, new AbortController().signal);
        assert.equal(response.providerResultCount >= response.results.length, true);
        assert.doesNotMatch(JSON.stringify(response), /secret-sentinel/);
        if (id === "parallel-search") {
            assert.deepEqual(response.results.map(result => result.url), ["https://same.example/", "https://same.example/"]);
            assert.equal(response.results[0]!.title, undefined);
            assert.equal(response.results[1]!.title, undefined);
            assert.equal(response.results[1]!.providerMetadata?.publish_date, "not-a-date");
            assert.equal(response.normalizationWarnings.some(warning => warning.resultIndex === 2 && warning.field === "url"), true);
            assert.equal(response.providerRequestId, "parallel-request");
            assert.equal(response.providerSessionId, "parallel-session");
        }
        if (id === "brave-llm-context") {
            assert.equal(response.results[0]!.publishedAt, "2026-08-01T00:00:00Z");
            assert.deepEqual(response.unsupportedHints, ["objective", "domains"]);
        }
        if (id === "brave-web-search") assert.deepEqual(response.unsupportedHints, ["objective"]);
        if (id === "exa-search") {
            assert.equal(response.results[0]!.source.resultId, "exa-id");
            assert.equal(response.results[0]!.providerMetadata?.score, 0.7);
            assert.equal(response.providerRequestId, "exa-request");
        }
    }
});

void test("AC15: tool registration is extension-owned and truncation preserves full structured details privately", async () => {
    const tools: string[] = [];
    registerWebSearch({ registerTool(tool: { name: string }) { tools.push(tool.name); } } as unknown as ExtensionAPI, {
        loadConfig: async () => config(),
        router: createSearchRouter(deps()),
    });
    assert.deepEqual(tools, ["web_search"]);

    const huge = "evidence ".repeat(30_000);
    const response: WebSearchDetails["response"] = {
        requestId: "request", lane: "general", initialProvider: "parallel-search", provider: "parallel-search",
        results: [{ url: "https://example.com", excerpts: [huge], source: { provider: "parallel-search", rank: 1 } }],
        fallback: false, attempts: [{ provider: "parallel-search", latencyMs: 1, retryCount: 0, outcome: "success" }],
        eligibilityDiagnostics: [], normalizationWarnings: [], providerResultCount: 1, returnedResultCount: 1,
    };
    const isolatedTmp = await mkdtemp(join(tmpdir(), "web-search-test-"));
    const previousTmp = process.env.TMPDIR;
    process.env.TMPDIR = isolatedTmp;
    try {
        const tool = createWebSearchToolDefinition({
            loadConfig: async () => config(),
            router: { search: async () => response },
        });
        const result = await tool.execute("call", { query: "evidence" }, undefined, undefined, { cwd: "/work" } as never);
        assert.deepEqual(result.details.response, response);
        assert.equal(result.details.truncation?.truncated, true);
        assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /Provider: parallel-search/);
        const path = result.details.truncation?.fullOutputPath;
        assert.ok(path?.startsWith(isolatedTmp));
        assert.equal((await stat(path!)).mode & 0o777, 0o600);
        assert.equal((await stat(join(path!, ".."))).mode & 0o777, 0o700);
        assert.match(await readFile(path!, "utf8"), /https:\/\/example.com/);

        const failing = createWebSearchToolDefinition({
            loadConfig: async () => config(),
            router: { search: async () => response },
            writeTempOutput: async () => { throw new Error("EACCES /private/output.txt"); },
        });
        await assert.rejects(
            failing.execute("call", { query: "evidence" }, undefined, undefined, { cwd: "/work" } as never),
            error => {
                assert.equal(error instanceof Error && error.message, "web_search could not save truncated output");
                assert.doesNotMatch(String(error), /private|EACCES|output\.txt/);
                return true;
            },
        );
    } finally {
        if (previousTmp === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = previousTmp;
    }
});
