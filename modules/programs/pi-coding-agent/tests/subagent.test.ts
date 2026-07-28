import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createSubagentStartTool, registerSubagent, type SubagentDependencies } from "../extensions_src/subagent.ts";
import { SubagentSupervisor } from "../extensions_src/subagent_supervisor.ts";
import { runReplayViewer } from "../extensions_src/subagent_viewer.ts";
import { renderReplay } from "../extensions_src/utilities/subagent_replay.ts";
import { createRun, finishRun, patchStatus, readEvents, readSnapshot } from "../extensions_src/utilities/subagent_store.ts";
import type { AgentProfile, AgentProfileConfig } from "../extensions_src/utilities/profile_types.ts";
import type { SubagentRuntimeConfig } from "../extensions_src/utilities/subagent_types.ts";

const profile: AgentProfile = { model: "provider/model", description: "Test profile.", allowAllTools: true, tools: [], extensions: { subagent: { allowedTargets: [], harness: "pi" } } };
function context(cwd: string): ExtensionContext { return { cwd, sessionManager: { getSessionId: () => "session", getSessionFile: () => join(cwd, "session.jsonl") } } as ExtensionContext; }
async function fixture(): Promise<{ root: string; config: SubagentRuntimeConfig; configPath: string; profilePath: string }> {
    const root = await mkdtemp(join(tmpdir(), "subagent-v4-"));
    const config: SubagentRuntimeConfig = { schemaVersion: 2, stateRoot: join(root, "runs"), runner: { node: process.execPath, script: join(process.cwd(), "extensions_src/subagent_runner.ts"), supervisor: join(process.cwd(), "extensions_src/subagent_supervisor.ts"), viewer: join(process.cwd(), "extensions_src/subagent_viewer.ts"), less: "/usr/bin/less", extensions: [join(process.cwd(), "extensions_src/profile.ts"), join(process.cwd(), "extensions_src/subagent.ts")] }, harnesses: { pi: { command: "/missing/pi" } }, maxDepth: 3 };
    const profiles: AgentProfileConfig = { schemaVersion: 2, defaultProfile: "full", profileCycle: ["full"], promptRoutes: {}, profiles: { full: { ...profile, extensions: { subagent: { allowedTargets: ["full"], harness: "pi" } } } } };
    const configPath = join(root, "subagent.json"); const profilePath = join(root, "profiles.json"); await writeFile(configPath, JSON.stringify(config)); await writeFile(profilePath, JSON.stringify(profiles));
    return { root, config, configPath, profilePath };
}

void test("extension registers supervisor-managed tools without tmux", async () => {
    const registered: string[] = [];
    const pi = { registerTool(tool: { name: string }) { registered.push(tool.name); }, registerCommand() {}, on() {}, events: { on() { return () => {}; }, emit() {} }, async exec() { return { stdout: "", stderr: "", code: 1, killed: false }; }, getActiveTools() { return []; } } as unknown as ExtensionAPI;
    assert.equal(await registerSubagent(pi, { env: {} }), true);
    assert.deepEqual(registered, ["subagent_start", "subagent_get", "subagent_wait", "subagent_stop"]);
});

void test("start refuses an unavailable supervisor before creating a run directory", async () => {
    const value = await fixture();
    const deps: SubagentDependencies = { configPath: value.configPath, profileConfigPath: value.profilePath, env: {}, exec: async () => ({ stdout: "", stderr: "", code: 1 }), activeProfile: () => ({ name: "full", facet: { allowedTargets: ["full"], harness: "pi" } }) };
    await assert.rejects(createSubagentStartTool(deps).execute("call", { profile: "full", purpose: "Unavailable", prompt: "task" }, undefined, undefined, context(value.root)), /supervisor is unavailable/);
    assert.deepEqual(await readdir(value.config.stateRoot).catch(() => []), []);
});

void test("supervisor launches a v4 worker without tmux and persists tool results for replay", async () => {
    const value = await fixture(); const fakePi = join(value.root, "fake-pi.sh");
    await writeFile(fakePi, `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '${JSON.stringify({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "README" } })}'\nprintf '%s\\n' '${JSON.stringify({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "read", isError: false, result: { content: [{ type: "text", text: "model-visible result" }], usage: { totalTokens: 2, cost: { total: 0 } } } })}'\nprintf '%s\\n' '${JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } })}'\nprintf '%s\\n' '${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "end", usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0 } } } })}'\n`); await chmod(fakePi, 0o700); value.config.harnesses.pi.command = fakePi;
    const run = await createRun(value.config, "full", profile, "Supervisor run", "inspect the repository", value.root, { callerProfile: "full", depth: 1, originSessionId: "session" });
    const supervisor = new SubagentSupervisor(value.config); await supervisor.acquire();
    await assert.rejects(new SubagentSupervisor(value.config).acquire(), /already running/);
    await supervisor.heartbeat(); await Promise.all([supervisor.scan(), supervisor.scan(), supervisor.scan()]);
    let snapshot = await readSnapshot(value.config.stateRoot, run.request.runId);
    for (let attempt = 0; attempt < 100 && snapshot.status !== "succeeded"; attempt += 1) { await new Promise(resolve => setTimeout(resolve, 50)); await supervisor.scan(); snapshot = await readSnapshot(value.config.stateRoot, run.request.runId); }
    assert.equal(snapshot.status, "succeeded"); assert.equal(snapshot.tmux, undefined); assert.equal(snapshot.result?.output, "done");
    const events = await readEvents(run.paths); assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index + 1)); assert.equal(events.filter(event => event.type === "run_started").length, 1);
    const toolResult = events.find(event => event.type === "tool_finished"); assert.deepEqual(toolResult?.data, { toolCallId: "tool-1", name: "read", isError: false, result: "model-visible result" });
    const replay = await renderReplay(value.config.stateRoot, run.request.runId); assert.match(replay, /Parent instruction:\ninspect the repository/); assert.match(replay, /model-visible result/); assert.match(replay, /Usage: 4 tokens/);
});

void test("supervisor deterministically terminalizes a running run with no verifiable worker", async () => {
    const value = await fixture(); const run = await createRun(value.config, "full", profile, "Lost worker", "task", value.root, { callerProfile: "full", depth: 1, originSessionId: "session" });
    const old = new Date(Date.now() - 10_000).toISOString(); await patchStatus(run.paths, { status: "starting", claim: { instanceId: "old", token: "claim", claimedAt: old }, worker: { token: "worker", pid: 99_999_999, processGroupId: 99_999_999, startedAt: old } }); await patchStatus(run.paths, { status: "running", startedAt: old });
    await new SubagentSupervisor(value.config).scan(); const snapshot = await readSnapshot(value.config.stateRoot, run.request.runId); assert.equal(snapshot.status, "failed"); assert.equal(snapshot.result?.error?.category, "runner_lost");
});

void test("live replay exits at terminal state while history replay waits for its pager, and both clean temporary files", async () => {
    const value = await fixture(); const pager = join(value.root, "fake-less.sh");
    await writeFile(pager, "#!/bin/sh\ntrap 'exit 0' TERM INT\ncase \"$*\" in *+F*) while :; do sleep 1; done;; *) sleep 0.15;; esac\n"); await chmod(pager, 0o700); value.config.runner.less = pager; await writeFile(value.configPath, JSON.stringify(value.config));
    const active = await createRun(value.config, "full", profile, "Live replay", "live instruction", value.root, { callerProfile: "full", depth: 1, originSessionId: "session" });
    await patchStatus(active.paths, { status: "starting" }); await patchStatus(active.paths, { status: "running", startedAt: new Date().toISOString() });
    const liveViewer = runReplayViewer(value.configPath, active.request.runId); await new Promise(resolve => setTimeout(resolve, 100)); const now = new Date().toISOString();
    await finishRun(active.paths, { schemaVersion: 4, runId: active.request.runId, outcome: "succeeded", output: "done", error: null, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, turns: 1, startedAt: now, finishedAt: now });
    await liveViewer; assert.equal((await readdir(active.paths.directory)).some(name => name.startsWith(".replay-")), false);
    const started = Date.now(); await runReplayViewer(value.configPath, active.request.runId); assert.ok(Date.now() - started >= 100); assert.equal((await readdir(active.paths.directory)).some(name => name.startsWith(".replay-")), false);
});

void test("unknown target harness is rejected before a run directory is allocated", async () => {
    const value = await fixture(); const unknown = { ...profile, extensions: { subagent: { allowedTargets: [], harness: "other" } } };
    await assert.rejects(createRun(value.config, "full", unknown, "Unknown harness", "task", value.root), /Unknown or unconfigured subagent harness/);
    assert.deepEqual((await readdir(value.config.stateRoot).catch(() => [])).filter(name => /^[0-9a-f-]{36}$/i.test(name)), []);
});
