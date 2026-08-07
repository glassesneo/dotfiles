import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createSubagentGetTool, createSubagentStopTool, createSubagentSubmitTool, createSubagentWaitTool } from "../extensions_src/subagent.ts";
import { openLivePreview } from "../extensions_src/utilities/subagent_preview.ts";
import { claimPendingTask, createTask, failAgent, patchAgentStatus, prepareAgent, publishAgent, readAgentSnapshot } from "../extensions_src/utilities/subagent_store.ts";
import { failStartedSubagentAgent, readReconciledAgentSnapshot, stopSubagentAgent } from "../extensions_src/utilities/subagent_management.ts";
import { inspectAgentTmux, launchAgentSession, openAgentWindow, probeTmux, stopAgentSession, unlinkAgentWindow, type CommandResult } from "../extensions_src/utilities/subagent_tmux.ts";
import { nativeConfig as config, nativeProfile as profile, nativeTmux as tmux, subagentTestRoot } from "./subagent_native_helpers.ts";

void test("tmux launch owns a dedicated session while open links and unlink only removes the view", async () => {
    const calls: string[][] = [];
    let linked = false;
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        calls.push(args);
        const command = args[0] === "-S" ? args[2] : args[0];
        if (command === "display-message" && args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (command === "display-message" && !args.includes("-t")) return { stdout: "10\t$1\tmain\t@1\t%1\t/dev/ttys001\n", stderr: "", code: 0 };
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
    for (const [name, value] of [
        ["@pi_subagent_parent_server_pid", "10"],
        ["@pi_subagent_parent_session_id", "$1"],
        ["@pi_subagent_parent_window_id", "@1"],
        ["@pi_subagent_hub_session_id", "$2"],
        ["@pi_subagent_schema", "1"],
    ]) assert.ok(calls.some(args => args.includes("set-option") && args.includes(name!) && args.includes(value!)), `${name} metadata`);
    assert.ok(calls.some(args => args.includes("link-window")));
    const selectIndex = calls.findIndex(args => args.includes("select-window") && args.includes("@2"));
    const resizeIndex = calls.findIndex(args => args.includes("resize-window") && args.includes("-A") && args.includes("@2"));
    assert.ok(selectIndex >= 0, "openAgentWindow selects the target window");
    assert.ok(resizeIndex > selectIndex, "openAgentWindow issues resize-window -A after select/link");
    assert.equal(calls.filter(args => args.includes("unlink-window") && !args.includes("-k")).length, 1);
    assert.ok(!calls.some(args => args.includes("kill-window")));
});
void test("tmux metadata failure kills the unpublished child window", async () => {
    const calls: string[][] = [];
    let alive = true;
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        calls.push(args);
        if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (args.includes("has-session")) return { stdout: "", stderr: "missing", code: 1 };
        if (args.includes("new-session")) return { stdout: "$hub\t@child\t%child\n", stderr: "", code: 0 };
        if (args.includes("set-option") && args.includes("@pi_subagent_parent_window_id")) return { stdout: "", stderr: "metadata rejected", code: 1 };
        if (args.includes("kill-window")) { alive = false; return { stdout: "", stderr: "", code: 0 }; }
        if (args.includes("list-panes")) return { stdout: alive ? "%child\t0\n" : "", stderr: "", code: 0 };
        return { stdout: "", stderr: "", code: 0 };
    };
    await assert.rejects(launchAgentSession(exec, "/tmux", { socket: "/tmp/tmux", serverPid: "10", sessionId: "$parent", sessionName: "main", windowId: "@parent", paneId: "%parent" }, {
        agentId: "550e8400-e29b-41d4-a716-446655440000", profile: "tester", originSessionId: "origin", cwd: "/work", launch: { command: "/pi", args: [], env: {} },
    }), /metadata rejected/u);
    assert.ok(calls.some(args => args.includes("kill-window") && args.includes("@child")));
    assert.ok(!calls.some(args => args.includes("@pi_subagent_schema")));
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
    const context = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$parent", sessionName: "main", windowId: "@parent", paneId: "%parent", clientName: "/dev/ttys001" };
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
    for (const key of ["Escape", "C-c"]) {
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
        socket: "/tmp/tmux", serverPid: "10", sessionId: "$parent", sessionName: "main", windowId: "@parent", paneId: "%parent", clientName: "/dev/ttys001",
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
        socket: "/tmp/tmux", serverPid: "10", sessionId: "$parent", sessionName: "main", windowId: "@parent", paneId: "%parent", clientName: "/dev/ttys001",
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
    await assert.rejects(openLivePreview(exec, "/tmux", { socket: "/tmp/other", serverPid: "99", sessionId: "$1", sessionName: "main", windowId: "@1", paneId: "%1", clientName: "/dev/ttys001" }, tmux, "preview", {
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
        socket: "/tmp/tmux", serverPid: "10", sessionId: "$parent", sessionName: "main", windowId: "@parent", paneId: "%parent", clientName: "/dev/ttys001",
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
    await assert.rejects(openLivePreview(exec, "/tmux", { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "main", windowId: "@1", paneId: "%1", clientName: "/dev/ttys001" }, tmux, "preview", {
        makeTempDirectory: async () => "/tmp/pi-preview-partial",
        removeTempDirectory: async () => {},
    }), /link failed/u);
    assert.ok(calls.some(args => args.some(arg => arg.includes("'kill-session'") && arg.includes("$view"))));
    assert.ok(!calls.some(args => args.some(arg => arg.includes("'kill-window'"))));
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
    const context = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "main", windowId: "@1", paneId: "%1" };
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
void test("reconciliation kills an orphaned linked pane when its dedicated session disappeared", async () => {
    const root = await subagentTestRoot("native-session-loss-");
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
void test("startup rollback never reports failure while the child pane is still live", async () => {
    const root = await subagentTestRoot("native-start-rollback-");
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
        const root = await subagentTestRoot(prefix);
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
void test("get rejects another origin before tmux reconciliation can mutate it", async () => {
    const root = await subagentTestRoot("native-get-origin-");
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
void test("management tools reject the calling agent before reconciliation or mutation", async () => {
    const root = await subagentTestRoot("native-self-target-");
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
    await assert.rejects(createSubagentSubmitTool(deps).execute("submit", { agentId: prepared.agentId, purpose: "again", prompt: "nope" }, undefined, undefined, ctx), /cannot target the calling agent itself/);
    await assert.rejects(createSubagentGetTool(deps).execute("get", { agentId: prepared.agentId }, undefined, undefined, ctx), /cannot target the calling agent itself/);
    await assert.rejects(createSubagentStopTool(deps).execute("stop", { agentId: prepared.agentId }, undefined, undefined, ctx), /cannot target the calling agent itself/);
    await assert.rejects(createSubagentWaitTool(deps).execute("wait", { taskIds: [task.request.taskId], condition: "all" }, undefined, undefined, ctx), /cannot wait on the calling agent's own task/);
    assert.equal(execCalls, 0);
    assert.equal(sleepCalls, 0);
    assert.equal((await readAgentSnapshot(root, prepared.agentId)).status.state, "busy");
});
