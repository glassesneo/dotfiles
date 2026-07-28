import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OriginRunDiscovery, sortManagedRuns, stopSubagentRun } from "../extensions_src/utilities/subagent_management.ts";
import { attachTmux, createRun, finishRun, patchStatus, readSnapshot } from "../extensions_src/utilities/subagent_store.ts";
import type { AgentProfile } from "../extensions_src/utilities/profile_types.ts";
import type { SubagentRuntimeConfig } from "../extensions_src/utilities/subagent_types.ts";

const profile: AgentProfile = { model: "provider/model", description: "Test.", allowAllTools: true, tools: [], extensions: {} };
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "subagent-management-"));
    const config: SubagentRuntimeConfig = { schemaVersion: 1, stateRoot: join(root, "runs"), runner: { node: "/node", script: "/runner", extensions: ["/extension"] }, harnesses: { pi: { command: "/pi" } }, maxDepth: 3 };
    return { root, config };
}
const alive = async () => ({ stdout: "0\n", stderr: "", code: 0 });

async function running(config: SubagentRuntimeConfig, purpose: string, originSessionId: string, parentRunId?: string) {
    const run = await createRun(config, "full", profile, purpose, purpose, "/work", { callerProfile: "full", depth: parentRunId ? 2 : 1, parentRunId, originSessionId });
    await patchStatus(run.paths, { status: "starting" });
    await attachTmux(run.paths, { sessionId: "$1", session: "main", windowId: "@1", paneId: `%${purpose}`, windowName: purpose });
    await patchStatus(run.paths, { status: "running", startedAt: new Date().toISOString() });
    return run;
}

test("origin discovery includes descendants, excludes other sessions, retries malformed directories, and sorts active first", async () => {
    const { config } = await fixture();
    const parent = await running(config, "parent", "origin");
    const child = await running(config, "child", "origin", parent.request.runId);
    const other = await running(config, "other", "other-origin");
    await finishRun(parent.paths, { schemaVersion: 3, runId: parent.request.runId, outcome: "succeeded", output: "done", error: null, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, turns: 1, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() });
    const malformedDirectory = join(config.stateRoot, "550e8400-e29b-41d4-a716-446655440000");
    await mkdir(malformedDirectory);
    await writeFile(join(malformedDirectory, "request.json"), JSON.stringify({ originSessionId: "origin" }));
    const discovery = new OriginRunDiscovery({ stateRoot: config.stateRoot, originSessionId: "origin", exec: alive });
    const first = await discovery.refresh();
    assert.deepEqual(first.runs.map(run => run.snapshot.runId), [child.request.runId, parent.request.runId]);
    assert.equal(first.runs.some(run => run.snapshot.runId === other.request.runId), false);
    assert.equal(first.malformedCount, 1);
    assert.equal((await discovery.refresh()).malformedCount, 1);
});

test("stable ordering uses terminal group, descending creation time, and full run ID tie break", () => {
    const base = (runId: string, status: "running" | "failed", createdAt: string) => ({ request: {} as never, snapshot: { runId, status, createdAt } as never });
    const sorted = sortManagedRuns([base("b", "failed", "2026-01-01"), base("c", "running", "2026-01-02"), base("a", "running", "2026-01-02")]);
    assert.deepEqual(sorted.map(run => run.snapshot.runId), ["a", "c", "b"]);
});

test("v4 stop remains durable when the supervisor is absent and does not stop children", async () => {
    const { config } = await fixture();
    const parent = await running(config, "parent", "origin");
    const child = await running(config, "child", "origin", parent.request.runId);
    let now = 0; const killed: string[] = [];
    await assert.rejects(stopSubagentRun({
        stateRoot: config.stateRoot, runId: parent.request.runId, originSessionId: "origin", monotonicNow: () => now,
        sleep: async () => { now = 6000; },
        exec: async (_command, args) => {
            if (args[0] === "display-message") return { stdout: "0\n", stderr: "", code: 0 };
            if (args[0] === "kill-pane") { killed.push(args.at(-1)!); return { stdout: "", stderr: "", code: 0 }; }
            return { stdout: "", stderr: "unexpected", code: 1 };
        },
    }), /stop request is durable but timed out/);
    assert.equal((await readSnapshot(config.stateRoot, parent.request.runId)).status, "stopping");
    assert.deepEqual(killed, []);
    assert.equal((await readSnapshot(config.stateRoot, child.request.runId)).status, "running");
});
