import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderAgentToolResult, renderMeshEventMessage, renderReportCall, renderReportResult, renderSendCall, renderSendResult, renderStopCall, renderStopResult, renderWaitCall, renderWaitResult } from "../extensions_src/utilities/orchestration_cards.ts";
import type { RoleDefinition } from "../extensions_src/utilities/agent_types.ts";
import { unknownAgentActivityProjection } from "../extensions_src/utilities/orchestration_activity.ts";
import { assignNatureHandles, displayIdentityForSnapshot, handleForAgentId } from "../extensions_src/utilities/orchestration_identity.ts";
import { emptyUsage, type AgentSnapshot } from "../extensions_src/utilities/orchestration_types.ts";

const agentId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };

function snapshot(route?: AgentSnapshot["status"]["modelRoute"]): AgentSnapshot {
    const definition: RoleDefinition = { description: "Synthetic worker", tools: ["read", "write"], instructions: "Complete the bounded task.", contextPolicy: "project", childExtensionContributions: [] };
    const usage = emptyUsage();
    const meshId = "55555555-5555-4555-8555-555555555555";
    return {
        agent: { schemaVersion: 5, meshId, agentId, epochId: "66666666-6666-4666-8666-666666666666", role: "worker", selectedProfile: "pi-medium", harness: "pi", cwd: "/private/worktree", createdAt: "2026-01-01T00:00:00Z", roleSnapshot: definition, profileSnapshot: { models: ["synthetic/pi", "synthetic/fallback"], thinkingLevel: "medium", harness: "pi" }, launchEnvelope: "/private/envelope.json", launchEnvelopeDigest: "digest", tmux: { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true }, creatorSessionId: "creator", agent: "worker", agentSnapshot: definition },
        status: { schemaVersion: 2, meshId, agentId, state: "idle", bridgeReady: true, meshToolsEnabled: true, agentUsage: usage, accountedTaskIds: [], updatedAt: "2026-01-01T00:02:00Z", childSessionFile: "/private/session.jsonl", ...(route ? { modelRoute: route } : {}) },
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
    assert.match(collapsed, /role:worker/u);
    assert.match(collapsed, /profile:pi-medium/u);
    assert.doesNotMatch(collapsed, new RegExp(`${agentId}|${taskId}|/private/|private completed output|private prompt continuation`, "u"));

    const expanded = render(renderAgentToolResult({ content: [], details } as never, { expanded: true } as never, theme as never, { args, lastComponent: undefined } as never));
    assert.match(expanded, new RegExp(agentId, "u"));
    assert.match(expanded, new RegExp(taskId, "u"));
    assert.match(expanded, /Synthetic worker/u);
    assert.match(expanded, /synthetic\/pi/u);
    assert.match(expanded, /fallback: 0/u);
    assert.match(expanded, /thinking: medium/u);
    assert.match(expanded, /harness: pi/u);
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

// Admission: renderer cards are the stable user-visible boundary; type checks cannot detect duplicated identity, falsely labeled delivery stages, identifier leakage, or narrow-terminal overflow.
// Given a call row and its snapshot-backed result, when Pi renders both parts of one mesh_send card, users observe target identity once and changing state without a redundant disposition summary.
void test("mesh_send cards keep operation and resolved identity in separate nonduplicating rows", () => {
    const newArgs = { agent: "worker", profile: "pi-medium", message: "bounded" };
    const expandedNewCall = render(renderSendCall(newArgs, theme as never, { expanded: true, lastComponent: undefined }), 34).replace(/\s+/gu, " ");
    assert.match(expandedNewCall, /new agent/u); assert.match(expandedNewCall, /requestedRole: worker/u); assert.match(expandedNewCall, /requestedProfile: pi-medium/u); assert.match(expandedNewCall, /message: bounded/u);
    const existingArgs = { agentId, message: "bounded" };
    const expandedExistingCall = render(renderSendCall(existingArgs, theme as never, { expanded: true, lastComponent: undefined }), 34).replace(/\s+/gu, " ");
    assert.match(expandedExistingCall, /existing agent/u); assert.match(expandedExistingCall.replace(/\s+/gu, ""), new RegExp(agentId, "u"));
    assert.match(render(renderSendCall({ agentId: "", message: "bounded" }, theme as never, { expanded: false, lastComponent: undefined }), 34), /existing agent/u);

    const details = snapshot();
    const call = render(renderSendCall(newArgs, theme as never, { expanded: false, lastComponent: undefined }), 34);
    const result = render(renderSendResult({ content: [], details: { ...details, accounting: { claimedTaskIds: [], receiptIds: [], receivedTaskIds: [] } } } as never, { expanded: false } as never, theme as never, { args: newArgs, lastComponent: undefined } as never), 34);
    const completedCard = `${call}\n${result}`.replace(/\s+/gu, " ");
    assert.match(completedCard, /mesh_send · new agent/u); assert.match(completedCard, /role:worker/u); assert.match(completedCard, /profile:pi-medium/u); assert.match(completedCard, /IDLE/u); assert.match(completedCard, /SUCCEEDED/u);
    assert.equal(completedCard.match(/role:worker/gu)?.length, 1); assert.equal(completedCard.match(/profile:pi-medium/gu)?.length, 1); assert.doesNotMatch(completedCard, /submitted|agent idle|task succeeded/iu);

    const interventionDetails = { disposition: "intervened", agentId, taskId, messageId: "77777777-7777-4777-8777-777777777777", sequence: 2, deliveryState: "pending", displayIdentity: displayIdentityForSnapshot(details) };
    const interventionCall = render(renderSendCall(existingArgs, theme as never, { expanded: false, lastComponent: undefined }), 34);
    const collapsed = render(renderSendResult({ content: [], details: interventionDetails } as never, { expanded: false } as never, theme as never, { args: { agentId, message: "urgent" }, lastComponent: undefined } as never), 34);
    const interventionCard = `${interventionCall}\n${collapsed}`;
    assert.match(interventionCard, /existing agent/u); assert.match(interventionCard, /role:worker/u); assert.match(interventionCard, /profile:pi-medium/u); assert.match(interventionCard, /follow-up\s+queued/u); assert.match(interventionCard, /#2/u);
    assert.equal(interventionCard.match(/role:worker/gu)?.length, 1); assert.doesNotMatch(interventionCard, new RegExp(`${agentId}|${taskId}`, "u"));

    const expanded = render(renderSendResult({ content: [], details: interventionDetails } as never, { expanded: true } as never, theme as never, { args: { agentId, message: "urgent" }, lastComponent: undefined } as never), 34);
    assert.match(expanded.replace(/\s+/gu, ""), new RegExp(`${agentId}|${taskId}`, "u")); assert.match(expanded, /urgent/u);
});

// Given an agent stop call and its resolved snapshot, when Pi renders the completed card, users observe the target identity once and rely on textual agent/task states for the outcome.
void test("mesh_stop cards avoid unresolved and disposition repetition after resolution", () => {
    const args = { agentId, reason: "demo complete" };
    const call = render(renderStopCall(args, theme as never, { expanded: false, lastComponent: undefined }), 34);
    const stopped = snapshot(); stopped.status.state = "stopped"; (stopped as unknown as Record<string, unknown>).stopDisposition = "stopped-now";
    const result = render(renderStopResult({ content: [], details: stopped } as never, { expanded: false } as never, theme as never, { args, lastComponent: undefined } as never), 34);
    const completedCard = `${call}\n${result}`.replace(/\s+/gu, " ");
    assert.match(completedCard, /mesh_stop · agent/u); assert.match(completedCard, /role:worker/u); assert.match(completedCard, /profile:pi-medium/u); assert.match(completedCard, /STOPPED/u); assert.match(completedCard, /SUCCEEDED/u);
    assert.equal(completedCard.match(/role:worker/gu)?.length, 1); assert.equal(completedCard.match(/profile:pi-medium/gu)?.length, 1); assert.doesNotMatch(completedCard, /unresolved|agent · stopped/iu);
    const expandedCall = render(renderStopCall(args, theme as never, { expanded: true, lastComponent: undefined }), 34).replace(/\s+/gu, "");
    assert.match(expandedCall, new RegExp(agentId, "u")); assert.match(expandedCall, /reason:democomplete/u);
});

// Given an all-task wait call and its result rows, the completed card states the task count once while each task keeps its own terminal state and expanded identifiers.
void test("mesh_wait cards avoid repeating the aggregate while preserving terminal task rows", () => {
    const args = { taskIds: [taskId, agentId] };
    const call = render(renderWaitCall(args, theme as never, { expanded: false, lastComponent: undefined }), 24);
    const first = snapshot(); const second = structuredClone(first); second.agent.agentId = agentId; second.task!.request.taskId = agentId; second.task!.status.state = "failed"; second.task!.result!.outcome = "failed";
    const collapsed = render(renderWaitResult({ content: [], details: { tasks: [first, second], accounting: { claimedTaskIds: [], receiptIds: [], receivedTaskIds: [] } } } as never, { expanded: false } as never, theme as never, { args, lastComponent: undefined } as never), 32);
    const completedCard = `${call}\n${collapsed}`;
    assert.equal(completedCard.match(/all 2 tasks/gu)?.length, 1); assert.match(completedCard, /SUCCEEDED/u); assert.match(completedCard, /FAILED/u);
    const expanded = render(renderWaitResult({ content: [], details: { tasks: [first, second] } } as never, { expanded: true } as never, theme as never, { args, lastComponent: undefined } as never), 32); assert.match(expanded.replace(/\s+/gu, ""), new RegExp(taskId, "u")); assert.match(expanded.replace(/\s+/gu, ""), new RegExp(agentId, "u")); assert.equal(expanded.match(/handle:/gu)?.length, 2); assert.equal(expanded.match(/role: worker/gu)?.length, 2);
});

void test("mesh_report cards expose summary and queued state", () => {
    const call = render(renderReportCall({ summary: "handoff complete" }, theme as never, { expanded: false, lastComponent: undefined }), 24);
    assert.match(call, /mesh_report/u);
    assert.doesNotMatch(call, /handoff complete/u);

    const expandedCall = render(renderReportCall({ summary: "handoff complete" }, theme as never, { expanded: true, lastComponent: undefined }), 24).replace(/\s+/gu, " ");
    assert.match(expandedCall, /summary/u);
    assert.match(expandedCall, /handoff complete/u);

    const reportId = "77777777-7777-4777-8777-777777777777";
    const queued = render(renderReportResult({ content: [], details: { reportId, taskId, state: "queued", displayIdentity: displayIdentityForSnapshot(snapshot()) } } as never, { expanded: false } as never, theme as never, { args: { summary: "handoff complete" }, lastComponent: undefined } as never), 24);
    const queuedSemantic = queued.replace(/\s+/gu, " ");
    assert.match(queuedSemantic, /role:worker/u);
    assert.match(queuedSemantic, /profile:pi-medium/u);
    assert.match(queuedSemantic, /report queued/u);
    const expandedResult = render(renderReportResult({ content: [], details: { reportId, taskId, state: "queued" } } as never, { expanded: true } as never, theme as never, { args: { summary: "handoff complete" }, lastComponent: undefined } as never), 24).replace(/\s+/gu, "");
    assert.match(expandedResult, new RegExp(taskId, "u"));
    assert.match(expandedResult, new RegExp(reportId, "u"));
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
    assert.match(collapsedSemantic, /completed.*role:unresolved.*state:succeeded/u);
    assert.match(collapsedSemantic, /pending.*role:unresolved.*state:running/u);
    assert.doesNotMatch(collapsedSemantic, new RegExp(`${taskId}|${agentId}|${pendingTaskId}|${pendingAgentId}`, "u"));

    const expanded = render(renderMeshEventMessage({ customType: "mesh-event", content: "model payload", details }, { expanded: true, outputPad: 1 }, theme as never), 26).replace(/\s+/gu, "");
    for (const value of [taskId, agentId, pendingTaskId, pendingAgentId, "succeeded", "failed", "running"]) assert.match(expanded, new RegExp(value, "u"));
});

// Given received, acknowledged, and report custom messages with stored display snapshots, when they cross the message renderer, users observe the same compact identity and evidence-backed stage labels without collapsed IDs.
void test("mesh event cards render received, acknowledged, and report identities", () => {
    const details = snapshot(); const identity = displayIdentityForSnapshot(details); const messageId = "77777777-7777-4777-8777-777777777777";
    const received = render(renderMeshEventMessage({ customType: "mesh-event", content: "model payload", details: { eventId: messageId, kind: "intervention", payload: { agentId, taskId, messageId, sequence: 2, message: "urgent follow-up" }, identities: { [agentId]: identity } } }, { expanded: false }, theme as never), 34);
    assert.match(received, /role:worker/u); assert.match(received, /profile:pi-medium/u); assert.match(received, /follow-up\s+received/u); assert.doesNotMatch(received, new RegExp(`${agentId}|${taskId}|${messageId}`, "u"));

    const acknowledged = render(renderMeshEventMessage({ customType: "mesh-event", content: "model payload", details: { kind: "delivery-ack", payloads: [{ agentId, taskId, ackId: messageId, acknowledgedThrough: 2, messageIds: [messageId] }], identities: { [agentId]: identity } } }, { expanded: false }, theme as never), 34);
    assert.match(acknowledged, /follow-up\s+acknowledged\s+through\s+#2/u); assert.match(acknowledged, /role:worker/u); assert.doesNotMatch(acknowledged, new RegExp(`${agentId}|${taskId}|${messageId}`, "u"));

    const report = render(renderMeshEventMessage({ customType: "mesh-event", content: "model payload", details: { eventId: messageId, kind: "report", payload: { agentId, taskId, reportId: messageId, summary: "bounded progress" }, identities: { [agentId]: identity } } }, { expanded: true }, theme as never), 34);
    assert.match(report, /report/u); assert.match(report, /bounded progress/u); assert.match(report.replace(/\s+/gu, ""), new RegExp(`${agentId}|${taskId}|${messageId}`, "u"));

    const legacyContent = `[mesh-event ${messageId}] unknown\n${JSON.stringify({ agentId, taskId })}`;
    const configuredWords = ["Configured"];
    const legacyCollapsed = render(renderMeshEventMessage({ customType: "mesh-event", content: legacyContent }, { expanded: false }, theme as never, configuredWords), 34);
    assert.match(legacyCollapsed, new RegExp(handleForAgentId(agentId, configuredWords), "u")); assert.match(legacyCollapsed, /role:unresolved/u); assert.doesNotMatch(legacyCollapsed, new RegExp(`${agentId}|${taskId}|${messageId}`, "u"));
    const legacyExpanded = render(renderMeshEventMessage({ customType: "mesh-event", content: legacyContent }, { expanded: true }, theme as never, configuredWords), 34);
    assert.match(legacyExpanded.replace(/\s+/gu, ""), new RegExp(`${agentId}|${taskId}|${messageId}`, "u"));
});

// Given one ID projected alone and alongside other IDs, when it crosses the pure identity helper, every consumer observes the same collection-independent handle.
void test("agent display handles are stable across collections", () => {
    const otherAgentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const singleton = assignNatureHandles([agentId]);
    const collection = assignNatureHandles([otherAgentId, agentId]);
    assert.equal(singleton.get(agentId), handleForAgentId(agentId));
    assert.equal(collection.get(agentId), singleton.get(agentId));
    assert.notEqual(handleForAgentId(otherAgentId), "agent");
    const sharedPrefixId = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    assert.notEqual(handleForAgentId(sharedPrefixId, ["Only"]), handleForAgentId(agentId, ["Only"]));
});

// Admission: operator cards own the visibility split for successful fallback; schemas cannot detect collapsed route summaries or expanded attempt history.
// Given status.modelRoute with sticky active model and ordered attempts, collapsed cards expose active model and attempts.length while expansion reveals category and sanitized message.
void test("operator cards expose active model and fallback attempts without freezing decoration", () => {
    const route = {
        activeIndex: 1,
        activeModel: "synthetic/fallback",
        attempts: [{ index: 0, model: "synthetic/pi", category: "invocation" as const, at: "2026-01-01T00:00:30Z", message: "primary refused" }],
    };
    const details = snapshot(route);
    const identity = displayIdentityForSnapshot(details);
    assert.equal(identity.model, "synthetic/fallback");
    assert.equal(identity.fallbackCount, 1);

    const collapsed = render(renderAgentToolResult({ content: [], details } as never, { expanded: false } as never, theme as never, { args: { agentId }, lastComponent: undefined } as never));
    assert.match(collapsed, /model:synthetic\/fallback/u);
    assert.match(collapsed, /fallback:1/u);
    assert.doesNotMatch(collapsed, /primary refused|attempt#0|invocation/u);

    const expanded = render(renderAgentToolResult({ content: [], details } as never, { expanded: true } as never, theme as never, { args: { agentId }, lastComponent: undefined } as never));
    assert.match(expanded, /model: synthetic\/fallback/u);
    assert.match(expanded, /fallback: 1/u);
    assert.match(expanded, /attempt#0/u);
    assert.match(expanded, /invocation/u);
    assert.match(expanded, /primary refused/u);
});
