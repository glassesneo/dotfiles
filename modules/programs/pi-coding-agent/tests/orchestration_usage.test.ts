import assert from "node:assert/strict";
import test from "node:test";
import { unknownAgentActivityProjection } from "../extensions_src/utilities/orchestration_activity.ts";
import { emptyUsage, type AgentSnapshot } from "../extensions_src/utilities/orchestration_types.ts";
import { formatMeshChildUsageLine, projectMeshChildUsage } from "../extensions_src/utilities/orchestration_usage.ts";

const usage = (input: number, output: number) => ({
    ...emptyUsage(),
    input,
    output,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function snapshot(input: {
    agentId: string;
    taskId: string;
    usageCapable: boolean;
    result?: ReturnType<typeof usage>;
}): AgentSnapshot {
    const meshId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    return {
        agent: {
            schemaVersion: 7,
            meshId,
            agentId: input.agentId,
            epochId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            childId: "worker",
            harness: "pi",
            cwd: "/",
            createdAt: "2026-01-01T00:00:00.000Z",
            definitionSnapshot: {
                selector: { agent: "worker", access: "read" },
                description: "worker",
                tools: [],
                instructions: "work",
                contextPolicy: "project",
                childExtensionContributions: [],
                execution: { models: ["openai/test"], harness: "pi" },
                targets: [],
                gc: { collectAt: 1, retain: 1, pressureFloor: 0 },
            },
            launchEnvelope: "/envelope.json",
            launchEnvelopeDigest: "d",
            tmux: { socket: "/tmp", serverPid: "1", sessionId: "$1", sessionName: "s", windowId: "@1", paneId: "%1", windowName: "w" },
            capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: input.usageCapable, interactiveInterventions: true },
            creatorSessionId: "creator",
        },
        status: { schemaVersion: 2, meshId, agentId: input.agentId, state: "idle", bridgeReady: true, meshToolsEnabled: false, agentUsage: emptyUsage(), accountedTaskIds: [input.taskId], updatedAt: "2026-01-01T00:00:00.000Z" },
        activity: unknownAgentActivityProjection(),
        stop: null,
        task: {
            request: { schemaVersion: 4, meshId, agentId: input.agentId, taskId: input.taskId, prompt: "p", purpose: "synthetic purpose", requesterEndpointId: "root", createdAt: "2026-01-01T00:00:00.000Z" },
            status: { schemaVersion: 1, meshId, agentId: input.agentId, taskId: input.taskId, state: "succeeded", createdAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z" },
            result: input.result ? { schemaVersion: 1, meshId, agentId: input.agentId, taskId: input.taskId, outcome: "succeeded", output: "ok", usage: input.result, turns: 1, interventions: [], startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z" } : null,
            interventions: [],
            claimed: false,
            directory: "/",
        },
    };
}

void test("mesh child usage counts each task once and marks unknown ACP usage", () => {
    const parent = "11111111-1111-4111-8111-111111111111";
    const child = "22222222-2222-4222-8222-222222222222";
    const grandchild = "33333333-3333-4333-8333-333333333333";
    const parentTask = "44444444-4444-4444-8444-444444444444";
    const childTask = "55555555-5555-4555-8555-555555555555";
    const grandchildTask = "66666666-6666-4666-8666-666666666666";
    const unknownTask = "77777777-7777-4777-8777-777777777777";
    const agents = [
        snapshot({ agentId: parent, taskId: parentTask, usageCapable: true, result: usage(1, 2) }),
        snapshot({ agentId: child, taskId: childTask, usageCapable: true, result: usage(3, 4) }),
        snapshot({ agentId: grandchild, taskId: grandchildTask, usageCapable: true, result: usage(5, 6) }),
        snapshot({ agentId: "88888888-8888-4888-8888-888888888888", taskId: unknownTask, usageCapable: false, result: usage(9, 9) }),
    ];
    const earlierChildTask = snapshot({ agentId: child, taskId: "99999999-9999-4999-8999-999999999999", usageCapable: true, result: usage(7, 8) }).task!;
    const projected = projectMeshChildUsage(agents, [...agents.map(item => item.task!), earlierChildTask]);
    assert.equal(projected.accounted.input, 16);
    assert.equal(projected.accounted.output, 20);
    assert.deepEqual(projected.accountedTaskIds, [parentTask, childTask, grandchildTask, earlierChildTask.request.taskId]);
    assert.deepEqual(projected.unknownTaskIds, [unknownTask]);
    assert.match(formatMeshChildUsageLine(projected), /Child usage 36 tokens \(mesh, separate from Pi totals\); unknown tasks remain/u);
});
