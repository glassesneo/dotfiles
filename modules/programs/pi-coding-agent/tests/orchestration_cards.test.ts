import assert from "node:assert/strict";
import test from "node:test";
import { createMeshGetTool, createMeshRouteTool, type OrchestrationDependencies } from "../extensions_src/orchestration.ts";
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

function render(component: { render(width: number): string[] } | undefined): string {
    assert.ok(component);
    return component.render(72).join("\n");
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

    const route = createMeshRouteTool(deps);
    const routeArgs = { action: "signal", receiver: agentId, delivery: "steer", topic: "review", text: "Inspect result" } as const;
    const failure = { content: [{ type: "text", text: "synthetic endpoint failure" }], details: undefined };
    const renderedError = render(route.renderResult?.(failure as never, { expanded: false } as never, theme as never, { args: routeArgs, isError: true } as never));
    assert.match(renderedError, /synthetic endpoint failure/u);
    assert.doesNotMatch(renderedError, /raw-secret|\/private\/raw/u);
});
