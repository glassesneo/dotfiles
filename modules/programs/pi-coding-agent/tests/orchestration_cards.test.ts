import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderAgentToolResult, renderMeshEventMessage, renderSignalCall, renderSignalResult, renderSubmitCall, renderSubmitResult, renderWaitCall, renderWaitResult } from "../extensions_src/utilities/orchestration_cards.ts";
import type { RoleDefinition } from "../extensions_src/utilities/agent_types.ts";
import { unknownAgentActivityProjection } from "../extensions_src/utilities/orchestration_activity.ts";
import { emptyUsage, type AgentSnapshot } from "../extensions_src/utilities/orchestration_types.ts";

const agentId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };

function snapshot(): AgentSnapshot {
    const definition: RoleDefinition = { description: "Synthetic worker", tools: ["read", "write"], instructions: "Complete the bounded task.", contextPolicy: "project", childExtensionContributions: [] };
    const usage = emptyUsage();
    const meshId = "55555555-5555-4555-8555-555555555555";
    return {
        agent: { schemaVersion: 4, meshId, agentId, epochId: "66666666-6666-4666-8666-666666666666", role: "worker", selectedProfile: "pi-medium", harness: "pi", cwd: "/private/worktree", createdAt: "2026-01-01T00:00:00Z", roleSnapshot: definition, profileSnapshot: { model: "synthetic/pi", thinkingLevel: "medium", harness: "pi" }, launchEnvelope: "/private/envelope.json", launchEnvelopeDigest: "digest", tmux: { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true }, creatorSessionId: "creator", agent: "worker", agentSnapshot: definition },
        status: { schemaVersion: 1, meshId, agentId, state: "idle", bridgeReady: true, meshToolsEnabled: true, agentUsage: usage, accountedTaskIds: [], updatedAt: "2026-01-01T00:02:00Z", childSessionFile: "/private/session.jsonl" },
        activity: unknownAgentActivityProjection(),
        stop: null,
        task: { request: { schemaVersion: 3, meshId, agentId, taskId, prompt: "public summary\nprivate prompt continuation", requesterEndpointId: "root:test", createdAt: "2026-01-01T00:00:00Z" }, status: { schemaVersion: 1, meshId, agentId, taskId, state: "succeeded", createdAt: "2026-01-01T00:00:00Z", startedAt: "2026-01-01T00:00:10Z", finishedAt: "2026-01-01T00:01:00Z" }, result: { schemaVersion: 1, meshId, agentId, taskId, outcome: "succeeded", output: "private completed output", usage, turns: 2, interventions: [], startedAt: "2026-01-01T00:00:10Z", finishedAt: "2026-01-01T00:01:00Z" }, interventions: [], claimed: false, directory: "/private/task" },
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
    const details = JSON.parse(JSON.stringify(snapshot())) as AgentSnapshot;
    const args = { agentId };
    const collapsed = render(renderAgentToolResult({ content: [], details } as never, { expanded: false } as never, theme as never, { args, lastComponent: undefined } as never));
    assert.doesNotMatch(collapsed, new RegExp(`${agentId}|${taskId}|/private/|private completed output|private prompt continuation`, "u"));

    const expanded = render(renderAgentToolResult({ content: [], details } as never, { expanded: true } as never, theme as never, { args, lastComponent: undefined } as never));
    assert.match(expanded, new RegExp(agentId, "u"));
    assert.match(expanded, new RegExp(taskId, "u"));
    assert.match(expanded, /private prompt continuation/u);
    assert.match(expanded, /private completed output/u);

    const external = snapshot(); external.agent.capabilities.usage = false;
    const unavailable = render(renderAgentToolResult({ content: [], details: external } as never, { expanded: true } as never, theme as never, { args, lastComponent: undefined } as never));
    assert.match(unavailable, /turns: unavailable/u); assert.match(unavailable, /usage: unavailable/u); assert.match(unavailable, /agentUsage: unavailable/u);
    assert.doesNotMatch(unavailable, /0 tokens|\$0\.0000/u);
});

// Given malformed result details, collapsed output hides raw data while expansion reuses the component for bounded diagnostics; adapter errors remain errors.
void test("malformed mesh results remain private and preserve renderer mechanics", () => {
    const secret = { token: "raw-secret", path: "/private/raw", body: "x".repeat(10_000) };
    const args = { agentId };
    const collapsedComponent = renderAgentToolResult({ content: [], details: secret } as never, { expanded: false } as never, theme as never, { args, lastComponent: undefined } as never);
    assert.doesNotMatch(render(collapsedComponent), /raw-secret|\/private\/raw/u);
    const expandedComponent = renderAgentToolResult({ content: [], details: secret } as never, { expanded: true } as never, theme as never, { args, lastComponent: collapsedComponent } as never);
    assert.equal(expandedComponent, collapsedComponent);
    const expanded = render(expandedComponent);
    assert.match(expanded, /raw-secret|\/private\/raw/u);
    assert.ok(expanded.length < 10_000);

});

// Given each supported submit selector, the card exposes selector and lifecycle state without exceeding terminal width.
void test("mesh_submit cards project selector and states width-safely", () => {
    for (const args of [
        { agent: "worker", prompt: "bounded" },
        { agentId, prompt: "bounded" },
        { profile: "pi-fast", prompt: "bounded" },
    ]) {
        const call = render(renderSubmitCall(args, theme as never, { expanded: true, lastComponent: undefined }), 34);
        assert.match(call, args.agent ? /agent worker/u : args.profile ? /profile pi-fast/u : /agentId/u);
        assert.doesNotMatch(call, /direct|route/u);
    }
    const reused = render(renderSubmitCall({ agentId, prompt: "bounded" }, theme as never, { expanded: false, lastComponent: undefined }), 34);
    assert.match(reused, new RegExp(`agentId ${agentId.slice(0, 8)}`, "u"));
    assert.doesNotMatch(reused, new RegExp(agentId, "u"));
    const details = snapshot();
    const result = render(renderSubmitResult({ content: [], details: { ...details, accounting: { claimedTaskIds: [], receiptIds: [], receivedTaskIds: [] } } } as never, { expanded: false } as never, theme as never, { args: { agent: "worker", prompt: "bounded" }, lastComponent: undefined } as never), 34);
    assert.doesNotMatch(result, /direct|route/u);
    const semantic = result.replace(/\s+/gu, " ");
    assert.match(semantic, /agent idle/u);
    assert.match(semantic, /task succeeded/u);
});

// Given an all-task wait result, its card exposes terminal progress and expanded identifiers without freezing decoration.
void test("mesh_wait cards expose all-terminal state and full task identifiers width-safely", () => {
    const args = { taskIds: [taskId, agentId] };
    assert.match(render(renderWaitCall(args, theme as never, { expanded: false, lastComponent: undefined }), 24), /all 2 tasks/u);
    const first = snapshot(); const second = structuredClone(first); second.agent.agentId = agentId; second.task!.request.taskId = agentId; second.task!.status.state = "failed"; second.task!.result!.outcome = "failed";
    const collapsed = render(renderWaitResult({ content: [], details: { tasks: [first, second], accounting: { claimedTaskIds: [], receiptIds: [], receivedTaskIds: [] } } } as never, { expanded: false } as never, theme as never, { args, lastComponent: undefined } as never), 32); assert.match(collapsed, /all 2 tasks terminal/u); assert.match(collapsed, /SUCCEEDED/u); assert.match(collapsed, /FAILED/u);
    const expanded = render(renderWaitResult({ content: [], details: { tasks: [first, second] } } as never, { expanded: true } as never, theme as never, { args, lastComponent: undefined } as never), 32); assert.match(expanded.replace(/\s+/gu, ""), new RegExp(taskId, "u")); assert.match(expanded.replace(/\s+/gu, ""), new RegExp(agentId, "u"));
});

void test("mesh_signal cards expose delivery and queued state", () => {
    assert.match(render(renderSignalCall({ receiver: "parent", delivery: "followUp", topic: "handoff", text: "done" }, theme as never, { expanded: false, lastComponent: undefined }), 24), /mesh_signal.*parent.*followUp/su);
    assert.match(render(renderSignalResult({ content: [], details: { eventId: taskId } } as never, { expanded: false } as never, theme as never, { args: { receiver: "parent" }, lastComponent: undefined } as never), 24), /signal queued/u);
});

// Admission: the completion card is the stable user-visible projection boundary; type checks cannot reveal omitted progress, hidden identifiers, or width overflow in terminal output.
// Given a bundled completion and delivery-time frontier, the collapsed card exposes completed-state counts and pending count, while expansion exposes every task identity and state.
void test("completion cards expose compact progress and expanded task identities width-safely", () => {
    const pendingTaskId = "33333333-3333-4333-8333-333333333333";
    const pendingAgentId = "44444444-4444-4444-8444-444444444444";
    const details = {
        kind: "completion",
        sources: [
            { eventId: "event-1", batchId: "batch-1", settledAt: "2026-01-01T00:00:00Z", tasks: [{ taskId, agentId, state: "succeeded" }] },
            { eventId: "event-2", batchId: "batch-2", settledAt: "2026-01-01T00:00:01Z", tasks: [{ taskId: agentId, agentId: pendingAgentId, state: "failed" }] },
        ],
        frontier: { observedAt: "2026-01-01T00:00:02Z", pendingTasks: [{ taskId: pendingTaskId, agentId: pendingAgentId, state: "running" }] },
    };
    const collapsed = render(renderMeshEventMessage({ customType: "mesh-event", content: "model payload", details }, { expanded: false, outputPad: 1 }, theme as never), 26);
    const collapsedSemantic = collapsed.replace(/\s+/gu, " ");
    assert.match(collapsedSemantic, /1 succeeded.*1 failed.*1 pending/su);
    assert.doesNotMatch(collapsedSemantic, new RegExp(`${taskId}|${agentId}|${pendingTaskId}|${pendingAgentId}`, "u"));

    const expanded = render(renderMeshEventMessage({ customType: "mesh-event", content: "model payload", details }, { expanded: true, outputPad: 1 }, theme as never), 26).replace(/\s+/gu, "");
    for (const value of [taskId, agentId, pendingTaskId, pendingAgentId, "succeeded", "failed", "running"]) assert.match(expanded, new RegExp(value, "u"));
});
