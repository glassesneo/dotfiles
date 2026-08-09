import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { settledAgentDefinition } from "../extensions_src/utilities/agent_types.ts";
import { unknownAgentActivityProjection } from "../extensions_src/utilities/orchestration_activity.ts";
import { renderRunResult } from "../extensions_src/utilities/orchestration_cards.ts";
import { buildMeshDisplayTree } from "../extensions_src/utilities/orchestration_display_tree.ts";
import { openMeshHistory } from "../extensions_src/utilities/orchestration_history.ts";
import { MeshAgentsPaletteComponent, detailPaneModel } from "../extensions_src/utilities/orchestration_palette.ts";
import { openLivePreview } from "../extensions_src/utilities/orchestration_preview.ts";
import { MAX_MODEL_VISIBLE_BYTES, MAX_MODEL_VISIBLE_LINES, projectDebugSnapshot, projectMinimalAgentTask, serializeModelVisibleJson } from "../extensions_src/utilities/orchestration_projection.ts";
import { inspectMeshAgentWindow, launchAgentSession, meshHubName, stopAgentSession, type CommandResult } from "../extensions_src/utilities/orchestration_tmux.ts";
import { emptyUsage, type AgentSnapshot, type AgentState, type TaskState } from "../extensions_src/utilities/orchestration_types.ts";

const definition = settledAgentDefinition("worker");
const meshId = "11111111-1111-4111-8111-111111111111";
const epochId = "22222222-2222-4222-8222-222222222222";
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };
const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$hub", sessionName: "hub", windowId: "@child", paneId: "%child", windowName: "worker" };

function snapshot(id: string, state: AgentState, options: { parentAgentId?: string; taskState?: TaskState; createdAt?: string; sessionFile?: string; sessionId?: string } = {}): AgentSnapshot {
    const taskId = id.replace(/^./u, "b"); const prompt = "Implement retained behavior\nfull detail"; const taskState = options.taskState ?? (state === "failed" ? "failed" : "succeeded"); const terminal = taskState === "succeeded" || taskState === "failed" || taskState === "stopped";
    return {
        agent: { schemaVersion: 1, meshId, agentId: id, epochId, agent: "worker", harness: "pi", cwd: "/work", createdAt: options.createdAt ?? id, agentSnapshot: definition, launchEnvelope: "/envelope", launchEnvelopeDigest: "digest", tmux, capabilities, creatorSessionId: "creator", ...(options.parentAgentId ? { parentAgentId: options.parentAgentId } : {}) },
        status: { schemaVersion: 1, meshId, agentId: id, state, bridgeReady: true, meshToolsEnabled: true, agentUsage: emptyUsage(), accountedTaskIds: [], updatedAt: options.createdAt ?? id, ...(options.sessionFile ? { childSessionFile: options.sessionFile } : {}), ...(options.sessionId ? { childSessionId: options.sessionId } : {}) },
        activity: unknownAgentActivityProjection(),
        stop: null,
        task: { request: { schemaVersion: 1, meshId, agentId: id, taskId, prompt, createdAt: options.createdAt ?? id }, status: { schemaVersion: 1, meshId, agentId: id, taskId, state: taskState, createdAt: options.createdAt ?? id, ...(terminal ? { finishedAt: options.createdAt ?? id } : {}) }, result: terminal ? { schemaVersion: 1, meshId, agentId: id, taskId, outcome: taskState, output: "done", usage: emptyUsage(), turns: 1, interventions: [], startedAt: options.createdAt ?? id, finishedAt: options.createdAt ?? id } : null, interventions: [], claimed: false, directory: "/task" },
    };
}

void test("mesh tmux launch records mesh hub identity and canonical metadata in order", async () => {
    const calls: string[][] = [];
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        calls.push(args);
        if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (args.includes("has-session")) return { stdout: "", stderr: "missing", code: 1 };
        if (args.includes("new-session")) return { stdout: "$mesh-hub\t@mesh-window\t%mesh-pane\n", stderr: "", code: 0 };
        return { stdout: "", stderr: "", code: 0 };
    };
    const launched = await launchAgentSession(exec, "/tmux", { socket: "/tmp/tmux", serverPid: "10", sessionId: "$parent", sessionName: "main", windowId: "@parent", paneId: "%parent" }, { meshId, epochId, agentId: "550e8400-e29b-41d4-a716-446655440000", agent: "worker", cwd: "/work", launch: { command: "/pi", args: [], env: {} } });
    assert.deepEqual({ sessionId: launched.sessionId, sessionName: launched.sessionName, windowId: launched.windowId, paneId: launched.paneId }, { sessionId: "$mesh-hub", sessionName: meshHubName(meshId), windowId: "@mesh-window", paneId: "%mesh-pane" });
    const metadata = calls.filter(args => args.includes("set-option") && args.some(value => value.startsWith("@pi_mesh_"))).map(args => args.slice(-2));
    assert.deepEqual(metadata, [["@pi_mesh_parent_server_pid", "10"], ["@pi_mesh_parent_session_id", "$parent"], ["@pi_mesh_parent_window_id", "@parent"], ["@pi_mesh_hub_session_id", "$mesh-hub"], ["@pi_mesh_id", meshId], ["@pi_mesh_agent_id", "550e8400-e29b-41d4-a716-446655440000"], ["@pi_mesh_epoch_id", epochId], ["@pi_mesh_schema", "1"]]);
});

void test("reservation tmux evidence distinguishes unknown inspection, incomplete metadata, and definitive absence", async () => {
    const agentId = "550e8400-e29b-41d4-a716-446655440000"; const context = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$parent", sessionName: "main", windowId: "@parent", paneId: "%parent" };
    assert.equal(await inspectMeshAgentWindow(async () => ({ stdout: "", stderr: "", code: 1 }), "/tmux", null, meshId, agentId), "unknown");
    const inspect = (windows: string, listCode = 0) => inspectMeshAgentWindow(async (_command, args) => args.at(-1) === "#{pid}" ? { stdout: "10\n", stderr: "", code: 0 } : { stdout: windows, stderr: listCode ? "inspection failed" : "", code: listCode }, "/tmux", context, meshId, agentId);
    assert.equal(await inspect(`${meshId}\t\t0\tmesh-worker-other\n`), "unknown");
    assert.equal(await inspect(`${meshId}\t\t0\tmesh-worker-${agentId}\n`), "live");
    assert.equal(await inspect(""), "absent");
    assert.equal(await inspect("", 2), "unknown");
});

void test("tmux stop does not mutate a server whose recorded identity no longer matches", async () => {
    const calls: string[][] = []; const exec = async (_command: string, args: string[]): Promise<CommandResult> => { calls.push(args); return { stdout: "99\n", stderr: "", code: 0 }; };
    assert.equal(await stopAgentSession(exec, "/tmux", tmux), false); assert.equal(calls.some(args => args.includes("kill-window")), false);
});

void test("mesh display tree promotes a live descendant through a terminal parent without changing record lineage", () => {
    const root = snapshot("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "busy", { taskState: "running", createdAt: "2026-01-01T00:00:00Z" });
    const middle = snapshot("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "stopped", { parentAgentId: root.agent.agentId, createdAt: "2026-01-01T00:01:00Z" });
    const child = snapshot("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "busy", { parentAgentId: middle.agent.agentId, taskState: "running", createdAt: "2026-01-01T00:02:00Z" });
    const tree = buildMeshDisplayTree([child, middle, root], ["May"]); const childNode = tree.byId.get(child.agent.agentId)!;
    assert.deepEqual(tree.roots.map(node => node.agentId), [root.agent.agentId]); assert.deepEqual(tree.roots[0]?.children.map(node => node.agentId), [middle.agent.agentId, child.agent.agentId]);
    assert.deepEqual({ promoted: childNode.promoted, viaHandle: childNode.viaHandle, ghost: childNode.ghost, recordParent: childNode.snapshot.agent.parentAgentId }, { promoted: true, viaHandle: tree.handles.get(middle.agent.agentId), ghost: false, recordParent: middle.agent.agentId });
});

void test("mesh cards retain machine identity, state, and task order within terminal width", () => {
    const value = snapshot("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "idle"); const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };
    const lines = renderRunResult({ content: [], details: value } as never, { expanded: true } as never, theme as never, { lastComponent: undefined, args: { agent: "worker", prompt: "Implement retained behavior" } }).render(120); const text = lines.join("\n");
    assert.ok(text.indexOf(value.agent.agentId) < text.indexOf(value.task!.request.taskId)); assert.match(text, /IDLE/u); assert.match(text, /SUCCEEDED/u); for (const line of lines) assert.ok(visibleWidth(line) <= 120);
    const detail = detailPaneModel({ ...value, task: undefined }); assert.equal(detail.title, "Agent"); assert.ok(detail.body.indexOf(value.agent.agent) < detail.body.indexOf(definition.instructions));
});

void test("model-visible projection truncates content while preserving machine fields and task order", () => {
    const tasks = Array.from({ length: 128 }, (_, index) => ({ agentId: `agent-${index.toString().padStart(3, "0")}`, taskId: `task-${index.toString().padStart(3, "0")}`, agent: "worker", agentState: "idle", taskState: "succeeded", output: `${"界".repeat(600)}\n`.repeat(30) }));
    const text = serializeModelVisibleJson({ outcome: "completed", tasks }); const projected = JSON.parse(text) as { outcome: string; tasks: Array<{ agentId: string; taskId: string; agentState: string; taskState: string; outputTruncated?: boolean }> };
    assert.ok(Buffer.byteLength(text, "utf8") <= MAX_MODEL_VISIBLE_BYTES); assert.ok(text.split(/\r\n|\r|\n/u).length <= MAX_MODEL_VISIBLE_LINES);
    assert.equal(projected.outcome, "completed"); assert.equal(projected.tasks.length, tasks.length); assert.deepEqual(projected.tasks.map(task => task.agentId), tasks.map(task => task.agentId)); assert.ok(projected.tasks.every(task => task.agentState === "idle" && task.taskState === "succeeded")); assert.ok(projected.tasks.some(task => task.outputTruncated));
});

void test("model-visible stop projection keeps one fixed nullable shape without internal fields", () => {
    const value = snapshot("abababab-abab-4bab-8bab-abababababab", "stopping");
    value.stop = { schemaVersion: 1, meshId, agentId: value.agent.agentId, stopRequestId: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd", state: "terminating", source: "gc-pressure", requesterEndpointId: "internal:endpoint", reason: "capacity", activitySequence: 7, gcPassId: "efefefef-efef-4efe-8efe-efefefefefef", previousAgentState: "idle", requestedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:01Z", terminatingAt: "2026-01-01T00:00:01Z", noticeCreatedAt: "2026-01-01T00:00:02Z" };
    const expected = { stopRequestId: value.stop.stopRequestId, state: "terminating", source: "gc-pressure", reason: "capacity", requestedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:01Z", terminatingAt: "2026-01-01T00:00:01Z", confirmedAt: null, failedAt: null, failureCategory: null };
    assert.deepEqual(projectMinimalAgentTask(value).stop, expected);
    assert.deepEqual(projectDebugSnapshot(value).stop, expected);
});

void test("history and preview reject unsafe identity before allocating tmux state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mesh-history-safety-")); const sessionFile = join(directory, "session.jsonl"); await writeFile(sessionFile, `${JSON.stringify({ type: "session", id: "canonical" })}\n`);
    const historyCalls: string[][] = []; const historyExec = async (_command: string, args: string[]): Promise<CommandResult> => { historyCalls.push(args); return { stdout: "", stderr: "", code: 0 }; };
    await assert.rejects(openMeshHistory(historyExec, { tmux: "/tmux", historyViewerExtension: "/viewer", piCommand: "/pi" }, { socket: "/tmp/tmux", serverPid: "10", sessionId: "$parent", sessionName: "main", windowId: "@parent", paneId: "%parent", clientName: "client" }, snapshot("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "stopped", { sessionFile, sessionId: "different" })), /identity/u);
    assert.deepEqual(historyCalls, []);
    let allocated = false;
    await assert.rejects(openLivePreview(async () => ({ stdout: "", stderr: "", code: 0 }), "/tmux", { socket: "/tmp/tmux", serverPid: "10", sessionId: "$parent", sessionName: "main", windowId: "@parent", paneId: "%parent" }, tmux, "preview", { makeTempDirectory: async () => { allocated = true; return directory; } }), /client/u);
    assert.equal(allocated, false);
});

void test("palette delegates stop authority with mesh identity and preserves the stopped result over a stale refresh", async () => {
    const live = snapshot("ffffffff-ffff-4fff-8fff-ffffffffffff", "busy", { taskState: "running" }); const stopped = snapshot(live.agent.agentId, "stopped", { taskState: "stopped" }); const stopRequests: unknown[] = []; const discoveries: unknown[] = [];
    const component = new MeshAgentsPaletteComponent({
        tui: { terminal: { rows: 24 }, requestRender() {} } as never,
        theme: { fg: (_role: string, text: string) => text, bg: (_role: string, text: string) => text, bold: (text: string) => text } as never,
        ui: { input: async () => "  planned cleanup  ", confirm: async () => true }, keymap: {} as never,
        deps: { meshId, exec: async () => ({ stdout: "", stderr: "", code: 0 }), tmux: "/tmux", historyViewerExtension: "/viewer", piCommand: "/pi", natureHandleWords: ["May"], discover: async identity => { discoveries.push(identity); return { agents: [live], malformedCount: 0 }; }, stopAgent: async request => { stopRequests.push(request); return stopped; }, setTimeout: (() => ({}) as NodeJS.Timeout) as unknown as typeof setTimeout, clearTimeout: (() => {}) as typeof clearTimeout },
        done() {},
    });
    component.replaceAgents([live]); await component.action("stop");
    assert.deepEqual(stopRequests, [{ meshId, agentId: live.agent.agentId, reason: "planned cleanup" }]); assert.deepEqual(discoveries, [{ meshId }]); assert.equal(component.selected()?.status.state, "stopped"); component.dispose();
});

// Given cancelled, blank, or oversized Pi-native reason input, when it crosses the Palette action boundary, no stop occurs and the same Palette selection/focus is retained.
void test("palette reason validation cancels safely and preserves focus and selection", async () => {
    const live = snapshot("abababab-abab-4bab-8bab-abababababab", "idle");
    for (const input of [undefined, "   ", "界".repeat(171)]) {
        let stops = 0; let confirms = 0;
        const component = new MeshAgentsPaletteComponent({ tui: { terminal: { rows: 24 }, requestRender() {} } as never, theme: { fg: (_role: string, text: string) => text, bg: (_role: string, text: string) => text, bold: (text: string) => text } as never, ui: { input: async () => input, confirm: async () => { confirms += 1; return true; } }, keymap: {} as never, deps: { meshId, exec: async () => ({ stdout: "", stderr: "", code: 0 }), tmux: "/tmux", historyViewerExtension: "/viewer", piCommand: "/pi", natureHandleWords: ["May"], discover: async () => ({ agents: [live], malformedCount: 0 }), stopAgent: async () => { stops += 1; return live; }, setTimeout: (() => ({}) as NodeJS.Timeout) as unknown as typeof setTimeout, clearTimeout: (() => {}) as typeof clearTimeout }, done() {} });
        component.replaceAgents([live]); component.focused = true; const selected = component.selectedAgentId; await component.action("stop"); assert.equal(stops, 0); assert.equal(confirms, 0); assert.equal(component.selectedAgentId, selected); assert.equal(component.focused, true); component.dispose();
    }
});
