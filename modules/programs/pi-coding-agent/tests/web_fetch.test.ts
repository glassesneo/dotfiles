import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import Value from "typebox/value";
import {
    buildExaContentsBody,
    buildParallelExtractBody,
    normalizeExaContentsResponse,
    normalizeParallelExtractResponse,
} from "../extensions_src/utilities/web_fetch_adapters.ts";
import { routeWebFetch } from "../extensions_src/utilities/web_fetch_router.ts";
import {
    parseWebFetchInput,
    type WebRetrievalRuntimeConfig,
} from "../extensions_src/utilities/web_retrieval_types.ts";
import {
    createWebFetchToolDefinition,
    registerWebFetch,
    webFetchParameters,
} from "../extensions_src/web_fetch.ts";

function config(apiKeyFile: string | null = "/secret/key"): WebRetrievalRuntimeConfig {
    const entries = [
        ["parallel-search", "https://parallel.example/search", null],
        ["brave-llm-context", "https://brave.example/context", null],
        ["brave-web-search", "https://brave.example/search", null],
        ["exa-search", "https://exa.example/search", null],
        ["parallel-extract", "https://parallel.example/extract", apiKeyFile],
        ["exa-contents", "https://exa.example/contents", apiKeyFile],
    ] as const;
    return {
        schemaVersion: 2,
        providers: entries.map(([id, endpoint, key]) => ({ id, kind: id, endpoint, apiKeyFile: key })) as WebRetrievalRuntimeConfig["providers"],
        routing: {
            generalFamilies: { parallel: 5, brave: 1 },
            braveProviders: { "brave-llm-context": 2, "brave-web-search": 1 },
        },
        deadlinesMs: { search: 30_000, fetch: 60_000 },
        retry: { maxRetries: 1, defaultWaitMs: 1_000 },
    };
}

void test("web_fetch input boundary applies defaults while preserving URL occurrences and rejects unsafe shapes", () => {
    const duplicate = "https://example.com/article";
    assert.deepEqual(parseWebFetchInput({ urls: [duplicate, duplicate] }), {
        urls: [duplicate, duplicate],
        mode: "relevant",
        maxCharsTotal: 24_000,
    });
    assert.deepEqual(parseWebFetchInput({
        urls: ["http://example.com/a"],
        objective: "  compare claims  ",
        mode: "full",
        maxCharsTotal: 1_000,
    }), {
        urls: ["http://example.com/a"],
        objective: "compare claims",
        mode: "full",
        maxCharsTotal: 1_000,
    });
    assert.throws(() => parseWebFetchInput({ urls: [] }), /1\.\.20/);
    assert.throws(() => parseWebFetchInput({ urls: ["file:///etc/passwd"] }), /safe HTTP\(S\)/);
    assert.throws(() => parseWebFetchInput({ urls: ["https://user:pass@example.com/"] }), /safe HTTP\(S\)/);
    assert.throws(() => parseWebFetchInput({ urls: [duplicate], extra: true }), /unknown keys/);
    assert.throws(() => parseWebFetchInput({ urls: [duplicate], maxCharsTotal: 999 }), /1000/);
    assert.equal(Value.Check(webFetchParameters, { urls: [duplicate] }), true);

    const tools: string[] = [];
    registerWebFetch({ registerTool(tool: { name: string }) { tools.push(tool.name); } } as unknown as ExtensionAPI, {
        loadConfig: async () => config(),
        fetch: async () => { throw new Error("unused"); },
        readTextFile: async () => "key",
        sleep: async () => {},
        now: () => 0,
    });
    assert.deepEqual(tools, ["web_fetch"]);
});

void test("whole-tool and router boundaries cancel or time out stalled config and credential reads", async () => {
    const url = "https://deadline.example/doc";
    const baseDeps = {
        fetch: async () => { throw new Error("must not fetch"); },
        readTextFile: async () => "key",
        sleep: async () => {},
        now: () => 0,
    };

    const configCancellation = new AbortController();
    const cancelledTool = createWebFetchToolDefinition({
        ...baseDeps,
        loadConfig: () => new Promise<WebRetrievalRuntimeConfig>(() => {}),
    });
    const cancelledExecution = cancelledTool.execute("call", { urls: [url] }, configCancellation.signal, undefined, { cwd: "/work" } as never);
    configCancellation.abort();
    await assert.rejects(cancelledExecution, /web_fetch request aborted/);

    const timedTool = createWebFetchToolDefinition({
        ...baseDeps,
        loadConfig: () => new Promise<WebRetrievalRuntimeConfig>(() => {}),
        deadlineMs: 10,
    });
    await assert.rejects(
        timedTool.execute("call", { urls: [url] }, undefined, undefined, { cwd: "/work" } as never),
        /web_fetch request timed out/,
    );

    const credentialCancellation = new AbortController();
    const cancelledCredential = routeWebFetch(parseWebFetchInput({ urls: [url] }), config(), {
        ...baseDeps,
        readTextFile: () => new Promise<string>(() => {}),
    }, credentialCancellation.signal);
    credentialCancellation.abort();
    await assert.rejects(cancelledCredential, /web_fetch request aborted/);

    const shortConfig = { ...config(), deadlinesMs: { search: 30_000, fetch: 10 } };
    await assert.rejects(routeWebFetch(parseWebFetchInput({ urls: [url] }), shortConfig, {
        ...baseDeps,
        readTextFile: () => new Promise<string>(() => {}),
    }), /parallel-extract.*timeout/);
});

void test("provider HTTP authentication failures are credential errors without retry or cross-mode fallback", async () => {
    const url = "https://auth.example/doc";
    for (const status of [401, 403]) {
        const endpoints: string[] = [];
        let sleeps = 0;
        await assert.rejects(routeWebFetch(parseWebFetchInput({ urls: [url], mode: "full" }), config(), {
            readTextFile: async () => "opaque-secret",
            fetch: async endpoint => {
                endpoints.push(endpoint);
                return new Response("credential rejected: opaque-secret", { status });
            },
            sleep: async () => { sleeps += 1; },
            now: () => 0,
        }), error => {
            assert.match(String(error), new RegExp(`exa-contents.*credential`));
            assert.equal((error as { status?: number }).status, status);
            assert.doesNotMatch(String(error), /opaque-secret|credential rejected/);
            return true;
        });
        assert.deepEqual(endpoints, ["https://exa.example/contents"]);
        assert.equal(sleeps, 0);
    }
});

void test("provider mappings use one mode-specific batch and project mixed results onto every input occurrence", async () => {
    const a = "https://a.example/doc";
    const b = "https://b.example/missing";
    const relevant = parseWebFetchInput({ urls: [a, b, a], objective: "find evidence" });
    assert.deepEqual(buildParallelExtractBody(relevant), {
        urls: [a, b, a],
        objective: "find evidence",
        max_chars_total: 24_000,
    });
    const parallel = normalizeParallelExtractResponse({
        extract_id: "extract-1",
        session_id: "session-1",
        results: [
            { url: a, title: "A", excerpts: ["first\r\nline"], id: "native-a", ignoredSecret: "no" },
            { url: b, error: { status: 404, message: "not indexed" } },
        ],
        warnings: [{ code: "partial" }],
        usage: [{ characters: 10 }],
    }, relevant);
    assert.deepEqual(parallel.items.map(item => [item.inputIndex, item.url, item.error?.category]), [
        [0, a, undefined],
        [1, b, "not-found"],
        [2, a, undefined],
    ]);
    assert.deepEqual(parallel.items[0]!.excerpts, ["first\nline"]);
    assert.deepEqual(parallel.items[2]!.excerpts, ["first\nline"]);
    assert.deepEqual(parallel.items[0]!.providerMetadata, { id: "native-a" });
    assert.equal(JSON.stringify(parallel).includes("ignoredSecret"), false);
    assert.equal(parallel.providerRequestId, "extract-1");
    assert.equal(parallel.providerSessionId, "session-1");

    const full = parseWebFetchInput({ urls: [a, b], objective: "do not narrow", mode: "full" });
    assert.deepEqual(buildExaContentsBody(full), { urls: [a, b], text: true });
    const exa = normalizeExaContentsResponse({
        requestId: "exa-request",
        results: [
            { url: a, title: "Full A", text: "complete text", id: "exa-a", author: "Author", score: 0.9 },
        ],
        errors: [{ url: b, status: 503, message: "temporarily unavailable" }],
    }, full);
    assert.equal(exa.items[0]!.content, "complete text");
    assert.deepEqual(exa.items[0]!.providerMetadata, { id: "exa-a", author: "Author" });
    assert.equal(exa.items[1]!.error?.category, "http");
    assert.equal(exa.items[1]!.error?.status, 503);
    assert.deepEqual(exa.unsupportedHints, ["objective"]);
});

void test("fetch router retries only its fixed backend and applies normalized UTF-16 budget in input order", async () => {
    const a = "https://a.example/doc";
    const b = "https://b.example/doc";
    const request = parseWebFetchInput({ urls: [a, b], mode: "full", maxCharsTotal: 1_000 });
    const endpoints: string[] = [];
    const bodies: unknown[] = [];
    const sleeps: number[] = [];
    let calls = 0;
    let clock = 0;
    const result = await routeWebFetch(request, config(), {
        readTextFile: async path => {
            assert.equal(path, "/secret/key");
            return "opaque-key\n";
        },
        fetch: async (endpoint, init) => {
            calls += 1;
            endpoints.push(endpoint);
            if (typeof init.body !== "string") throw new Error("expected JSON request body");
            bodies.push(JSON.parse(init.body));
            assert.equal(new Headers(init.headers).get("x-api-key"), "opaque-key");
            clock += 10;
            if (calls === 1) return new Response("busy", { status: 503 });
            return Response.json({ results: [
                { url: a, text: `${"a".repeat(996)}\r\nTAIL` },
                { url: b, text: "later" },
            ] });
        },
        sleep: async ms => { sleeps.push(ms); clock += ms; },
        now: () => clock,
    });
    assert.equal(calls, 2);
    assert.deepEqual(new Set(endpoints), new Set(["https://exa.example/contents"]));
    assert.deepEqual(bodies, [{ urls: [a, b], text: true }, { urls: [a, b], text: true }]);
    assert.deepEqual(sleeps, [1_000]);
    assert.equal(result.provider, "exa-contents");
    assert.equal(result.retryCount, 1);
    assert.equal(result.items[0]!.content?.length, 1_000);
    assert.equal(result.items[0]!.content?.endsWith("\nTAI"), true);
    assert.equal(result.items[0]!.truncated, true);
    assert.equal(result.items[1]!.content, undefined);
    assert.equal(result.items[1]!.truncated, true);
    assert.deepEqual(result.warnings, [
        { inputIndex: 0, reason: "character-budget", omittedChars: 1 },
        { inputIndex: 1, reason: "character-budget", omittedChars: 5 },
    ]);

    let deadlineFetches = 0;
    let deadlineSleeps = 0;
    await assert.rejects(routeWebFetch(parseWebFetchInput({ urls: [a], mode: "full" }), config(), {
        readTextFile: async () => "key",
        fetch: async endpoint => {
            deadlineFetches += 1;
            assert.equal(endpoint, "https://exa.example/contents");
            return new Response("busy", { status: 503, headers: { "Retry-After": "61" } });
        },
        sleep: async () => { deadlineSleeps += 1; },
        now: () => 0,
    }), /exa-contents.*timeout/);
    assert.equal(deadlineFetches, 1);
    assert.equal(deadlineSleeps, 0);

    await assert.rejects(routeWebFetch(parseWebFetchInput({ urls: [a] }), config(null), {
        readTextFile: async () => { throw new Error("must not expose path"); },
        fetch: async () => { throw new Error("must not fetch"); },
        sleep: async () => {},
        now: () => 0,
    }), error => {
        assert.match(String(error), /parallel-extract.*credential/);
        assert.doesNotMatch(String(error), /secret|path|exa-contents/);
        return true;
    });
});

void test("tool keeps complete normalized diagnostics while model output uses the private truncation contract", async () => {
    const url = "https://large.example/doc";
    const isolatedTmp = await mkdtemp(join(tmpdir(), "web-fetch-isolated-"));
    const previousTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = isolatedTmp;
    try {
        const tool = createWebFetchToolDefinition({
            loadConfig: async () => config(),
            readTextFile: async () => "key",
            fetch: async () => Response.json({
                requestId: "provider-request",
                results: [{ url, title: "Large", text: "line\r\n".repeat(20_000), id: "native-id" }],
                usage: { cost: 1 },
            }),
            sleep: async () => {},
            now: (() => { let value = 0; return () => ++value; })(),
            createRequestId: () => "local-request",
        });
        const result = await tool.execute("call", { urls: [url], mode: "full", maxCharsTotal: 200_000 }, undefined, undefined, { cwd: "/work" } as never);
        assert.equal(result.details.schemaVersion, 1);
        assert.equal(result.details.response.requestId, "local-request");
        assert.equal(result.details.response.providerRequestId, "provider-request");
        assert.equal(result.details.response.items[0]!.content?.includes("\r"), false);
        assert.equal(result.details.response.items[0]!.providerMetadata?.id, "native-id");
        assert.equal(result.details.truncation?.truncated, true);
        const outputPath = result.details.truncation?.fullOutputPath;
        assert.ok(outputPath?.startsWith(isolatedTmp));
        assert.equal((await stat(outputPath!)).mode & 0o777, 0o600);
        assert.equal((await stat(join(outputPath!, ".."))).mode & 0o777, 0o700);
        assert.match(await readFile(outputPath!, "utf8"), /Provider: exa-contents/);
        const visible = result.content[0];
        assert.ok(visible?.type === "text");
        assert.match(visible.text, /Output truncated/);

        const failing = createWebFetchToolDefinition({
            loadConfig: async () => config(),
            readTextFile: async () => "key",
            fetch: async () => Response.json({ results: [{ url, text: "x".repeat(100_000) }] }),
            sleep: async () => {},
            now: () => 0,
            writeTempOutput: async () => { throw new Error("/private/output.txt permission denied"); },
        });
        await assert.rejects(
            failing.execute("call", { urls: [url], mode: "full", maxCharsTotal: 200_000 }, undefined, undefined, { cwd: "/work" } as never),
            error => {
                assert.equal(error instanceof Error && error.message, "web_fetch could not save truncated output");
                assert.doesNotMatch(String(error), /private|permission|output\.txt/);
                return true;
            },
        );
    } finally {
        if (previousTmpdir === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = previousTmpdir;
    }
});
