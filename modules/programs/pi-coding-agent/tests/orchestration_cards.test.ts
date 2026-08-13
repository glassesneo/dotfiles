import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createMeshChannelTool, createMeshGetTool, createMeshSignalTool, createMeshSubmitTool, type OrchestrationDependencies } from "../extensions_src/orchestration.ts";
import { renderMeshEventMessage } from "../extensions_src/utilities/orchestration_cards.ts";
import type { RoleDefinition } from "../extensions_src/utilities/agent_types.ts";
import { unknownAgentActivityProjection } from "../extensions_src/utilities/orchestration_activity.ts";
import { emptyUsage, type AgentSnapshot } from "../extensions_src/utilities/orchestration_types.ts";

const agentId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };
const deps: OrchestrationDependencies = { configPath: "/unused/config.json", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }), natureHandleWords: () => ["Fern"] };

function snapshot(): AgentSnapshot {
    const definition: RoleDefinition = { description: "Synthetic worker", tools: ["read", "write"], skillOptIns: [], instructions: "Complete the bounded task.", defaultProfile: "pi-medium", contextPolicy: "project", childExtensionContributions: [] };
    const usage = emptyUsage();
    const meshId = "55555555-5555-4555-8555-555555555555";
    return {
        agent: { schemaVersion: 2, meshId, agentId, epochId: "66666666-6666-4666-8666-666666666666", role: "worker", selectedProfile: "pi-medium", harness: "pi", cwd: "/private/worktree", createdAt: "2026-01-01T00:00:00Z", roleSnapshot: definition, profileSnapshot: { model: "synthetic/pi", thinkingLevel: "medium", harness: "pi" }, launchEnvelope: "/private/envelope.json", launchEnvelopeDigest: "digest", tmux: { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true }, creatorSessionId: "creator", agent: "worker", agentSnapshot: definition },
        status: { schemaVersion: 1, meshId, agentId, state: "idle", bridgeReady: true, meshToolsEnabled: true, agentUsage: usage, accountedTaskIds: [], updatedAt: "2026-01-01T00:02:00Z", childSessionFile: "/private/session.jsonl" },
        activity: unknownAgentActivityProjection(),
        stop: null,
        task: { request: { schemaVersion: 2, meshId, agentId, taskId, prompt: "public summary\nprivate prompt continuation", requesterEndpointId: "root:test", createdAt: "2026-01-01T00:00:00Z" }, status: { schemaVersion: 1, meshId, agentId, taskId, state: "succeeded", createdAt: "2026-01-01T00:00:00Z", startedAt: "2026-01-01T00:00:10Z", finishedAt: "2026-01-01T00:01:00Z" }, result: { schemaVersion: 1, meshId, agentId, taskId, outcome: "succeeded", output: "private completed output", usage, turns: 2, interventions: [], startedAt: "2026-01-01T00:00:10Z", finishedAt: "2026-01-01T00:01:00Z" }, interventions: [], claimed: false, directory: "/private/task" },
    };
}

function render(component: { render(width: number): string[] } | undefined, width = 72): string {
    assert.ok(component);
    const lines = component.render(width);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
    return lines.join("\n");
}

// Given private result details at the Pi renderer boundary, collapsed output hides them while explicit expansion reveals diagnostics.
void test("mesh result details are private until expanded", () => {
    const tool = createMeshGetTool(deps);
    const details = JSON.parse(JSON.stringify(snapshot())) as AgentSnapshot;
    const args = { agentId };
    const collapsed = render(tool.renderResult?.({ content: [], details } as never, { expanded: false } as never, theme as never, { args } as never));
    assert.doesNotMatch(collapsed, new RegExp(`${agentId}|${taskId}|/private/|private completed output|private prompt continuation`, "u"));

    const expanded = render(tool.renderResult?.({ content: [], details } as never, { expanded: true } as never, theme as never, { args } as never));
    assert.match(expanded, new RegExp(agentId, "u"));
    assert.match(expanded, new RegExp(taskId, "u"));
    assert.match(expanded, /private prompt continuation/u);
    assert.match(expanded, /private completed output/u);
});

// Given malformed result details, collapsed output hides raw data while expansion reuses the component for bounded diagnostics; adapter errors remain errors.
void test("malformed mesh results remain private and preserve renderer mechanics", () => {
    const tool = createMeshGetTool(deps);
    const secret = { token: "raw-secret", path: "/private/raw", body: "x".repeat(10_000) };
    const args = { agentId };
    const collapsedComponent = tool.renderResult?.({ content: [], details: secret } as never, { expanded: false } as never, theme as never, { args, lastComponent: undefined } as never);
    assert.doesNotMatch(render(collapsedComponent), /raw-secret|\/private\/raw/u);
    const expandedComponent = tool.renderResult?.({ content: [], details: secret } as never, { expanded: true } as never, theme as never, { args, lastComponent: collapsedComponent } as never);
    assert.equal(expandedComponent, collapsedComponent);
    const expanded = render(expandedComponent);
    assert.match(expanded, /raw-secret|\/private\/raw/u);
    assert.ok(expanded.length < 10_000);

});

// Given each supported submit selector and completion route, the tool card exposes selector, route, and lifecycle state without exceeding terminal width.
void test("mesh_submit cards project selector route and states width-safely", () => {
    const tool = createMeshSubmitTool(deps, { worker: snapshot().agent.roleSnapshot }, ["pi-fast"]);
    for (const args of [
        { agent: "worker", prompt: "bounded", channel: "A" as const },
        { agentId, prompt: "bounded" },
        { profile: "pi-fast", prompt: "bounded" },
    ]) {
        const call = render(tool.renderCall?.(args as never, theme as never, { expanded: true, lastComponent: undefined } as never), 34);
        assert.match(call, args.agent ? /agent worker/u : args.profile ? /profile pi-fast/u : /agentId/u);
        assert.match(call, args.channel ? /channel A/u : /direct/u);
    }
    const reused = render(tool.renderCall?.({ agentId, prompt: "bounded" } as never, theme as never, { expanded: false, lastComponent: undefined } as never), 34);
    assert.match(reused, new RegExp(`agentId ${agentId.slice(0, 8)}`, "u"));
    assert.doesNotMatch(reused, new RegExp(agentId, "u"));
    const details = snapshot();
    details.task!.request.completion = { endpointId: "root:test", endpointSessionFile: "/session.jsonl", mode: "channel", channel: "A" };
    const result = render(tool.renderResult?.({ content: [], details: { ...details, accounting: { claimedTaskIds: [] } } } as never, { expanded: false } as never, theme as never, { args: { agent: "worker", prompt: "bounded", channel: "A" }, lastComponent: undefined } as never), 34);
    assert.match(result, /channel A/u);
    const semantic = result.replace(/\s+/gu, " ");
    assert.match(semantic, /agent idle/u);
    assert.match(semantic, /task succeeded/u);
});

// Given inspect/flush and signal projections, their cards retain channel counts, role/lifecycle semantics, and expanded identifiers within width.
void test("mesh_channel and mesh_signal cards expose semantic state and identifiers", () => {
    const channel = createMeshChannelTool(deps);
    assert.match(render(channel.renderCall?.({ action: "inspect" } as never, theme as never, { expanded: false, lastComponent: undefined } as never), 24), /inspect.*active channels/su);
    assert.match(render(channel.renderCall?.({ action: "flush", channel: "B" } as never, theme as never, { expanded: false, lastComponent: undefined } as never), 24), /flush.*channel B/su);
    const projection = { channel: "B", terminal: 1, total: 2, tasks: [{ taskId, agentId, agent: "worker", agentState: "busy", state: "succeeded" }] };
    const collapsed = render(channel.renderResult?.({ content: [], details: { channels: [projection] } } as never, { expanded: false } as never, theme as never, { args: { action: "inspect", channel: "B" }, lastComponent: undefined } as never), 32);
    assert.match(collapsed, /channel B/u);
    assert.match(collapsed, /1\/2 terminal/u);
    assert.match(collapsed, /worker/u);
    assert.match(collapsed, /task.*SUCCEEDED/isu);
    assert.match(collapsed, /agent.*BUSY/isu);
    assert.doesNotMatch(collapsed, new RegExp(`${taskId}|${agentId}`, "u"));
    const expanded = render(channel.renderResult?.({ content: [], details: { channelResult: projection } } as never, { expanded: true } as never, theme as never, { args: { action: "flush", channel: "B" }, lastComponent: undefined } as never), 32);
    const expandedSemantic = expanded.replace(/\s+/gu, "");
    assert.match(expandedSemantic, new RegExp(taskId, "u"));
    assert.match(expandedSemantic, new RegExp(agentId, "u"));

    const signal = createMeshSignalTool(deps);
    assert.match(render(signal.renderCall?.({ receiver: "parent", delivery: "followUp", topic: "handoff", text: "done" } as never, theme as never, { expanded: false, lastComponent: undefined } as never), 24), /mesh_signal.*parent.*followUp/su);
    assert.match(render(signal.renderResult?.({ content: [], details: { eventId: taskId } } as never, { expanded: false } as never, theme as never, { args: { receiver: "parent" }, lastComponent: undefined } as never), 24), /signal queued/u);
});

// Given direct or grouped completion payloads, the custom-message renderer names the route and summarizes terminal task states width-safely.
void test("completion messages name their route and summarize task states", () => {
    for (const details of [
        { kind: "completion", payload: { route: "direct", tasks: [{ taskId, state: "succeeded" }] } },
        { kind: "completion", payload: { route: "channel", channel: "C", tasks: [{ taskId, state: "failed" }, { taskId: agentId, state: "stopped" }] } },
    ]) {
        const text = render(renderMeshEventMessage({ customType: "mesh-event", content: "model payload", details }, { expanded: false, outputPad: 1 }, theme as never), 28);
        const semantic = text.replace(/\s+/gu, " ");
        assert.match(semantic, details.payload.route === "direct" ? /direct completion/u : /channel C completion/u);
        assert.match(semantic, details.payload.route === "direct" ? /1 succeeded/u : /1 failed.*1 stopped/su);
    }
});
