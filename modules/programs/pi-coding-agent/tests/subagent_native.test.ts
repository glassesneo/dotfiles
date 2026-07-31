import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSubagentChildBridge } from "../extensions_src/subagent_child_bridge.ts";
import { createSubagentGetTool, createSubagentSendTool, createSubagentStopTool, createSubagentWaitTool } from "../extensions_src/subagent.ts";
import { defaultPaletteKeymap } from "../extensions_src/utilities/command_palette_keymap.ts";
import { mapConcurrent } from "../extensions_src/utilities/subagent_concurrency.ts";
import { piLaunchDescriptor } from "../extensions_src/utilities/subagent_pi.ts";
import { withRunLock } from "../extensions_src/utilities/subagent_lock.ts";
import { SubagentPaletteComponent } from "../extensions_src/utilities/subagent_palette.ts";
import { openLivePreview } from "../extensions_src/utilities/subagent_preview.ts";
import { claimPendingTask, claimTaskUsage, createTask, failAgent, finishTask, markAgentStopping, markBridgeReady, patchAgentStatus, prepareAgent, publishAgent, readAgentSnapshot, reconcileOriginUsageClaims, recordIdleUsage, recordIntervention, taskPaths } from "../extensions_src/utilities/subagent_store.ts";
import { failStartedSubagentAgent, readReconciledAgentSnapshot, stopSubagentAgent } from "../extensions_src/utilities/subagent_management.ts";
import { inspectAgentTmux, launchAgentSession, openAgentWindow, probeTmux, stopAgentSession, unlinkAgentWindow, type CommandResult } from "../extensions_src/utilities/subagent_tmux.ts";
import type { AgentSnapshot, SubagentRuntimeConfig, TmuxAgentReference } from "../extensions_src/utilities/subagent_types.ts";
const profile = { model: "provider/model", availability: ["top-level", "subagent"] as ("top-level" | "subagent")[], description: "Tester", allowAllTools: false, tools: ["read"], extensions: { subagent: { allowedTargets: [] } } };
const config = (root: string): SubagentRuntimeConfig => ({ schemaVersion: 7, stateRoot: root, tmux: "/tmux", historyViewerExtension: "/history-viewer.ts", childExtensions: ["/profile.ts", "/bridge.ts"], harnesses: { pi: { adapter: "pi-native", command: "/pi" } }, maxDepth: 3, childExcludedTools: ["question"], natureHandleWords: ["Maple", "Cedar"] });
const tmux: TmuxAgentReference = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$2", sessionName: "pi-sa-test", windowId: "@2", paneId: "%2", windowName: "sa-test" };
void test("bounded concurrency preserves order without exceeding its worker limit", async () => {
    let active = 0;
    let maximum = 0;
    const values = await mapConcurrent(Array.from({ length: 40 }, (_, index) => index), 4, async value => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise(resolve => setImmediate(resolve));
        active -= 1;
        return value * 2;
    });
    assert.equal(maximum, 4);
    assert.deepEqual(values, Array.from({ length: 40 }, (_, index) => index * 2));
});
void test("run lock reclaims an aged ownerless directory without waiting for the retry ceiling", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-ownerless-lock-"));
    const lock = join(root, ".lock");
    await mkdir(lock, { mode: 0o700 });
    const old = new Date(Date.now() - 5000);
    await utimes(lock, old, old);
    const started = performance.now();
    assert.equal(await withRunLock(root, async () => "claimed"), "claimed");
    assert.ok(performance.now() - started < 1000);
});
void test("agent store separates persistent agent and sequential task identities", async () => { const root = await mkdtemp(join(tmpdir(), "native-agent-")); const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } }); await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }); await (await import("../extensions_src/utilities/subagent_store.ts")).patchAgentStatus(prepared.paths, { state: "idle", bridgeReady: true }); const first = await createTask(root, prepared.agentId, "first", "inspect"); assert.notEqual(first.request.taskId, prepared.agentId); await claimPendingTask(root, prepared.agentId); await recordIntervention(root, prepared.agentId, { taskId: first.request.taskId, text: "also check tests", deliveryMode: "steer", images: [] }); assert.equal((await readAgentSnapshot(root, prepared.agentId, first.request.taskId)).task?.interventions[0]?.text, "also check tests"); await finishTask(root, prepared.agentId, first.request.taskId, { outcome: "succeeded", output: "done", turns: 1 }); assert.equal((await readAgentSnapshot(root, prepared.agentId)).status.state, "idle"); const second = await createTask(root, prepared.agentId, "again", "retest"); assert.notEqual(second.request.taskId, first.request.taskId); const terminal = await readAgentSnapshot(root, prepared.agentId, first.request.taskId); assert.equal(terminal.task?.result?.interventions[0]?.text, "also check tests"); });
void test("diagnostic event failures do not orphan committed task transitions", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-event-failure-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(prepared.paths, { state: "idle" });
    await chmod(prepared.paths.events, 0o400);
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    assert.equal(task.status.state, "created");
    assert.equal((await claimPendingTask(root, prepared.agentId))?.status.state, "running");
    await finishTask(root, prepared.agentId, task.request.taskId, { outcome: "succeeded" });
    assert.equal((await readAgentSnapshot(root, prepared.agentId, task.request.taskId)).status.state, "idle");
});
void test("busy agents reject sends without creating another task", async () => { const root = await mkdtemp(join(tmpdir(), "native-busy-")); const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } }); await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }); await (await import("../extensions_src/utilities/subagent_store.ts")).patchAgentStatus(prepared.paths, { state: "idle" }); const first = await createTask(root, prepared.agentId, "first", "inspect"); await assert.rejects(createTask(root, prepared.agentId, "second", "queue me"), new RegExp(`busy.*${first.request.taskId}`)); });
void test("pi adapter launches an interactive saved session with the bridge and no JSON flags", () => { const launch = piLaunchDescriptor(config("/state"), { agentId: "a", agentDirectory: "/state/agents/a", profile: "tester", profileSnapshot: profile, depth: 1, originSessionId: "origin" }); assert.equal(launch.command, "/pi"); assert.ok(launch.args.includes("--session-dir")); assert.ok(launch.args.includes("/bridge.ts")); assert.ok(!launch.args.includes("--mode") && !launch.args.includes("--print") && !launch.args.includes("--no-session")); });
void test("tmux launch owns a dedicated session while open links and unlink only removes the view", async () => {
    const calls: string[][] = [];
    let linked = false;
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        calls.push(args);
        const command = args[0] === "-S" ? args[2] : args[0];
        if (command === "display-message" && args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (command === "display-message" && !args.includes("-t")) return { stdout: "10\t$1\tmain\t%1\t/dev/ttys001\n", stderr: "", code: 0 };
        if (command === "has-session") return { stdout: "", stderr: "missing", code: 1 };
        if (command === "new-session") return { stdout: "$2\t@2\t%2\n", stderr: "", code: 0 };
        if (command === "display-message") return { stdout: "0\n", stderr: "", code: 0 };
        if (command === "list-panes") return { stdout: "%2\t0\n", stderr: "", code: 0 };
        if (command === "list-windows") return { stdout: linked ? "@1\n@2\n" : "@1\n", stderr: "", code: 0 };
        if (command === "link-window") linked = true;
        if (command === "unlink-window") linked = false;
        return { stdout: "", stderr: "", code: 0 };
    };
    const context = await probeTmux(exec, "/tmux", { TMUX: "/tmp/tmux,1,0" });
    assert.ok(context);
    assert.equal(context.clientName, "/dev/ttys001");
    const launched = await launchAgentSession(exec, "/tmux", context!, {
        agentId: "550e8400-e29b-41d4-a716-446655440000", profile: "tester", originSessionId: "origin", cwd: "/work",
        launch: { command: "/pi", args: [], env: {} },
    });
    await openAgentWindow(exec, "/tmux", context!, launched);
    await unlinkAgentWindow(exec, "/tmux", context!, launched);
    await unlinkAgentWindow(exec, "/tmux", context!, launched);
    assert.ok(calls.some(args => args.includes("new-session")));
    assert.ok(calls.some(args => args.includes("link-window")));
    const selectIndex = calls.findIndex(args => args.includes("select-window") && args.includes("@2"));
    const resizeIndex = calls.findIndex(args => args.includes("resize-window") && args.includes("-A") && args.includes("@2"));
    assert.ok(selectIndex >= 0, "openAgentWindow selects the target window");
    assert.ok(resizeIndex > selectIndex, "openAgentWindow issues resize-window -A after select/link");
    assert.equal(calls.filter(args => args.includes("unlink-window") && !args.includes("-k")).length, 1);
    assert.ok(!calls.some(args => args.includes("kill-window")));
});
void test("live preview isolates one target, uses a read-only 80% popup, and cleans every temporary layer", async () => {
    const calls: string[][] = [];
    const removed: string[] = [];
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        calls.push(args);
        if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (args.includes("list-panes")) return { stdout: "%2\t0\n", stderr: "", code: 0 };
        if (args.includes("new-session") && args.includes("-f")) return { stdout: "$wrapper\n", stderr: "", code: 0 };
        if (args.some(arg => arg.includes("'new-session'"))) return { stdout: "$view\t@scratch\n", stderr: "", code: 0 };
        if (args.includes("display-popup")) return { stdout: "", stderr: "", code: 129 };
        return { stdout: "", stderr: "", code: 0 };
    };
    const context = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$parent", sessionName: "main", paneId: "%parent", clientName: "/dev/ttys001" };
    const disposition = await openLivePreview(exec, "/tmux", context, tmux, "Maple · Esc back · Enter open full", {
        makeTempDirectory: async () => "/tmp/pi-preview-test",
        removeTempDirectory: async path => { removed.push(path); },
        markerExists: async () => false,
        uniqueId: () => "fixed",
    });
    assert.equal(disposition, "dismissed");
    const popup = calls.find(args => args.includes("display-popup"));
    assert.ok(popup);
    assert.ok(popup.includes("80%"));
    assert.ok(popup.includes("Maple · Esc back · Enter open full"));
    assert.ok(popup.includes("/dev/ttys001"));
    assert.ok(!popup.includes("%parent"));
    assert.ok(calls.some(args => args.some(arg => arg.includes("list-clients") && arg.includes("resize-window -A") && arg.includes("#{client_width} #{client_height}") && arg.includes("resize-window -x \"$1\" -y \"$2\"") && arg.includes("$view") && arg.includes("@2") && arg.includes("env -u TMUX -u TMUX_PANE") && arg.includes("attach-session -r"))));
    assert.ok(calls.some(args => args.includes("bind-key") && args.includes("Enter") && args.includes("\\;") && args.includes("detach-client")));
    for (const key of ["Escape", "C-c", "q"]) {
        assert.ok(calls.some(args => args.includes("bind-key") && args.includes(key) && args.includes("detach-client")));
    }
    assert.ok(calls.some(args => args.some(arg => arg.includes("'link-window'") && arg.includes(tmux.windowId))));
    assert.ok(calls.some(args => args.some(arg => arg.includes("'kill-window'") && arg.includes("$view:@scratch"))));
    assert.ok(calls.some(args => args.some(arg => arg.includes("'kill-session'") && arg.includes("$view"))));
    assert.ok(calls.some(args => args.includes("kill-server")));
    assert.ok(!calls.some(args => args.some(arg => arg.includes("'kill-window'") && arg.includes(tmux.windowId))));
    assert.deepEqual(removed, ["/tmp/pi-preview-test"]);
});

void test("live preview returns open-full only after marker-present cleanup completes", async () => {
    const calls: string[][] = [];
    const removed: string[] = [];
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        calls.push(args);
        if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (args.includes("list-panes")) return { stdout: "%2\t0\n", stderr: "", code: 0 };
        if (args.includes("new-session") && args.includes("-f")) return { stdout: "$wrapper\n", stderr: "", code: 0 };
        if (args.some(arg => arg.includes("'new-session'"))) return { stdout: "$view\t@scratch\n", stderr: "", code: 0 };
        return { stdout: "", stderr: "", code: 0 };
    };
    const disposition = await openLivePreview(exec, "/tmux", {
        socket: "/tmp/tmux", serverPid: "10", sessionId: "$parent", sessionName: "main", paneId: "%parent", clientName: "/dev/ttys001",
    }, tmux, "preview", {
        makeTempDirectory: async () => "/tmp/pi-preview-promote",
        removeTempDirectory: async path => { removed.push(path); },
        markerExists: async () => true,
    });
    assert.equal(disposition, "open-full");
    assert.ok(calls.some(args => args.includes("kill-server")));
    assert.ok(calls.some(args => args.some(arg => arg.includes("'kill-session'") && arg.includes("$view"))));
    assert.deepEqual(removed, ["/tmp/pi-preview-promote"]);
});

void test("target death detaches the popup wrapper and completes preview cleanup", async () => {
    const calls: string[][] = [];
    let finishPopup!: (result: CommandResult) => void;
    const popup = new Promise<CommandResult>(resolve => { finishPopup = resolve; });
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        calls.push(args);
        if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (args.includes("list-panes")) return { stdout: "%2\t0\n", stderr: "", code: 0 };
        if (args.includes("new-session") && args.includes("-f")) return { stdout: "$wrapper\n", stderr: "", code: 0 };
        if (args.some(arg => arg.includes("'new-session'"))) return { stdout: "$view\t@scratch\n", stderr: "", code: 0 };
        if (args.includes("display-popup")) return popup;
        if (args.includes("kill-server")) finishPopup({ stdout: "", stderr: "", code: 0 });
        return { stdout: "", stderr: "", code: 0 };
    };
    const disposition = await openLivePreview(exec, "/tmux", {
        socket: "/tmp/tmux", serverPid: "10", sessionId: "$parent", sessionName: "main", paneId: "%parent", clientName: "/dev/ttys001",
    }, tmux, "preview", {
        makeTempDirectory: async () => "/tmp/pi-preview-target-exit",
        removeTempDirectory: async () => {},
        markerExists: async () => false,
        sleep: async () => {},
        inspectTarget: async () => ({ server: "match", paneAlive: false, paneState: "dead", sessionAlive: true }),
    });
    assert.equal(disposition, "dismissed");
    assert.ok(calls.some(args => args.includes("kill-server")));
    assert.ok(calls.some(args => args.some(arg => arg.includes("'kill-session'") && arg.includes("$view"))));
    assert.ok(!calls.some(args => args.some(arg => arg.includes("'kill-window'") && arg.includes(tmux.windowId))));
});

void test("live preview rejects a mismatched server before allocating resources", async () => {
    const calls: string[][] = [];
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => { calls.push(args); return { stdout: "", stderr: "", code: 0 }; };
    await assert.rejects(openLivePreview(exec, "/tmux", { socket: "/tmp/other", serverPid: "99", sessionId: "$1", sessionName: "main", paneId: "%1", clientName: "/dev/ttys001" }, tmux, "preview", {
        makeTempDirectory: async () => "/tmp/pi-preview-mismatch",
        removeTempDirectory: async () => {},
    }), /different tmux server/u);
    assert.ok(!calls.some(args => args.includes("new-session")));
    assert.ok(!calls.some(args => args.includes("kill-window")));
});

void test("preview allocation refuses mutations after tmux server identity replacement", async () => {
    const calls: string[][] = [];
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        calls.push(args);
        if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (args.includes("list-panes")) return { stdout: "%2\t0\n", stderr: "", code: 0 };
        if (args.includes("has-session")) return { stdout: "", stderr: "", code: 0 };
        if (args.includes("if-shell")) return { stdout: "__pi_tmux_server_identity_changed__\n", stderr: "", code: 0 };
        return { stdout: "", stderr: "", code: 0 };
    };
    await assert.rejects(openLivePreview(exec, "/tmux", {
        socket: "/tmp/tmux", serverPid: "10", sessionId: "$parent", sessionName: "main", paneId: "%parent", clientName: "/dev/ttys001",
    }, tmux, "preview", {
        makeTempDirectory: async () => "/tmp/pi-preview-replaced-server",
        removeTempDirectory: async () => {},
    }), /server identity changed before preview mutation/u);
    assert.ok(!calls.some(args => args.some(arg => arg.includes("'link-window'"))));
});

void test("partial preview allocation removes its canonical view without killing the agent window", async () => {
    const calls: string[][] = [];
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        calls.push(args);
        if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (args.includes("list-panes")) return { stdout: "%2\t0\n", stderr: "", code: 0 };
        if (args.some(arg => arg.includes("'new-session'"))) return { stdout: "$view\t@scratch\n", stderr: "", code: 0 };
        if (args.some(arg => arg.includes("'link-window'"))) return { stdout: "", stderr: "link failed", code: 1 };
        return { stdout: "", stderr: "", code: 0 };
    };
    await assert.rejects(openLivePreview(exec, "/tmux", { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "main", paneId: "%1", clientName: "/dev/ttys001" }, tmux, "preview", {
        makeTempDirectory: async () => "/tmp/pi-preview-partial",
        removeTempDirectory: async () => {},
    }), /link failed/u);
    assert.ok(calls.some(args => args.some(arg => arg.includes("'kill-session'") && arg.includes("$view"))));
    assert.ok(!calls.some(args => args.some(arg => arg.includes("'kill-window'"))));
});

void test("palette refresh owns one timer and close cancels polling", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-palette-timer-"));
    let nextTimer = 0;
    const timers = new Map<number, () => void>();
    let done = 0;
    const component = new SubagentPaletteComponent({
        tui: { requestRender() {} } as never,
        theme: { fg: (_role: string, text: string) => text, bg: (_role: string, text: string) => text, bold: (text: string) => text } as never,
        ui: { confirm: async () => false },
        keymap: defaultPaletteKeymap,
        deps: {
            stateRoot: root, originSessionId: "origin", tmux: "/tmux", historyViewerExtension: "/history-viewer.ts", piCommand: "/pi", natureHandleWords: ["Maple", "Cedar"], exec: async () => ({ stdout: "", stderr: "", code: 1 }),
            setTimeout: ((callback: () => void) => { nextTimer += 1; timers.set(nextTimer, callback); return nextTimer; }) as unknown as typeof setTimeout,
            clearTimeout: ((timer: number) => { timers.delete(timer); }) as unknown as typeof clearTimeout,
        },
        done: () => { done += 1; },
    });
    await component.refresh();
    assert.equal(timers.size, 1);
    await component.refresh();
    assert.equal(timers.size, 1);
    component.close();
    component.close();
    assert.equal(timers.size, 0);
    assert.equal(done, 1);
});
void test("child bridge defers parent task delivery until an idle human turn settles and preserves model failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-bridge-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    const handlers = new Map<string, (event?: Record<string, unknown>) => unknown>();
    const delivered: string[] = [];
    const api = { on(name: string, handler: (event?: Record<string, unknown>) => unknown) { handlers.set(name, handler); }, events: { on() { return () => {}; } }, sendUserMessage(prompt: string) { delivered.push(prompt); } } as unknown as ExtensionAPI;
    assert.equal(registerSubagentChildBridge(api, { PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_AGENT_DIR: prepared.paths.directory }), true);
    await handlers.get("session_start")?.({});
    await handlers.get("input")?.({ source: "interactive", text: "human turn", images: [] });
    const task = await createTask(root, prepared.agentId, "parent", "parent task");
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.deepEqual(delivered, []);
    assert.equal((await readAgentSnapshot(root, prepared.agentId, task.request.taskId)).task?.status.state, "created");
    await handlers.get("agent_settled")?.({});
    assert.deepEqual(delivered, ["parent task"]);
    await handlers.get("message_end")?.({ message: { role: "assistant", content: [{ type: "text", text: "provider failed" }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "error", errorMessage: "provider unavailable" } });
    await handlers.get("agent_settled")?.({});
    const failed = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
    assert.equal(failed.task?.status.state, "failed");
    assert.equal(failed.task?.result?.error, "provider unavailable");
    const truncatedTask = await createTask(root, prepared.agentId, "truncated", "produce a long answer");
    await new Promise(resolve => setTimeout(resolve, 150));
    await handlers.get("message_end")?.({ message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "length" } });
    await handlers.get("agent_settled")?.({});
    const truncated = await readAgentSnapshot(root, prepared.agentId, truncatedTask.request.taskId);
    assert.equal(truncated.task?.status.state, "failed");
    assert.match(truncated.task?.result?.error ?? "", /token limit/u);
    await handlers.get("session_shutdown")?.({});
});
void test("child bridge retries task-delivery failure persistence after session-start dispatch rejects", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-bridge-delivery-retry-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    const handlers = new Map<string, (event?: Record<string, unknown>) => unknown>();
    const api = { on(name: string, handler: (event?: Record<string, unknown>) => unknown) { handlers.set(name, handler); }, events: { on() { return () => {}; } }, sendUserMessage() { throw new Error("delivery rejected"); } } as unknown as ExtensionAPI;
    let attempts = 0;
    const injectedFinish: typeof finishTask = async (...args) => { attempts += 1; if (attempts === 1) throw new Error("persistence rejected"); return finishTask(...args); };
    registerSubagentChildBridge(api, { PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_AGENT_DIR: prepared.paths.directory }, { finishTask: injectedFinish, retryIntervalMs: 5 });
    try {
        await assert.rejects(Promise.resolve(handlers.get("session_start")?.({})), /persistence rejected/u);
        const deadline = Date.now() + 1000;
        while ((await readAgentSnapshot(root, prepared.agentId, task.request.taskId)).task?.status.state !== "failed" && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        const repaired = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
        assert.equal(repaired.status.state, "idle");
        assert.equal(repaired.task?.status.state, "failed");
        assert.match(repaired.task?.result?.error ?? "", /delivery rejected/u);
        assert.ok(attempts >= 2);
    } finally { await handlers.get("session_shutdown")?.({}); }
});
void test("child bridge terminalizes an asynchronously rejected delivery that emits no Pi events", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-bridge-async-delivery-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    const handlers = new Map<string, (event?: Record<string, unknown>) => unknown>();
    const api = { on(name: string, handler: (event?: Record<string, unknown>) => unknown) { handlers.set(name, handler); }, events: { on() { return () => {}; } }, sendUserMessage() {} } as unknown as ExtensionAPI;
    registerSubagentChildBridge(api, { PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_AGENT_DIR: prepared.paths.directory }, { retryIntervalMs: 5, deliveryAckTimeoutMs: 20 });
    try {
        await handlers.get("session_start")?.({ reason: "startup" });
        await handlers.get("input")?.({ source: "extension", text: "inspect" });
        const deadline = Date.now() + 1000;
        while ((await readAgentSnapshot(root, prepared.agentId, task.request.taskId)).task?.status.state !== "failed" && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        const failed = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
        assert.equal(failed.status.state, "idle");
        assert.equal(failed.task?.status.state, "failed");
        assert.match(failed.task?.result?.error ?? "", /did not accept/u);
    } finally { await handlers.get("session_shutdown")?.({ reason: "quit" }); }
});
void test("child bridge reload fails only the active task and replacement bridge remains usable", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-bridge-reload-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    const first = await createTask(root, prepared.agentId, "first", "inspect");
    const handlers = new Map<string, (event?: Record<string, unknown>) => unknown>();
    const delivered: string[] = [];
    const api = { on(name: string, handler: (event?: Record<string, unknown>) => unknown) { handlers.set(name, handler); }, events: { on() { return () => {}; } }, sendUserMessage(prompt: string) { delivered.push(prompt); } } as unknown as ExtensionAPI;
    registerSubagentChildBridge(api, { PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_AGENT_DIR: prepared.paths.directory });
    await handlers.get("session_start")?.({ reason: "startup" });
    await handlers.get("input")?.({ source: "extension", text: "inspect" });
    await handlers.get("session_shutdown")?.({ reason: "reload" });
    const reloaded = await readAgentSnapshot(root, prepared.agentId, first.request.taskId);
    assert.equal(reloaded.status.state, "idle");
    assert.equal(reloaded.task?.status.state, "failed");
    assert.match(reloaded.task?.result?.error ?? "", /replaced \(reload\)/u);
    registerSubagentChildBridge(api, { PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_AGENT_DIR: prepared.paths.directory });
    await handlers.get("session_start")?.({ reason: "reload" });
    const second = await createTask(root, prepared.agentId, "second", "retest");
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(delivered.at(-1), "retest");
    await handlers.get("input")?.({ source: "extension", text: "retest" });
    await handlers.get("message_end")?.({ message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
    await handlers.get("agent_settled")?.({});
    assert.equal((await readAgentSnapshot(root, prepared.agentId, second.request.taskId)).task?.status.state, "succeeded");
    await handlers.get("session_shutdown")?.({ reason: "quit" });
});
void test("usage claims recover when the parent tool result was not persisted", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-claim-"));
    const sessionFile = join(root, "parent.jsonl");
    await writeFile(sessionFile, "");
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin", originSessionFile: sessionFile }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin", originSessionFile: sessionFile });
    await (await import("../extensions_src/utilities/subagent_store.ts")).patchAgentStatus(prepared.paths, { state: "idle" });
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    await claimPendingTask(root, prepared.agentId);
    await finishTask(root, prepared.agentId, task.request.taskId, { outcome: "succeeded" });
    assert.equal((await claimTaskUsage(root, prepared.agentId, task.request.taskId, "origin", sessionFile, "call-a", "subagent_get")).created, true);
    assert.equal((await claimTaskUsage(root, prepared.agentId, task.request.taskId, "origin", sessionFile, "call-b", "subagent_get")).created, false);
    const childSessionFile = join(root, "child.jsonl");
    await writeFile(childSessionFile, "");
    assert.equal(await reconcileOriginUsageClaims(root, "origin", childSessionFile), 0);
    assert.equal((await claimTaskUsage(root, prepared.agentId, task.request.taskId, "origin", sessionFile, "call-still-owned", "subagent_get")).created, false);
    assert.equal(await reconcileOriginUsageClaims(root, "origin", sessionFile), 1);
    assert.equal((await claimTaskUsage(root, prepared.agentId, task.request.taskId, "origin", sessionFile, "call-c", "subagent_get")).created, true);
    await writeFile(sessionFile, `${JSON.stringify({ type: "message", message: { role: "toolResult", details: { accounting: { claimedTaskIds: [task.request.taskId] } } } })}\n`);
    assert.equal(await reconcileOriginUsageClaims(root, "origin", sessionFile), 0);
    assert.equal((await claimTaskUsage(root, prepared.agentId, task.request.taskId, "origin", sessionFile, "call-d", "subagent_get")).created, false);
});
void test("tmux cleanup and stop use the recorded socket and refuse a reused server identity", async () => {
    const calls: string[][] = [];
    let allocatedName = "";
    let allocatedAlive = true;
    const malformed = async (_command: string, args: string[]): Promise<CommandResult> => {
        calls.push(args);
        if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (args.includes("new-session")) { allocatedName = args[args.indexOf("-n") + 1]!; return { stdout: "malformed\n", stderr: "", code: 0 }; }
        if (args.includes("list-windows")) return { stdout: `$2\t@sibling\t%sibling\tsa-other-valid-agent\n$2\t@2\t%2\t${allocatedName}\n`, stderr: "", code: 0 };
        if (args.includes("kill-window")) { allocatedAlive = false; return { stdout: "", stderr: "", code: 0 }; }
        if (args.includes("list-panes")) return { stdout: allocatedAlive ? "%2\t0\n" : "", stderr: "", code: 0 };
        if (args.includes("has-session")) return { stdout: "", stderr: "missing", code: 1 };
        return { stdout: "", stderr: "", code: 0 };
    };
    const context = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "main", paneId: "%1" };
    await assert.rejects(launchAgentSession(malformed, "/tmux", context, { agentId: "550e8400-e29b-41d4-a716-446655440000", profile: "tester", originSessionId: "origin", cwd: "/work", launch: { command: "/pi", args: [], env: {} } }), /canonical IDs/u);
    assert.ok(calls.some(args => args.includes("kill-window") && args.includes("@2")));
    assert.ok(!calls.some(args => args.includes("kill-session")));
    assert.ok(!calls.some(args => args.includes("kill-window") && args.includes("@sibling")));
    const wrongServerCalls: string[][] = [];
    const wrongServer = async (_command: string, args: string[]): Promise<CommandResult> => { wrongServerCalls.push(args); return { stdout: "99\n", stderr: "", code: 0 }; };
    assert.equal(await stopAgentSession(wrongServer, "/tmux", tmux), false);
    assert.ok(!wrongServerCalls.some(args => args.includes("kill-window")));
    assert.ok(wrongServerCalls.every(args => args[0] === "-S" && args[1] === tmux.socket));
});
void test("pane liveness requires the exact stored pane ID", async () => {
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (args.includes("list-panes")) return { stdout: "%9\t0\n%2\t1\n", stderr: "", code: 0 };
        if (args.includes("has-session")) return { stdout: "", stderr: "", code: 0 };
        return { stdout: "", stderr: "", code: 0 };
    };
    const inspected = await inspectAgentTmux(exec, "/tmux", tmux);
    assert.equal(inspected.sessionAlive, true);
    assert.equal(inspected.paneAlive, false);
});
void test("stop kills the globally linked window and verifies the child pane exited", async () => {
    const calls: string[][] = [];
    let alive = true;
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        calls.push(args);
        if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (args.includes("kill-window")) { alive = false; return { stdout: "", stderr: "", code: 0 }; }
        if (args.includes("#{pane_id}\t#{pane_dead}")) return alive ? { stdout: "%2\t0\n", stderr: "", code: 0 } : { stdout: "", stderr: "", code: 0 };
        return { stdout: "", stderr: "", code: 0 };
    };
    assert.equal(await stopAgentSession(exec, "/tmux", tmux), true);
    assert.ok(calls.some(args => args.includes("kill-window") && args.includes(tmux.windowId)));
    assert.ok(!calls.some(args => args.includes("kill-session")));
});
void test("agent usage totals include parent tasks and idle human-originated turns", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-agent-usage-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await (await import("../extensions_src/utilities/subagent_store.ts")).patchAgentStatus(prepared.paths, { state: "idle" });
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    await claimPendingTask(root, prepared.agentId);
    await finishTask(root, prepared.agentId, task.request.taskId, { outcome: "succeeded", usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10, reasoning: 5, cacheWrite1h: 6, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } } });
    await recordIdleUsage(root, prepared.agentId, { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, totalTokens: 100, reasoning: 50, cacheWrite1h: 60, cost: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, total: 100 } });
    const total = (await readAgentSnapshot(root, prepared.agentId)).status.agentUsage;
    assert.deepEqual(total, { input: 11, output: 22, cacheRead: 33, cacheWrite: 44, totalTokens: 110, reasoning: 55, cacheWrite1h: 66, cost: { input: 11, output: 22, cacheRead: 33, cacheWrite: 44, total: 110 } });
});
void test("terminal task replay repairs agent usage exactly once after a partial completion commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-partial-completion-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await (await import("../extensions_src/utilities/subagent_store.ts")).patchAgentStatus(prepared.paths, { state: "idle" });
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    const running = await claimPendingTask(root, prepared.agentId);
    assert.ok(running);
    const usage = { input: 7, output: 8, cacheRead: 9, cacheWrite: 10, totalTokens: 34, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } };
    const files = taskPaths(root, prepared.agentId, task.request.taskId);
    const finishedAt = new Date().toISOString();
    await writeFile(files.result, `${JSON.stringify({ schemaVersion: 1, agentId: prepared.agentId, taskId: task.request.taskId, outcome: "succeeded", output: "done", usage, turns: 1, interventions: [], startedAt: running!.status.startedAt, finishedAt })}\n`);
    await writeFile(files.status, `${JSON.stringify({ ...running!.status, state: "succeeded", finishedAt })}\n`);
    assert.equal((await readAgentSnapshot(root, prepared.agentId)).status.agentUsage.input, 0);
    await finishTask(root, prepared.agentId, task.request.taskId, { outcome: "succeeded" });
    await finishTask(root, prepared.agentId, task.request.taskId, { outcome: "succeeded" });
    const repaired = (await readAgentSnapshot(root, prepared.agentId)).status;
    assert.equal(repaired.agentUsage.input, 7);
    assert.deepEqual(repaired.accountedTaskIds, [task.request.taskId]);
});
void test("replaying an old completion preserves a newer active task", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-old-completion-replay-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(prepared.paths, { state: "idle" });
    const first = await createTask(root, prepared.agentId, "first", "inspect");
    await claimPendingTask(root, prepared.agentId);
    await finishTask(root, prepared.agentId, first.request.taskId, { outcome: "succeeded" });
    const second = await createTask(root, prepared.agentId, "second", "retest");
    await finishTask(root, prepared.agentId, first.request.taskId, { outcome: "succeeded" });
    const replayed = await readAgentSnapshot(root, prepared.agentId, second.request.taskId);
    assert.equal(replayed.status.state, "busy");
    assert.equal(replayed.status.activeTaskId, second.request.taskId);
    assert.equal(replayed.task?.status.state, "created");
});
void test("Stop wins a concurrent successful settle without exposing idle or a successful active task", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-stop-settle-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    const store = await import("../extensions_src/utilities/subagent_store.ts");
    await store.patchAgentStatus(prepared.paths, { state: "idle" });
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    await claimPendingTask(root, prepared.agentId);
    await store.patchAgentStatus(prepared.paths, { state: "stopping" });
    const settled = await finishTask(root, prepared.agentId, task.request.taskId, { outcome: "succeeded", output: "too late" });
    const stopping = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
    assert.equal(settled.outcome, "stopped");
    assert.equal(stopping.status.state, "stopping");
    assert.equal(stopping.task?.status.state, "stopped");
    await assert.rejects(createTask(root, prepared.agentId, "late", "must not start"), /stopping/u);
    await failAgent(root, prepared.agentId, "Stopped by parent", true);
    assert.equal((await readAgentSnapshot(root, prepared.agentId, task.request.taskId)).status.state, "stopped");
});
void test("bridge readiness preserves an initial task that became busy before readiness was committed", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-ready-race-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    await markBridgeReady(prepared.paths);
    const snapshot = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
    assert.equal(snapshot.status.bridgeReady, true);
    assert.equal(snapshot.status.state, "busy");
    assert.equal(snapshot.status.activeTaskId, task.request.taskId);
    assert.equal((await claimPendingTask(root, prepared.agentId))?.request.taskId, task.request.taskId);
});
void test("Stop overrides a result-only provisional success before the task terminal transition", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-result-stop-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    const store = await import("../extensions_src/utilities/subagent_store.ts");
    await store.patchAgentStatus(prepared.paths, { state: "idle" });
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    const running = await claimPendingTask(root, prepared.agentId);
    const files = taskPaths(root, prepared.agentId, task.request.taskId);
    await writeFile(files.result, `${JSON.stringify({ schemaVersion: 1, agentId: prepared.agentId, taskId: task.request.taskId, outcome: "succeeded", output: "provisional", usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 7, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, turns: 1, interventions: [], startedAt: running!.status.startedAt, finishedAt: new Date().toISOString() })}\n`);
    await store.patchAgentStatus(prepared.paths, { state: "stopping" });
    const result = await finishTask(root, prepared.agentId, task.request.taskId, { outcome: "succeeded" });
    const snapshot = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
    assert.equal(result.outcome, "stopped");
    assert.equal(snapshot.task?.status.state, "stopped");
    assert.equal(snapshot.status.state, "stopping");
    assert.equal(snapshot.status.agentUsage.input, 3);
});
void test("reconciliation kills an orphaned linked pane when its dedicated session disappeared", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-session-loss-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await (await import("../extensions_src/utilities/subagent_store.ts")).patchAgentStatus(prepared.paths, { state: "idle" });
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    await claimPendingTask(root, prepared.agentId);
    let paneAlive = true;
    const calls: string[][] = [];
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => { calls.push(args); if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("has-session")) return { stdout: "", stderr: "missing", code: 1 }; if (args.includes("kill-window")) { paneAlive = false; return { stdout: "", stderr: "", code: 0 }; } if (args.includes("#{pane_id}\t#{pane_dead}")) return paneAlive ? { stdout: "%2\t0\n", stderr: "", code: 0 } : { stdout: "", stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; };
    const reconciled = await readReconciledAgentSnapshot(exec, "/tmux", root, prepared.agentId, task.request.taskId);
    assert.equal(reconciled.status.state, "failed");
    assert.equal(reconciled.task?.status.state, "failed");
    assert.ok(calls.some(args => args.includes("kill-window")));
});
void test("Stop intent cannot overwrite a concurrent terminal transition", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-stop-terminal-race-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(prepared.paths, { state: "idle" });
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    await failAgent(root, prepared.agentId, "child failed");
    const stopping = await markAgentStopping(prepared.paths);
    assert.equal(stopping.state, "failed");
    assert.equal((await readAgentSnapshot(root, prepared.agentId, task.request.taskId)).task?.status.state, "failed");
});
void test("failed Stop restores a live agent instead of reporting a false terminal state", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-stop-error-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(prepared.paths, { state: "idle" });
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => { if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("kill-window")) return { stdout: "", stderr: "permission denied", code: 1 }; if (args.includes("has-session")) return { stdout: "", stderr: "", code: 0 }; if (args.includes("#{pane_id}\t#{pane_dead}")) return { stdout: "%2\t0\n", stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; };
    await assert.rejects(stopSubagentAgent({ stateRoot: root, agentId: prepared.agentId, originSessionId: "origin", exec, tmux: "/tmux" }), /permission denied/u);
    assert.equal((await readAgentSnapshot(root, prepared.agentId)).status.state, "idle");
});
void test("startup rollback never reports failure while the child pane is still live", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-start-rollback-"));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(prepared.paths, { state: "idle" });
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => { if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("kill-window")) return { stdout: "", stderr: "permission denied", code: 1 }; if (args.includes("list-panes")) return { stdout: "%2\t0\n", stderr: "", code: 0 }; if (args.includes("has-session")) return { stdout: "", stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; };
    await assert.rejects(failStartedSubagentAgent({ stateRoot: root, agentId: prepared.agentId, originSessionId: "origin", exec, tmux: "/tmux" }, "startup failed"), /permission denied/u);
    const retained = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
    assert.equal(retained.status.state, "busy");
    assert.equal(retained.task?.status.state, "created");
    await failAgent(root, prepared.agentId, "premature terminal state");
    await assert.rejects(failStartedSubagentAgent({ stateRoot: root, agentId: prepared.agentId, originSessionId: "origin", exec, tmux: "/tmux" }, "startup failed"), /permission denied/u);
    assert.equal((await readAgentSnapshot(root, prepared.agentId)).status.state, "stopping");
});
void test("complete tmux server loss terminalizes get and Stop while an ambiguous probe remains retryable", async () => {
    const absent = async (): Promise<CommandResult> => ({ stdout: "", stderr: "no server running on /tmp/tmux", code: 1 });
    const unavailable = async (): Promise<CommandResult> => ({ stdout: "", stderr: "temporary command failure", code: 1 });
    const setup = async (prefix: string) => {
        const root = await mkdtemp(join(tmpdir(), prefix));
        const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
        await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
        await patchAgentStatus(prepared.paths, { state: "idle" });
        const task = await createTask(root, prepared.agentId, "first", "inspect");
        await claimPendingTask(root, prepared.agentId);
        return { root, prepared, task };
    };
    const lostForGet = await setup("native-server-loss-get-");
    const failed = await readReconciledAgentSnapshot(absent, "/tmux", lostForGet.root, lostForGet.prepared.agentId, lostForGet.task.request.taskId);
    assert.equal(failed.status.state, "failed");
    assert.equal(failed.task?.status.state, "failed");
    const lostForStop = await setup("native-server-loss-stop-");
    const stopped = await stopSubagentAgent({ stateRoot: lostForStop.root, agentId: lostForStop.prepared.agentId, originSessionId: "origin", exec: absent, tmux: "/tmux" });
    assert.equal(stopped.status.state, "stopped");
    assert.equal(stopped.task?.status.state, "stopped");
    const transient = await setup("native-server-transient-");
    await assert.rejects(readReconciledAgentSnapshot(unavailable, "/tmux", transient.root, transient.prepared.agentId), /temporarily unavailable/u);
    assert.equal((await readAgentSnapshot(transient.root, transient.prepared.agentId)).status.state, "busy");
});
void test("child bridge autonomously retries every interrupted completion phase", async () => {
    for (const phase of ["before-result", "result", "accounting", "task-status", "agent-final"] as const) {
        const root = await mkdtemp(join(tmpdir(), `native-completion-${phase}-`));
        const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
        await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
        const task = await createTask(root, prepared.agentId, "first", "inspect");
        const handlers = new Map<string, (event?: Record<string, unknown>) => unknown>();
        const api = { on(name: string, handler: (event?: Record<string, unknown>) => unknown) { handlers.set(name, handler); }, events: { on() { return () => {}; } }, sendUserMessage() {} } as unknown as ExtensionAPI;
        let attempts = 0;
        const injectedFinish: typeof finishTask = async (stateRoot, agentId, taskId, input) => {
            attempts += 1;
            if (attempts > 1) return finishTask(stateRoot, agentId, taskId, input);
            if (phase === "before-result") throw new Error("injected before result");
            const snapshot = await readAgentSnapshot(stateRoot, agentId, taskId);
            const files = taskPaths(stateRoot, agentId, taskId);
            const finishedAt = new Date().toISOString();
            const result = { schemaVersion: 1 as const, agentId, taskId, outcome: input.outcome, output: input.output ?? "", usage: input.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, turns: input.turns ?? 0, interventions: [], startedAt: snapshot.task!.status.startedAt!, finishedAt, ...(input.error ? { error: input.error } : {}) };
            await writeFile(files.result, `${JSON.stringify(result)}\n`);
            if (phase === "result") throw new Error("injected after result");
            await patchAgentStatus(prepared.paths, { agentUsage: result.usage, accountedTaskIds: [taskId] });
            if (phase === "accounting") throw new Error("injected after accounting");
            await writeFile(files.status, `${JSON.stringify({ ...snapshot.task!.status, state: input.outcome, finishedAt })}\n`);
            if (phase === "task-status") throw new Error("injected after task status");
            await patchAgentStatus(prepared.paths, { state: "idle", activeTaskId: undefined });
            throw new Error("injected after final agent status");
        };
        registerSubagentChildBridge(api, { PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_AGENT_DIR: prepared.paths.directory }, { finishTask: injectedFinish, retryIntervalMs: 5 });
        try {
            await handlers.get("session_start")?.({});
            await handlers.get("message_end")?.({ message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } });
            await assert.rejects(Promise.resolve(handlers.get("agent_settled")?.({})), /injected/u);
            const deadline = Date.now() + 1000;
            while (((await readAgentSnapshot(root, prepared.agentId, task.request.taskId)).status.state !== "idle" || attempts < 2) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
            const repaired = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
            assert.equal(repaired.status.state, "idle", phase);
            assert.equal(repaired.task?.status.state, "succeeded", phase);
            assert.equal(repaired.status.agentUsage.input, 2, phase);
            assert.deepEqual(repaired.status.accountedTaskIds, [task.request.taskId], phase);
            assert.ok(attempts >= 2, phase);
        } finally { await handlers.get("session_shutdown")?.({}); }
    }
});
void test("get rejects another origin before tmux reconciliation can mutate it", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-get-origin-"));
    const configPath = join(root, "subagent.json");
    await writeFile(configPath, JSON.stringify(config(root)));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "other-origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "other-origin" });
    await patchAgentStatus(prepared.paths, { state: "idle" });
    await createTask(root, prepared.agentId, "first", "inspect");
    let execCalls = 0;
    const exec = async (): Promise<CommandResult> => { execCalls += 1; return { stdout: "", stderr: "no server running on /tmp/tmux", code: 1 }; };
    const ctx = { sessionManager: { getSessionId: () => "caller-origin", getSessionFile: () => join(root, "caller.jsonl") } } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;
    await assert.rejects(createSubagentGetTool({ configPath, env: {}, exec }).execute("get-call", { agentId: prepared.agentId }, undefined, undefined, ctx), /different origin/u);
    assert.equal(execCalls, 0);
    assert.equal((await readAgentSnapshot(root, prepared.agentId)).status.state, "busy");
});
void test("wait hides a provisional result until task status is terminal", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-wait-detail-"));
    const configPath = join(root, "subagent.json");
    await writeFile(configPath, JSON.stringify(config(root)));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(prepared.paths, { state: "idle" });
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    const running = await claimPendingTask(root, prepared.agentId);
    const files = taskPaths(root, prepared.agentId, task.request.taskId);
    await writeFile(files.result, `${JSON.stringify({ schemaVersion: 1, agentId: prepared.agentId, taskId: task.request.taskId, outcome: "succeeded", output: "provisional", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, turns: 1, interventions: [], startedAt: running!.status.startedAt, finishedAt: new Date().toISOString() })}\n`);
    let clock = 0;
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => { if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("has-session")) return { stdout: "", stderr: "", code: 0 }; if (args.includes("#{pane_id}\t#{pane_dead}")) return { stdout: "%2\t0\n", stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; };
    const response = await createSubagentWaitTool({ configPath, env: {}, exec, now: () => { clock += 1000; return clock; } }).execute("wait-call", { taskIds: [task.request.taskId], condition: "all", timeoutSeconds: 1 }, undefined, undefined, { sessionManager: { getSessionId: () => "origin", getSessionFile: () => undefined } } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext) as { content: Array<{ text: string }>; details: { outcome: string; agents: Array<{ task: { result: unknown } }> } };
    const content = JSON.parse(response.content[0]!.text) as { outcome: string; tasks: Array<{ output?: string }> };
    assert.equal(content.outcome, "timeout");
    assert.equal(content.tasks[0]!.output, undefined);
    assert.equal(response.details.agents[0]!.task.result, null);
});
void test("wait partial updates skip usage claims and final results use outcome", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-wait-outcome-"));
    const configPath = join(root, "subagent.json");
    await writeFile(configPath, JSON.stringify(config(root)));
    const firstAgent = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(firstAgent.paths, { agentId: firstAgent.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(firstAgent.paths, { state: "idle" });
    const first = await createTask(root, firstAgent.agentId, "first", "inspect");
    await claimPendingTask(root, firstAgent.agentId);
    const secondAgent = await prepareAgent(root, { profile: "tester", purpose: "second", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(secondAgent.paths, { agentId: secondAgent.agentId, profile: "tester", purpose: "second", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux: { ...tmux, sessionId: "$3", windowId: "@3", paneId: "%3", windowName: "sa-second" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(secondAgent.paths, { state: "idle" });
    const second = await createTask(root, secondAgent.agentId, "second", "still running");
    await claimPendingTask(root, secondAgent.agentId);
    let polls = 0;
    let clock = 0;
    const updates: Array<{ claimed: string[]; outcome?: string }> = [];
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (args.includes("has-session")) return { stdout: "", stderr: "", code: 0 };
        if (args.includes("#{pane_id}\t#{pane_dead}")) return { stdout: "%2\t0\n%3\t0\n", stderr: "", code: 0 };
        return { stdout: "", stderr: "", code: 0 };
    };
    const response = await createSubagentWaitTool({
        configPath, env: {}, exec,
        now: () => clock,
        sleep: async () => {
            polls += 1;
            if (polls === 1) {
                await finishTask(root, firstAgent.agentId, first.request.taskId, { outcome: "succeeded", output: "done", usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
            }
            clock += 500;
        },
    }).execute(
        "wait-any",
        { taskIds: [second.request.taskId, first.request.taskId], condition: "any", timeoutSeconds: 5 },
        undefined,
        value => {
            const details = value.details as { outcome?: string; accounting: { claimedTaskIds: string[] } };
            updates.push({ claimed: [...details.accounting.claimedTaskIds], outcome: details.outcome });
        },
        { sessionManager: { getSessionId: () => "origin", getSessionFile: () => undefined } } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext,
    ) as { content: Array<{ text: string }>; details: { outcome: string; accounting: { claimedTaskIds: string[] }; agents: AgentSnapshot[] }; usage?: { input: number } };
    const content = JSON.parse(response.content[0]!.text) as { outcome: string; tasks: Array<{ taskId?: string; output?: string }>; reason?: string; agents?: unknown };
    assert.equal(content.outcome, "completed");
    assert.equal(content.reason, undefined);
    assert.equal(content.agents, undefined);
    assert.deepEqual(content.tasks.map(task => task.taskId), [second.request.taskId, first.request.taskId]);
    assert.equal(content.tasks[0]!.output, undefined);
    assert.equal(content.tasks[1]!.output, "done");
    assert.equal(response.details.outcome, "completed");
    assert.deepEqual(response.details.accounting.claimedTaskIds, [first.request.taskId]);
    assert.equal(response.usage?.input, 2);
    assert.ok(updates.length >= 1);
    assert.ok(updates.every(update => update.claimed.length === 0 && update.outcome === undefined));
});
void test("management tools reject the calling agent before reconciliation or mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-self-target-"));
    const configPath = join(root, "subagent.json");
    await writeFile(configPath, JSON.stringify(config(root)));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(prepared.paths, { state: "idle", bridgeReady: true });
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    let execCalls = 0;
    let sleepCalls = 0;
    const exec = async (): Promise<CommandResult> => { execCalls += 1; return { stdout: "", stderr: "", code: 0 }; };
    const sleep = async () => { sleepCalls += 1; };
    const env = { PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_ORIGIN_SESSION_ID: "origin" };
    const ctx = { sessionManager: { getSessionId: () => "origin", getSessionFile: () => undefined } } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;
    const deps = { configPath, env, exec, sleep };
    await assert.rejects(createSubagentSendTool(deps).execute("send", { agentId: prepared.agentId, purpose: "again", prompt: "nope" }, undefined, undefined, ctx), /cannot target the calling agent itself/);
    await assert.rejects(createSubagentGetTool(deps).execute("get", { agentId: prepared.agentId }, undefined, undefined, ctx), /cannot target the calling agent itself/);
    await assert.rejects(createSubagentStopTool(deps).execute("stop", { agentId: prepared.agentId }, undefined, undefined, ctx), /cannot target the calling agent itself/);
    await assert.rejects(createSubagentWaitTool(deps).execute("wait", { taskIds: [task.request.taskId], condition: "all", timeoutSeconds: 1 }, undefined, undefined, ctx), /cannot wait on the calling agent's own task/);
    assert.equal(execCalls, 0);
    assert.equal(sleepCalls, 0);
    assert.equal((await readAgentSnapshot(root, prepared.agentId)).status.state, "busy");
});
