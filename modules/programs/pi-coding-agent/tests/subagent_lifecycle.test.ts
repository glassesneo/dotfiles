import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerSubagentChildBridge } from "../extensions_src/subagent_child_bridge.ts";
import { registerSubagentHistoryViewer } from "../extensions_src/subagent_history_viewer.ts";
import { historyAvailability, openSubagentHistory } from "../extensions_src/utilities/subagent_history.ts";
import { cleanupOriginAgents, readReconciledAgentSnapshot } from "../extensions_src/utilities/subagent_management.ts";
import { patchAgentStatus, prepareAgent, publishAgent, readAgentSnapshot } from "../extensions_src/utilities/subagent_store.ts";
import { launchAgentSession, stopAgentSession, type CommandResult, type TmuxContext } from "../extensions_src/utilities/subagent_tmux.ts";
import { tmuxOwnership, type AgentSnapshot, type TmuxAgentReference } from "../extensions_src/utilities/subagent_types.ts";

const profile = { model: "provider/model", description: "Tester", allowAllTools: false, tools: [], extensions: { subagent: { allowedTargets: [] } } };
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true };
const context: TmuxContext = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$parent", sessionName: "parent", paneId: "%parent" };
const launch = { command: "/pi", args: [], env: {} };

void test("origin hubs reuse one session, isolate origins, and stopping one window preserves its sibling", async () => {
    const sessions = new Map<string, string>();
    const panes = new Map<string, string>();
    let sequence = 0;
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        const command = args[2];
        if (command === "display-message" && args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (command === "has-session") { const target = args[args.indexOf("-t") + 1]!; return { stdout: "", stderr: "", code: [...sessions.entries()].some(([name, id]) => name === target || id === target) ? 0 : 1 }; }
        if (command === "new-session") { sequence += 1; const name = args[args.indexOf("-s") + 1]!; const id = `$${sequence}`; const window = `@${sequence}`; const pane = `%${sequence}`; sessions.set(name, id); panes.set(window, pane); return { stdout: `${id}\t${window}\t${pane}\n`, stderr: "", code: 0 }; }
        if (command === "new-window") { sequence += 1; const name = args[args.indexOf("-t") + 1]!.replace(/:$/u, ""); const window = `@${sequence}`; const pane = `%${sequence}`; panes.set(window, pane); return { stdout: `${sessions.get(name)}\t${window}\t${pane}\n`, stderr: "", code: 0 }; }
        if (command === "list-panes") return { stdout: [...panes.values()].map(pane => `${pane}\t0`).join("\n"), stderr: "", code: 0 };
        if (command === "kill-window") { panes.delete(args[args.indexOf("-t") + 1]!); return { stdout: "", stderr: "", code: 0 }; }
        return { stdout: "", stderr: "", code: 0 };
    };
    const first = await launchAgentSession(exec, "/tmux", context, { agentId: "550e8400-e29b-41d4-a716-446655440000", profile: "tester", originSessionId: "origin-a", cwd: "/work", launch });
    const sibling = await launchAgentSession(exec, "/tmux", context, { agentId: "550e8400-e29b-41d4-a716-446655440001", profile: "tester", originSessionId: "origin-a", cwd: "/work", launch });
    const other = await launchAgentSession(exec, "/tmux", context, { agentId: "550e8400-e29b-41d4-a716-446655440002", profile: "tester", originSessionId: "origin-b", cwd: "/work", launch });
    assert.equal(first.sessionId, sibling.sessionId);
    assert.notEqual(first.windowId, sibling.windowId);
    assert.notEqual(first.paneId, sibling.paneId);
    assert.notEqual(first.sessionId, other.sessionId);
    await stopAgentSession(exec, "/tmux", first);
    assert.ok(panes.has(sibling.windowId));
});

void test("parent cleanup terminalizes every origin agent with the lifecycle reason before killing the hub", async () => {
    const root = await mkdtemp(join(tmpdir(), "subagent-cleanup-"));
    const alive = new Map([["@1", "%1"], ["@2", "%2"]]);
    const calls: string[] = [];
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        const command = args[2]; calls.push(command ?? "");
        if (command === "display-message") return { stdout: "10\n", stderr: "", code: 0 };
        if (command === "kill-window") { alive.delete(args[args.indexOf("-t") + 1]!); return { stdout: "", stderr: "", code: 0 }; }
        if (command === "list-panes") return { stdout: [...alive.values()].map(pane => `${pane}\t0`).join("\n"), stderr: "", code: 0 };
        return { stdout: "", stderr: "", code: 0 };
    };
    const ids = ["550e8400-e29b-41d4-a716-446655440010", "550e8400-e29b-41d4-a716-446655440011"];
    for (const index of ids.keys()) {
        const prepared = await prepareAgent(root, { profile: "tester", purpose: "work", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities });
        const tmux: TmuxAgentReference = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$hub", sessionName: "pi-sa-hub", windowId: `@${index + 1}`, paneId: `%${index + 1}`, windowName: `sa-${index}` };
        await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "work", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, tmuxOwnership: "origin-hub", capabilities, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
        await patchAgentStatus(prepared.paths, { state: "idle", bridgeReady: true });
        ids[index] = prepared.agentId;
    }
    await cleanupOriginAgents({ stateRoot: root, originSessionId: "origin", exec, tmux: "/tmux", shutdownReason: "fork" });
    for (const id of ids) { const snapshot = await readAgentSnapshot(root, id); assert.equal(snapshot.status.state, "stopped"); assert.match(snapshot.status.exitReason ?? "", /\(fork\)/u); }
    assert.equal(calls.filter(command => command === "kill-session").length, 1);
});

void test("reconciliation removes a dead remain-on-exit window after child Pi quits", async () => {
    const root = await mkdtemp(join(tmpdir(), "subagent-dead-window-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "work", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities });
    const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$hub", sessionName: "hub", windowId: "@dead", paneId: "%dead", windowName: "sa" };
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "work", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, tmuxOwnership: "origin-hub", capabilities, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(prepared.paths, { state: "failed", bridgeReady: true, exitReason: "Child pi session shut down" });
    let killed = false;
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        const command = args[2];
        if (command === "display-message") return { stdout: "10\n", stderr: "", code: 0 };
        if (command === "has-session") return { stdout: "", stderr: "", code: 0 };
        if (command === "list-panes") return { stdout: "%dead\t1\n", stderr: "", code: 0 };
        if (command === "kill-window") { killed = true; return { stdout: "", stderr: "", code: 0 }; }
        return { stdout: "", stderr: "", code: 0 };
    };
    const reconciled = await readReconciledAgentSnapshot(exec, "/tmux", root, prepared.agentId);
    assert.equal(reconciled.status.state, "failed");
    assert.equal(killed, true);
});

void test("child bridge persists canonical child session identity before readiness", async () => {
    const root = await mkdtemp(join(tmpdir(), "subagent-identity-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "work", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities });
    const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$hub", sessionName: "hub", windowId: "@1", paneId: "%1", windowName: "sa" };
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "work", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, tmuxOwnership: "origin-hub", capabilities, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    const handlers = new Map<string, (...args: any[]) => any>();
    const api = { on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); }, sendUserMessage() {} } as unknown as ExtensionAPI;
    registerSubagentChildBridge(api, { PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_AGENT_DIR: prepared.paths.directory });
    const childFile = join(root, "child.jsonl");
    await handlers.get("session_start")?.({ reason: "startup" }, { sessionManager: { getSessionId: () => "child-id", getSessionFile: () => childFile } });
    const status = (await readAgentSnapshot(root, prepared.agentId)).status;
    assert.equal(status.childSessionId, "child-id"); assert.equal(status.childSessionFile, childFile); assert.equal(status.bridgeReady, true);
    await handlers.get("session_shutdown")?.({ reason: "reload" });
});

void test("terminal history uses an owner-only disposable copy and legacy records remain explicitly unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "subagent-history-"));
    const canonical = join(root, "canonical.jsonl");
    const childId = "550e8400-e29b-41d4-a716-446655440020";
    await writeFile(canonical, `${JSON.stringify({ type: "session", version: 3, id: childId, cwd: "/work" })}\n`);
    const snapshot = { agent: { agentId: childId, profile: "tester", purpose: "work", harness: "pi", cwd: "/work", createdAt: new Date().toISOString(), profileSnapshot: profile, tmux: {} as TmuxAgentReference, tmuxOwnership: "origin-hub", capabilities, schemaVersion: 1, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, status: { schemaVersion: 1, agentId: childId, state: "stopped", bridgeReady: true, childSessionId: childId, childSessionFile: canonical, agentUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, accountedTaskIds: [], updatedAt: new Date().toISOString() } } as AgentSnapshot;
    let shell = "";
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        const command = args[2];
        if (command === "display-message") return { stdout: "10\n", stderr: "", code: 0 };
        if (command === "has-session") return { stdout: "", stderr: "missing", code: 1 };
        if (command === "new-session") { shell = args.at(-1)!; return { stdout: "$hub\t@viewer\t%viewer\n", stderr: "", code: 0 }; }
        if (command === "list-panes") return { stdout: "%viewer\t0\n", stderr: "", code: 0 };
        if (command === "list-windows") return { stdout: "@parent\n", stderr: "", code: 0 };
        return { stdout: "", stderr: "", code: 0 };
    };
    await openSubagentHistory(exec, { tmux: "/tmux", historyViewerExtension: "/history.ts", piCommand: "/pi" }, context, snapshot, { waitUntilReady: async () => {} });
    assert.ok(!shell.includes(canonical));
    const directory = shell.match(/PI_SUBAGENT_VIEWER_TEMP_DIR=([^']+)/u)?.[1];
    assert.ok(directory);
    assert.equal((await stat(directory!)).mode & 0o777, 0o700);
    await rm(directory!, { recursive: true, force: true });
    const legacy = structuredClone(snapshot); delete legacy.status.childSessionId; delete legacy.status.childSessionFile; delete legacy.agent.tmuxOwnership;
    assert.deepEqual(historyAvailability(legacy), { available: false, reason: "history unavailable" });
    assert.equal(tmuxOwnership(legacy.agent), "dedicated");
});

void test("history viewer blocks turns and shuts down only after the final active client leaves", async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const counts = [0, 2, 1, 0];
    let interval: (() => void) | undefined;
    let shutdowns = 0;
    let removed = false;
    const api = { on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); }, setActiveTools(tools: string[]) { assert.deepEqual(tools, []); } } as unknown as ExtensionAPI;
    registerSubagentHistoryViewer(api, { PI_SUBAGENT_VIEWER_TMUX: "/tmux", PI_SUBAGENT_VIEWER_SOCKET: "/tmp/tmux", PI_SUBAGENT_VIEWER_WINDOW_ID: "@viewer", PI_SUBAGENT_VIEWER_TEMP_DIR: "/tmp/viewer", PI_SUBAGENT_VIEWER_READY_FILE: "/tmp/viewer/.ready" }, {
        exec: async () => ({ stdout: `${counts.shift() ?? 0}\n` }),
        setInterval: ((callback: () => void) => { interval = callback; return 1 as unknown as NodeJS.Timeout; }) as typeof setInterval,
        clearInterval: (() => {}) as typeof clearInterval,
        remove: (async () => { removed = true; }) as typeof rm,
        writeReady: async () => {},
    });
    const ctx = { shutdown() { shutdowns += 1; } } as unknown as ExtensionContext;
    await handlers.get("session_start")?.({ reason: "startup" }, ctx);
    const input = handlers.get("input");
    assert.ok(input);
    assert.equal((await input({ source: "interactive" })).action, "handled");
    for (let index = 0; index < 3; index += 1) { interval?.(); await new Promise(resolve => setImmediate(resolve)); }
    assert.equal(shutdowns, 1);
    await handlers.get("session_shutdown")?.({ reason: "quit" }, ctx);
    assert.equal(removed, true);
});
