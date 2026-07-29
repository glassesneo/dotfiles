import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerSubagent } from "../extensions_src/subagent.ts";
import { registerSubagentHistoryViewer } from "../extensions_src/subagent_history_viewer.ts";
import { defaultPaletteKeymap } from "../extensions_src/utilities/command_palette_keymap.ts";
import { openSubagentHistory } from "../extensions_src/utilities/subagent_history.ts";
import { cleanupOriginAgents, readReconciledAgentSnapshot } from "../extensions_src/utilities/subagent_management.ts";
import { SubagentPaletteComponent } from "../extensions_src/utilities/subagent_palette.ts";
import { failAgent, patchAgentStatus, prepareAgent, publishAgent, readAgentSnapshot } from "../extensions_src/utilities/subagent_store.ts";
import { originHubName, type CommandResult, type TmuxContext } from "../extensions_src/utilities/subagent_tmux.ts";
import type { AgentSnapshot, TmuxAgentReference } from "../extensions_src/utilities/subagent_types.ts";

const profile = { model: "provider/model", description: "Tester", allowAllTools: false, tools: [], extensions: { subagent: { allowedTargets: [] } } };
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true };
const context: TmuxContext = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$parent", sessionName: "parent", paneId: "%parent" };
async function agent(root: string, windowId: string, paneId: string, ownership: "origin-hub" | "dedicated" = "origin-hub") {
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "work", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities });
    const tmux: TmuxAgentReference = { socket: "/tmp/tmux", serverPid: "10", sessionId: ownership === "origin-hub" ? "$hub" : `$${windowId}`, sessionName: ownership === "origin-hub" ? originHubName("origin") : `legacy-${windowId}`, windowId, paneId, windowName: `sa-${windowId}` };
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "work", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, ...(ownership === "origin-hub" ? { tmuxOwnership: ownership } : {}), capabilities, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(prepared.paths, { state: "idle", bridgeReady: true });
    return prepared;
}

void test("origin cleanup continues after one window failure, kills the current hub, and retries affected records", async () => {
    const root = await mkdtemp(join(tmpdir(), "subagent-cleanup-review-"));
    const first = await agent(root, "@1", "%1");
    await new Promise(resolve => setTimeout(resolve, 2));
    const second = await agent(root, "@2", "%2");
    let hubAlive = true;
    let firstFailure = true;
    const attemptedBeforeHub: string[] = [];
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        const command = args[2];
        if (command === "display-message") return { stdout: "10\n", stderr: "", code: 0 };
        if (command === "kill-window") {
            const target = args[args.indexOf("-t") + 1]!;
            if (hubAlive) attemptedBeforeHub.push(target);
            if (firstFailure) { firstFailure = false; return { stdout: "", stderr: "permission denied", code: 1 }; }
            return hubAlive ? { stdout: "", stderr: "", code: 0 } : { stdout: "", stderr: "can't find window", code: 1 };
        }
        if (command === "list-panes") return { stdout: hubAlive ? "%1\t0\n%2\t0\n" : "", stderr: "", code: 0 };
        if (command === "has-session") return { stdout: "", stderr: "", code: hubAlive ? 0 : 1 };
        if (command === "kill-session") { hubAlive = false; return { stdout: "", stderr: "", code: 0 }; }
        return { stdout: "", stderr: "", code: 0 };
    };
    await cleanupOriginAgents({ stateRoot: root, originSessionId: "origin", exec, tmux: "/tmux", shutdownReason: "quit", hubContext: context });
    assert.equal(new Set(attemptedBeforeHub).size, 2);
    assert.equal((await readAgentSnapshot(root, first.agentId)).status.state, "stopped");
    assert.equal((await readAgentSnapshot(root, second.agentId)).status.state, "stopped");
});

void test("current-server viewer hub is cleaned even when the origin has no origin-hub agent record", async () => {
    const root = await mkdtemp(join(tmpdir(), "subagent-viewer-owner-"));
    let killedTarget = "";
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        if (args[2] === "display-message") return { stdout: "10\n", stderr: "", code: 0 };
        if (args[2] === "kill-session") { killedTarget = args[args.indexOf("-t") + 1]!; return { stdout: "", stderr: "", code: 0 }; }
        return { stdout: "", stderr: "", code: 0 };
    };
    await cleanupOriginAgents({ stateRoot: root, originSessionId: "origin", exec, tmux: "/tmux", shutdownReason: "quit", hubContext: context });
    assert.equal(killedTarget, originHubName("origin"));
});

void test("parent lifecycle reason remains authoritative when child shutdown settles on either side of it", async () => {
    const root = await mkdtemp(join(tmpdir(), "subagent-reason-race-"));
    const prepared = await agent(root, "@1", "%1");
    await patchAgentStatus(prepared.paths, { state: "stopping" });
    await failAgent(root, prepared.agentId, "Child pi session shut down", true);
    await failAgent(root, prepared.agentId, "Parent session shut down (fork)", true, { overrideTerminalReason: true });
    await failAgent(root, prepared.agentId, "Child pi session shut down", true);
    assert.equal((await readAgentSnapshot(root, prepared.agentId)).status.exitReason, "Parent session shut down (fork)");
});

void test("a failed terminal pane query stays retryable and never triggers destructive reconciliation", async () => {
    const root = await mkdtemp(join(tmpdir(), "subagent-pane-query-"));
    const prepared = await agent(root, "@1", "%1");
    await patchAgentStatus(prepared.paths, { state: "failed", exitReason: "failed" });
    let killed = false;
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        if (args[2] === "display-message") return { stdout: "10\n", stderr: "", code: 0 };
        if (args[2] === "list-panes") return { stdout: "", stderr: "temporary failure", code: 1 };
        if (args[2] === "has-session") return { stdout: "", stderr: "", code: 0 };
        if (args[2] === "kill-window") killed = true;
        return { stdout: "", stderr: "", code: 0 };
    };
    await assert.rejects(readReconciledAgentSnapshot(exec, "/tmux", root, prepared.agentId), /temporarily unavailable/u);
    assert.equal(killed, false);
});

void test("viewer rollback retains its snapshot and surfaces cleanup failure when a live pane cannot be killed", async () => {
    const root = await mkdtemp(join(tmpdir(), "subagent-viewer-rollback-"));
    const canonical = join(root, "canonical.jsonl");
    const childId = "550e8400-e29b-41d4-a716-446655440099";
    await writeFile(canonical, `${JSON.stringify({ type: "session", version: 3, id: childId, cwd: "/work" })}\n`);
    const snapshot = { agent: { agentId: childId, profile: "tester", purpose: "work", harness: "pi", cwd: "/work", createdAt: new Date().toISOString(), profileSnapshot: profile, tmux: {} as TmuxAgentReference, tmuxOwnership: "origin-hub", capabilities, schemaVersion: 1, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, status: { schemaVersion: 1, agentId: childId, state: "stopped", bridgeReady: true, childSessionId: childId, childSessionFile: canonical, agentUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, accountedTaskIds: [], updatedAt: new Date().toISOString() } } as AgentSnapshot;
    let hubCreated = false;
    let shell = "";
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        const command = args[2];
        if (command === "display-message") return { stdout: "10\n", stderr: "", code: 0 };
        if (command === "has-session") return { stdout: "", stderr: "", code: hubCreated ? 0 : 1 };
        if (command === "new-session") { hubCreated = true; shell = args.at(-1)!; return { stdout: "$hub\t@viewer\t%viewer\n", stderr: "", code: 0 }; }
        if (command === "list-panes") return { stdout: "%viewer\t0\n", stderr: "", code: 0 };
        if (command === "list-windows") return { stdout: "@parent\n", stderr: "", code: 0 };
        if (command === "link-window") return { stdout: "", stderr: "link failed", code: 1 };
        if (command === "kill-window") return { stdout: "", stderr: "permission denied", code: 1 };
        return { stdout: "", stderr: "", code: 0 };
    };
    await assert.rejects(openSubagentHistory(exec, { tmux: "/tmux", historyViewerExtension: "/history.ts", piCommand: "/pi" }, context, snapshot), /cleanup remains incomplete.*snapshot was retained/u);
    const directory = shell.match(/PI_SUBAGENT_VIEWER_TEMP_DIR=([^']+)/u)?.[1];
    assert.ok(directory);
    await stat(directory!);
    await rm(directory!, { recursive: true, force: true });
});

void test("viewer serializes active-client polls and blocks every input source", async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    let interval: (() => void) | undefined;
    let calls = 0;
    let resolveDelayed: ((value: { stdout: string }) => void) | undefined;
    let shutdowns = 0;
    const api = { on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); }, setActiveTools() {} } as unknown as ExtensionAPI;
    registerSubagentHistoryViewer(api, { PI_SUBAGENT_VIEWER_TMUX: "/tmux", PI_SUBAGENT_VIEWER_SOCKET: "/tmp/tmux", PI_SUBAGENT_VIEWER_WINDOW_ID: "@viewer", PI_SUBAGENT_VIEWER_TEMP_DIR: "/tmp/viewer", PI_SUBAGENT_VIEWER_READY_FILE: "/tmp/viewer/.ready" }, {
        exec: async () => { calls += 1; if (calls === 1) return { stdout: "1\n" }; return new Promise(resolve => { resolveDelayed = resolve; }); },
        setInterval: ((callback: () => void) => { interval = callback; return 1 as unknown as NodeJS.Timeout; }) as typeof setInterval,
        clearInterval: (() => {}) as typeof clearInterval,
        writeReady: async () => {}, remove: async () => {},
    });
    const ctx = { shutdown() { shutdowns += 1; } } as unknown as ExtensionContext;
    await handlers.get("session_start")?.({}, ctx);
    interval?.();
    interval?.();
    assert.equal(calls, 2);
    resolveDelayed?.({ stdout: "0\n" });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(shutdowns, 1);
    const input = handlers.get("input");
    assert.ok(input);
    assert.equal((await input({ source: "rpc" })).action, "handled");
});

void test("palette Enter is disabled for terminal legacy history without probing tmux again", async () => {
    const root = await mkdtemp(join(tmpdir(), "subagent-disabled-history-"));
    const prepared = await agent(root, "@legacy", "%legacy", "dedicated");
    await patchAgentStatus(prepared.paths, { state: "failed", exitReason: "legacy failure" });
    let execCalls = 0;
    const component = new SubagentPaletteComponent({
        tui: { requestRender() {} } as never,
        theme: { fg: (_role: string, text: string) => text, bold: (text: string) => text } as never,
        ui: { confirm: async () => false }, keymap: defaultPaletteKeymap,
        deps: {
            stateRoot: root, originSessionId: "origin", tmux: "/tmux", historyViewerExtension: "/history.ts", piCommand: "/pi",
            exec: async () => { execCalls += 1; return { stdout: "", stderr: "no server running", code: 1 }; },
            setTimeout: (() => 1 as unknown as NodeJS.Timeout) as unknown as typeof setTimeout, clearTimeout: (() => {}) as typeof clearTimeout,
        }, done: () => {},
    });
    await component.refresh();
    const before = execCalls;
    await component.action("open");
    assert.equal(execCalls, before);
    component.close();
});

void test("registered parent lifecycle cleans replacement reasons while reload and child depth preserve the hub", async () => {
    const root = await mkdtemp(join(tmpdir(), "subagent-lifecycle-wiring-"));
    const configPath = join(root, "subagent.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: 5, stateRoot: join(root, "state"), tmux: "/tmux", historyViewerExtension: "/history.ts", childExtensions: ["/bridge.ts"], harnesses: { pi: { command: "/pi" } }, maxDepth: 3, childExcludedTools: ["question"] }));
    const run = async (reason: "quit" | "reload" | "new" | "resume" | "fork", depth = "0") => {
        const handlers = new Map<string, Array<(...args: any[]) => any>>();
        const eventHandlers = new Map<string, Array<(value: unknown) => void>>();
        let killed = 0;
        const pi = {
            on(name: string, handler: (...args: any[]) => any) { const values = handlers.get(name) ?? []; values.push(handler); handlers.set(name, values); },
            events: { on(name: string, handler: (value: unknown) => void) { const values = eventHandlers.get(name) ?? []; values.push(handler); eventHandlers.set(name, values); return () => {}; }, emit() {} },
            registerCommand() {}, registerTool() {}, getActiveTools: () => [],
            async exec(_command: string, args: string[]) {
                if (args[2] === "display-message" && args.at(-1) === "#{pid}\t#{session_id}\t#{session_name}\t#{pane_id}") return { stdout: "10\t$parent\tmain\t%parent\n", stderr: "", code: 0, killed: false };
                if (args[2] === "display-message") return { stdout: "10\n", stderr: "", code: 0, killed: false };
                if (args[2] === "kill-session") { killed += 1; return { stdout: "", stderr: "", code: 0, killed: false }; }
                return { stdout: "", stderr: "", code: 0, killed: false };
            },
        } as unknown as ExtensionAPI;
        await registerSubagent(pi, { configPath, env: { TMUX: "/tmp/tmux,1,0", PI_SUBAGENT_DEPTH: depth } });
        const shutdown = handlers.get("session_shutdown")?.[0];
        assert.ok(shutdown);
        await shutdown({ reason }, { cwd: "/work", sessionManager: { getSessionId: () => "origin", getSessionFile: () => undefined } });
        return killed;
    };
    for (const reason of ["quit", "new", "resume", "fork"] as const) assert.equal(await run(reason), 1, reason);
    assert.equal(await run("reload"), 0);
    assert.equal(await run("quit", "1"), 0);
});
