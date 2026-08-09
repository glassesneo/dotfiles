import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createMeshEnableTool, createMeshGetTool, createMeshRouteTool, createMeshRunTool, createMeshStopTool, createMeshSubmitTool, createMeshWaitTool, type OrchestrationDependencies } from "../extensions_src/orchestration.ts";
import { settledAgentDefinition } from "../extensions_src/utilities/agent_types.ts";
import { unknownAgentActivityProjection } from "../extensions_src/utilities/orchestration_activity.ts";
import { MESH_PEER_TOOL_NAMES } from "../extensions_src/utilities/orchestration_pi.ts";
import { emptyUsage, type AgentSnapshot } from "../extensions_src/utilities/orchestration_types.ts";

const agentId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const eventId = "33333333-3333-4333-8333-333333333333";
const watchId = "44444444-4444-4444-8444-444444444444";
const prompt = "Inspect the migration boundary without changing behavior\nprivate prompt continuation";
const output = "private completed output";
const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };
const deps: OrchestrationDependencies = { configPath: "/unused/config.json", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }), natureHandleWords: () => ["Fern"] };
const definition = settledAgentDefinition("worker");
const usage = emptyUsage();

function snapshot(id = agentId, idTask = taskId): AgentSnapshot {
    return {
        agent: { schemaVersion: 1, meshId: "55555555-5555-4555-8555-555555555555", agentId: id, epochId: "66666666-6666-4666-8666-666666666666", agent: "worker", harness: "pi", cwd: "/private/worktree", createdAt: "2026-01-01T00:00:00Z", agentSnapshot: definition, launchEnvelope: "/private/envelope.json", launchEnvelopeDigest: "digest", tmux: { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true }, creatorSessionId: "creator" },
        status: { schemaVersion: 1, meshId: "55555555-5555-4555-8555-555555555555", agentId: id, state: "idle", bridgeReady: true, meshToolsEnabled: true, agentUsage: usage, accountedTaskIds: [], updatedAt: "2026-01-01T00:02:00Z", childSessionFile: "/private/session.jsonl" },
        activity: unknownAgentActivityProjection(),
        stop: null,
        task: { request: { schemaVersion: 1, meshId: "55555555-5555-4555-8555-555555555555", agentId: id, taskId: idTask, prompt, createdAt: "2026-01-01T00:00:00Z" }, status: { schemaVersion: 1, meshId: "55555555-5555-4555-8555-555555555555", agentId: id, taskId: idTask, state: "succeeded", createdAt: "2026-01-01T00:00:00Z", startedAt: "2026-01-01T00:00:10Z", finishedAt: "2026-01-01T00:01:00Z" }, result: { schemaVersion: 1, meshId: "55555555-5555-4555-8555-555555555555", agentId: id, taskId: idTask, outcome: "succeeded", output, usage, turns: 2, interventions: [], startedAt: "2026-01-01T00:00:10Z", finishedAt: "2026-01-01T00:01:00Z" }, interventions: [{ taskId: idTask, sequence: 1, deliveryMode: "steer", text: "check edge", timestamp: "2026-01-01T00:00:20Z", images: [] }], claimed: false, directory: "/private/task" },
    };
}

function render(component: { render(width: number): string[] } | undefined, width = 100): string {
    assert.ok(component);
    const lines = component.render(width);
    for (const line of lines) assert.ok(visibleWidth(line) <= width, `line exceeds ${width}: ${line}`);
    return lines.join("\n");
}

const pi = {
    getAllTools: () => [], getActiveTools: () => [], setActiveTools() {},
} as never;

function tools() {
    return [
        { name: "mesh_run", tool: createMeshRunTool(deps, { worker: definition }), args: { agent: "worker", prompt }, details: snapshot() },
        { name: "mesh_submit", tool: createMeshSubmitTool(deps, { worker: definition }), args: { agentId, prompt }, details: { ...snapshot(), accounting: { claimedTaskIds: [] } } },
        { name: "mesh_get", tool: createMeshGetTool(deps), args: { agentId }, details: snapshot() },
        { name: "mesh_wait", tool: createMeshWaitTool(deps), args: { taskIds: [taskId, "77777777-7777-4777-8777-777777777777"], condition: "all" }, details: { condition: "all", outcome: "completed", agents: [snapshot(), snapshot("88888888-8888-4888-8888-888888888888", "77777777-7777-4777-8777-777777777777")], accounting: { claimedTaskIds: [] } } },
        { name: "mesh_stop", tool: createMeshStopTool(deps), args: { taskId }, details: { ...snapshot(), stopDisposition: "stopped-now" } },
        { name: "mesh_route", tool: createMeshRouteTool(deps), args: { action: "watch", receiver: "parent", delivery: "followUp", taskIds: [taskId], condition: "all" }, details: { watchId } },
        { name: "mesh_enable", tool: createMeshEnableTool(pi, deps, async () => {}), args: {}, details: { enabled: true, activeTools: ["read", ...MESH_PEER_TOOL_NAMES] } },
    ] as const;
}

// Given structured Pi call and result details, the composed mesh row shows its operation once and keeps result state distinct from the invocation.
void test("real mesh tool definitions compose concise collapsed rows without repeated operation headings", () => {
    for (const item of tools()) {
        assert.equal(typeof item.tool.renderCall, "function", `${item.name} renderCall`);
        assert.equal(typeof item.tool.renderResult, "function", `${item.name} renderResult`);
        const call = render(item.tool.renderCall?.(item.args as never, theme as never, { args: item.args, lastComponent: undefined, expanded: false } as never));
        const result = render(item.tool.renderResult?.({ content: [], details: item.details } as never, { expanded: false } as never, theme as never, { args: item.args, lastComponent: undefined } as never));
        assert.match(call, new RegExp(item.name, "u"));
        assert.doesNotMatch(result, new RegExp(item.name, "u"));
        assert.equal([...`${call}\n${result}`.matchAll(new RegExp(item.name, "gu"))].length, 1);
        assert.doesNotMatch(`${call}\n${result}`, /11111111-1111|\/private\/|private completed output|private prompt continuation|2026-01-01|tokens/u);
        render(item.tool.renderCall?.(item.args as never, theme as never, { args: item.args, lastComponent: undefined, expanded: false } as never), 18);
        render(item.tool.renderResult?.({ content: [], details: item.details } as never, { expanded: false } as never, theme as never, { args: item.args, lastComponent: undefined } as never), 18);
    }
    const values = tools();
    assert.match(render(values[0].tool.renderResult?.({ content: [], details: values[0].details } as never, { expanded: false } as never, theme as never, { args: values[0].args } as never)), /Fern.*worker.*IDLE.*activity:unknown.*NOT ACCEPTING.*SUCCEEDED.*Inspect the migration\s+boundary/u);
    assert.match(render(values[1].tool.renderCall?.(values[1].args as never, theme as never, { args: values[1].args, expanded: false } as never)), /mesh_submit.*reused agent/u);
    assert.match(render(values[1].tool.renderResult?.({ content: [], details: values[1].details } as never, { expanded: false } as never, theme as never, { args: values[1].args } as never)), /Fern.*worker.*IDLE.*SUCCEEDED/u);
    assert.match(render(values[3].tool.renderResult?.({ content: [], details: values[3].details } as never, { expanded: false } as never, theme as never, { args: values[3].args } as never)), /COMPLETED.*all.*2\/2 terminal[\s\S]*Fern.*worker.*IDLE.*SUCCEEDED[\s\S]*worker.*IDLE.*SUCCEEDED/u);
    const routeCall = render(values[5].tool.renderCall?.(values[5].args as never, theme as never, { args: values[5].args, expanded: false } as never));
    const routeResult = render(values[5].tool.renderResult?.({ content: [], details: values[5].details } as never, { expanded: false } as never, theme as never, { args: values[5].args } as never));
    assert.match(routeCall, /mesh_route.*watch.*parent.*followUp.*all.*1 tasks/u);
    assert.match(routeResult, /^accepted\s*$/u);
    assert.match(render(values[6].tool.renderResult?.({ content: [], details: values[6].details } as never, { expanded: false } as never, theme as never, { args: values[6].args } as never)), /all peer tools active/u);
    assert.match(render(values[6].tool.renderResult?.({ content: [], details: { enabled: true, activeTools: ["mesh_run"] } } as never, { expanded: false } as never, theme as never, { args: values[6].args } as never)), /peer tools incomplete/u);
});

// Given partial wait details or a stop disposition, the result slot shows the changing outcome without repeating the tool invocation.
void test("wait and stop result transitions remain explicit without duplicate headings", () => {
    const running = snapshot();
    running.status.state = "busy";
    running.task!.status.state = "running";
    running.task!.result = null;
    const wait = createMeshWaitTool(deps);
    const waitArgs = { taskIds: [taskId], condition: "all" } as const;
    const waiting = render(wait.renderResult?.({ content: [], details: { condition: "all", agents: [running], accounting: { claimedTaskIds: [] } } } as never, { expanded: false, isPartial: true } as never, theme as never, { args: waitArgs } as never));
    assert.match(waiting, /WAITING.*all.*0\/1 terminal[\s\S]*worker.*BUSY.*RUNNING/u);
    assert.doesNotMatch(waiting, /mesh_wait/u);

    const stop = createMeshStopTool(deps);
    const stopArgs = { taskId };
    const stopped = render(stop.renderResult?.({ content: [], details: { ...snapshot(), stopDisposition: "stopped-now" } } as never, { expanded: false, isPartial: false } as never, theme as never, { args: stopArgs } as never));
    assert.match(stopped, /task.*stopped[\s\S]*worker.*IDLE.*SUCCEEDED/u);
    assert.doesNotMatch(stopped, /mesh_stop/u);
});

// Given an agent stop that remains requested while lifecycle is stopping, when it crosses the result-card boundary, the user sees stop pending rather than a completed stop or task-cancellation heading.
void test("pending agent stop card reports stop pending", () => {
    const pending = snapshot(); pending.status.state = "stopping"; pending.stop = { schemaVersion: 1, meshId: pending.agent.meshId, agentId: pending.agent.agentId, stopRequestId: "99999999-9999-4999-8999-999999999999", state: "requested", source: "peer", reason: "awaiting tmux confirmation", previousAgentState: "idle", requestedAt: "2026-01-01T00:02:00Z", updatedAt: "2026-01-01T00:02:00Z" };
    const stop = createMeshStopTool(deps); const args = { agentId };
    const rendered = render(stop.renderResult?.({ content: [], details: { ...pending, stopDisposition: "stop-pending" } } as never, { expanded: false, isPartial: false } as never, theme as never, { args } as never));
    assert.match(rendered, /^agent · stop pending[\s\S]*worker.*STOPPING/u);
    assert.doesNotMatch(rendered, /cancellation completed|agent · stopped/u);
});

// Given expansion at the Pi renderer boundary, users receive bounded diagnostic identities, content, timing, usage, paths, and route/activation lists.
void test("real mesh tool definitions expose diagnostic detail only when expanded", () => {
    for (const item of tools()) {
        const text = render(item.tool.renderResult?.({ content: [], details: item.details } as never, { expanded: true } as never, theme as never, { args: item.args, lastComponent: undefined } as never), 72);
        assert.doesNotMatch(text, new RegExp(item.name, "u"));
        if (["mesh_run", "mesh_submit", "mesh_get", "mesh_wait", "mesh_stop"].includes(item.name)) {
            assert.match(text, new RegExp(agentId, "u"));
            assert.match(text, new RegExp(taskId, "u"));
            assert.match(text, /prompt:.*Inspect the migration boundary[\s\S]*output:.*private completed output[\s\S]*turns: 2[\s\S]*usage:[\s\S]*path: \/private\/task/u);
        }
        if (item.name === "mesh_route") assert.match(text, new RegExp(`${watchId}[\\s\\S]*${taskId}`, "u"));
        if (item.name === "mesh_enable") assert.match(text, /activeTools:[\s\S]*mesh_run[\s\S]*mesh_route/u);
    }
    const route = createMeshRouteTool(deps); const args = { action: "signal", receiver: agentId, delivery: "steer", topic: "review", text: "Inspect result" } as const;
    const call = render(route.renderCall?.(args as never, theme as never, { args, expanded: false } as never));
    const collapsed = render(route.renderResult?.({ content: [], details: { eventId } } as never, { expanded: false } as never, theme as never, { args } as never));
    assert.match(call, /mesh_route.*signal.*11111111.*steer.*review/u); assert.match(collapsed, /^queued\s*$/u); assert.doesNotMatch(collapsed, /delivered/u);
    assert.match(render(route.renderResult?.({ content: [], details: { eventId } } as never, { expanded: true } as never, theme as never, { args } as never)), new RegExp(eventId, "u"));
});

// Given malformed result details crossing a real Pi tool renderer, collapsed cards preserve privacy while expansion provides only a bounded raw diagnostic.
// Given lifecycle/activity/stop metadata, when it crosses the card renderer, collapsed and expanded users receive textual state while every line remains width bounded.
void test("mesh cards expose stable activity, acceptance, and stop detail within width", () => {
    const value = snapshot(); value.stop = { schemaVersion: 1, meshId: value.agent.meshId, agentId: value.agent.agentId, stopRequestId: "99999999-9999-4999-8999-999999999999", state: "confirmed", source: "peer", reason: "bounded parent-visible cleanup reason", previousAgentState: "idle", requestedAt: "2026-01-01T00:02:00Z", updatedAt: "2026-01-01T00:03:00Z", confirmedAt: "2026-01-01T00:03:00Z" };
    const tool = createMeshGetTool(deps); const collapsed = render(tool.renderResult?.({ content: [], details: value } as never, { expanded: false } as never, theme as never, { args: { agentId } } as never), 30); assert.match(collapsed, /activity:unknown|NOT ACCEPTING/u);
    const expanded = render(tool.renderResult?.({ content: [], details: value } as never, { expanded: true } as never, theme as never, { args: { agentId } } as never), 30); assert.match(expanded, /activity: unknown[\s\S]*acceptingTask: false[\s\S]*stopState: confirmed[\s\S]*stopSource: peer[\s\S]*stopReason: bounded\s+parent-visible cleanup reason/u);
});

void test("real mesh tool definitions handle malformed payloads privately and reuse Text components", () => {
    const secret = { token: "raw-secret", path: "/private/raw", body: "x".repeat(10_000) };
    for (const item of tools()) {
        const collapsedComponent = item.tool.renderResult?.({ content: [], details: secret } as never, { expanded: false } as never, theme as never, { args: item.args, lastComponent: undefined } as never);
        const collapsed = render(collapsedComponent);
        assert.match(collapsed, /Malformed mesh result/u);
        assert.doesNotMatch(collapsed, new RegExp(item.name, "u"));
        assert.doesNotMatch(collapsed, /raw-secret|\/private\/raw/u);
        const expandedComponent = item.tool.renderResult?.({ content: [], details: secret } as never, { expanded: true } as never, theme as never, { args: item.args, lastComponent: collapsedComponent } as never);
        assert.equal(expandedComponent, collapsedComponent);
        const expanded = render(expandedComponent, 24);
        assert.match(expanded, /raw-secret|\/private\/raw/u);
        assert.ok(expanded.length < 5_000);
    }

    const route = createMeshRouteTool(deps);
    const args = { action: "signal", receiver: agentId, delivery: "steer", topic: "review", text: "Inspect result" } as const;
    const failure = { content: [{ type: "text", text: "Receiver endpoint is offline" }], details: undefined };
    const collapsedError = render(route.renderResult?.(failure as never, { expanded: false } as never, theme as never, { args, isError: true } as never));
    assert.match(collapsedError, /Error: Receiver endpoint is offline/u);
    assert.doesNotMatch(collapsedError, /mesh_route/u);
    assert.doesNotMatch(collapsedError, /Malformed mesh result/u);
});
