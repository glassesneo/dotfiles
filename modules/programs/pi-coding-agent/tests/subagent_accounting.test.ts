import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { claimUsageBatch, createSubagentGetTool } from "../extensions_src/subagent.ts";
import { boundedHandoffJson, boundedModelJson, boundedStartJson, boundedSummaryJson } from "../extensions_src/utilities/subagent_json.ts";
import { claimRunUsage, createRun, finishRun, patchStatus } from "../extensions_src/utilities/subagent_store.ts";
import type { AgentProfile } from "../extensions_src/utilities/profile_types.ts";
import type { RunSnapshot, SubagentRuntimeConfig } from "../extensions_src/utilities/subagent_types.ts";

const fullProfile: AgentProfile = { model: "provider/model", description: "Broad coding work.", allowAllTools: true, tools: [], extensions: { subagent: { allowedTargets: ["full"] } } };

function config(root: string): SubagentRuntimeConfig {
    return {
        schemaVersion: 1,
        stateRoot: join(root, "runs"),
        runner: { node: process.execPath, script: "/runner.ts", extensions: ["/profile.ts", "/subagent.ts"] },
        harnesses: { pi: { command: "/pi" } },
        maxDepth: 3,
    };
}

function usage(input = 1) {
    return {
        input, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 1, cacheWrite1h: 2, totalTokens: input + 9,
        cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
    };
}

void test("bounded serializer measures escaped UTF-8 JSON and links full terminal output", () => {
    const runId = "550e8400-e29b-41d4-a716-446655440000";
    const resultPath = `/tmp/${runId}/result.json`;
    const output = `quote:" slash:\\\ncontrol:\u0001 emoji:😀\n`.repeat(10_000);
    const snapshot: RunSnapshot = {
        schemaVersion: 3, runId, purpose: "Bound output", profile: "full", status: "succeeded", createdAt: "now", finishedAt: "now",
        runDirectory: `/tmp/${runId}`,
        paths: { events: "/tmp/events", stderr: "/tmp/stderr", result: resultPath },
        accounting: { claimed: false },
        result: {
            schemaVersion: 2, runId, outcome: "succeeded", output, error: null, usage: usage(), turns: 1, startedAt: "now", finishedAt: "now",
        },
    };
    const text = boundedModelJson(snapshot as unknown as Record<string, unknown>);
    const parsed = JSON.parse(text) as { result?: { output?: string }; runs?: Array<{ resultPath?: string }> };
    assert.ok(Buffer.byteLength(text, "utf8") <= 50 * 1024);
    assert.match(parsed.result?.output ?? "", /result\.json/);

    const oversized = boundedModelJson({ ...snapshot, runDirectory: "x".repeat(100_000) } as unknown as Record<string, unknown>);
    assert.ok(Buffer.byteLength(oversized, "utf8") <= 50 * 1024);
    assert.doesNotThrow(() => JSON.parse(oversized));
});

void test("start, get, and wait serializers bound accepted oversized profile metadata", () => {
    const runId = "550e8400-e29b-41d4-a716-446655440000";
    const profile = "profile-".repeat(20_000);
    const snapshot: RunSnapshot = {
        schemaVersion: 3,
        runId,
        purpose: "Observe oversized profile",
        profile,
        status: "succeeded",
        createdAt: "now",
        finishedAt: "now",
        runDirectory: `/tmp/${runId}`,
        paths: { events: "/tmp/events", stderr: "/tmp/stderr", result: `/tmp/${runId}/result.json` },
        accounting: { claimed: false },
        result: {
            schemaVersion: 2, runId, outcome: "succeeded", output: "done", error: null,
            usage: usage(), turns: 1, startedAt: "now", finishedAt: "now",
        },
    };
    const payloads = [
        boundedStartJson(snapshot),
        boundedSummaryJson({ runId, purpose: snapshot.purpose, profile, status: "succeeded", output: "done" }),
        boundedSummaryJson({ reason: "condition_met", runs: [{ runId, purpose: snapshot.purpose, profile, status: "succeeded", output: "done" }] }),
    ];
    for (const text of payloads) {
        assert.ok(Buffer.byteLength(text, "utf8") <= 50 * 1024);
        assert.doesNotThrow(() => JSON.parse(text));
        assert.match(text, /Observe oversized profil/);
    }
});

void test("maximum wait cardinality retains per-run observability after metadata compaction", () => {
    const runs = Array.from({ length: 128 }, (_, index) => ({
        runId: `${index.toString().padStart(8, "0")}-0000-4000-8000-000000000000`,
        purpose: "😀".repeat(120),
        profile: "profile-".repeat(20_000),
        status: "succeeded" as const,
        output: "done",
    }));
    const text = boundedSummaryJson({ reason: "condition_met", runs });
    const parsed = JSON.parse(text) as { compact?: boolean; runs?: Array<{ runId: string; purpose: string; profile: string; status: string }> };

    assert.ok(Buffer.byteLength(text, "utf8") <= 50 * 1024);
    assert.equal(parsed.compact, undefined);
    assert.equal(parsed.runs?.length, 128);
    assert.deepEqual(parsed.runs?.map(run => run.runId), runs.map(run => run.runId));
    assert.ok(parsed.runs?.every(run => run.purpose.length > 0 && run.profile.length > 0 && run.status === "succeeded"));
});

void test("handoff serializer preserves every child identity and status before prompt previews", () => {
    const children = Array.from({ length: 128 }, (_, index) => ({
        runId: `${index.toString().padStart(8, "0")}-0000-4000-8000-000000000000`,
        purpose: "😀".repeat(120),
        profile: "focused-reviewer-" + "界".repeat(120),
        status: index % 2 === 0 ? "running" : "succeeded",
        promptPreview: "😀".repeat(512),
    }));
    const text = boundedHandoffJson({ run: { runId: "parent", status: "stopped" }, children });
    const parsed = JSON.parse(text) as { children: Array<{ runId: string; status: string }> };
    assert.ok(Buffer.byteLength(text, "utf8") <= 50 * 1024);
    assert.equal(parsed.children.length, 128);
    assert.deepEqual(parsed.children.map(child => child.runId), children.map(child => child.runId));
    assert.deepEqual(parsed.children.map(child => child.status), children.map(child => child.status));
});

void test("minimal summary serializer bounds escaped UTF-8 fairly without exposing paths", () => {
    const output = `quote:" slash:\\\ncontrol:\u0001 emoji:😀\n`.repeat(10_000);
    const text = boundedSummaryJson({
        reason: "condition_met",
        runs: [
            { runId: "run-1", purpose: "First", profile: "full", status: "succeeded", output },
            { runId: "run-2", purpose: "Second", profile: "full", status: "succeeded", output },
        ],
    });
    const parsed = JSON.parse(text) as { runs: Array<{ output: string }> };

    assert.ok(Buffer.byteLength(text, "utf8") <= 50 * 1024);
    assert.match(parsed.runs[0]?.output ?? "", /Output truncated.*detail=true/s);
    assert.match(parsed.runs[1]?.output ?? "", /Output truncated.*detail=true/s);
    assert.ok(Math.abs(Buffer.byteLength(parsed.runs[0]!.output, "utf8") - Buffer.byteLength(parsed.runs[1]!.output, "utf8")) < 16);
    assert.doesNotMatch(text, /resultRoot|resultFile|paths|runDirectory/);
});

void test("minimal summary serializer bounds oversized failure messages", () => {
    const text = boundedSummaryJson({
        runId: "run-1",
        purpose: "Failure",
        profile: "full",
        status: "failed",
        error: { category: "harness", message: "failure 😀\\\"\n".repeat(20_000), exitCode: 17 },
    });
    const parsed = JSON.parse(text) as { error: { message: string; exitCode?: number } };

    assert.ok(Buffer.byteLength(text, "utf8") <= 50 * 1024);
    assert.match(parsed.error.message, /Error message truncated.*detail=true/s);
    assert.equal(parsed.error.exitCode, 17);
});

void test("a failed later usage claim rolls back earlier claims for a safe retry", async () => {
    const snapshots = ["run-1", "run-2"].map(runId => ({
        schemaVersion: 3 as const,
        runId,
        purpose: `Purpose ${runId}`,
        profile: "full",
        status: "succeeded" as const,
        createdAt: "now",
        finishedAt: "now",
        runDirectory: `/tmp/${runId}`,
        paths: { events: "/tmp/events", stderr: "/tmp/stderr", result: `/tmp/${runId}/result.json` },
        accounting: { claimed: false },
        result: {
            schemaVersion: 2 as const, runId, outcome: "succeeded" as const, output: "done", error: null,
            usage: usage(), turns: 1, startedAt: "now", finishedAt: "now",
        },
    }));
    const released: string[] = [];
    await assert.rejects(
        claimUsageBatch("/tmp/runs", snapshots, "session", "call", "subagent_wait", {
            async claim(_root, runId, originSessionId, toolCallId, toolName) {
                if (runId === "run-2") throw new Error("claim persistence failed");
                return {
                    created: true,
                    claim: { schemaVersion: 1, originSessionId, toolCallId, toolName, runId, claimedAt: "now" },
                    result: snapshots[0]!.result!,
                };
            },
            async release(_root, runId) { released.push(runId); return true; },
        }),
        /claim persistence failed/,
    );
    assert.deepEqual(released, ["run-1"]);
});

void test("first terminal get returns top-level Pi usage and repeated get does not", async () => {
    const root = await mkdtemp(join(tmpdir(), "usage-tool-"));
    const cfg = config(root);
    const configPath = join(root, "subagent.json");
    await writeFile(configPath, JSON.stringify(cfg));
    const run = await createRun(cfg, "full", fullProfile, "Accounting task", "task", root, { callerProfile: "full", depth: 1, originSessionId: "session" });
    await patchStatus(run.paths, { status: "starting" });
    await patchStatus(run.paths, { status: "running", startedAt: "now" });
    await finishRun(run.paths, {
        schemaVersion: 2, runId: run.request.runId, outcome: "succeeded", output: "done", error: null,
        usage: usage(7), turns: 1, startedAt: "now", finishedAt: "now",
    });
    const ctx = {
        cwd: root,
        sessionManager: { getSessionId: () => "session", getSessionFile: () => join(root, "session.jsonl") },
    } as ExtensionContext;
    const tool = createSubagentGetTool({
        configPath, env: {}, exec: async () => ({ stdout: "0\n", stderr: "", code: 0 }),
    });
    const first = await tool.execute("call-1", { runId: run.request.runId }, undefined, undefined, ctx);
    const second = await tool.execute("call-2", { runId: run.request.runId }, undefined, undefined, ctx);
    const firstText = first.content[0]?.type === "text" ? first.content[0].text : "{}";
    assert.deepEqual(JSON.parse(firstText), { runId: run.request.runId, purpose: "Accounting task", profile: "full", status: "succeeded", output: "done" });
    assert.equal(first.usage?.input, 7);
    assert.equal(first.usage?.cost.total, 1);
    assert.equal(second.usage, undefined);
    assert.deepEqual(first.details.accounting.claimedRunIds, [run.request.runId]);
    assert.deepEqual(second.details.accounting.claimedRunIds, []);
});

void test("usage claim is exclusive across concurrent and repeated observers", async () => {
    const root = await mkdtemp(join(tmpdir(), "usage-claim-"));
    const cfg = config(root);
    const run = await createRun(cfg, "full", fullProfile, "Exclusive claim", "task", root, { callerProfile: "full", depth: 1, originSessionId: "session" });
    await patchStatus(run.paths, { status: "starting" });
    await patchStatus(run.paths, { status: "running", startedAt: "now" });
    await finishRun(run.paths, {
        schemaVersion: 2, runId: run.request.runId, outcome: "succeeded", output: "done", error: null,
        usage: usage(7), turns: 1, startedAt: "now", finishedAt: "now",
    });

    const claims = await Promise.all([
        claimRunUsage(cfg.stateRoot, run.request.runId, "session", "call-a", "subagent_get"),
        claimRunUsage(cfg.stateRoot, run.request.runId, "session", "call-b", "subagent_wait"),
    ]);
    assert.equal(claims.filter(claim => claim.created).length, 1);
    assert.equal(claims.filter(claim => !claim.created).length, 1);
    const repeated = await claimRunUsage(cfg.stateRoot, run.request.runId, "session", "call-c", "subagent_get");
    assert.equal(repeated.created, false);
    await assert.rejects(
        claimRunUsage(cfg.stateRoot, run.request.runId, "other-session", "call-d", "subagent_get"),
        /different origin session/,
    );
});
