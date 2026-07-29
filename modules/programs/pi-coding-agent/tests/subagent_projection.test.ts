import assert from "node:assert/strict";
import test from "node:test";
import { createSubagentGetTool, createSubagentSendTool, createSubagentStartTool, createSubagentStopTool, createSubagentWaitTool } from "../extensions_src/subagent.ts";
import {
    exceedsModelVisibleLimit,
    projectDebugSnapshot,
    projectMinimalAgentTask,
    projectMinimalWaitResult,
    sanitizeSnapshot,
    serializeModelVisibleJson,
    type MinimalAgentTask,
} from "../extensions_src/utilities/subagent_projection.ts";
import { emptyUsage, type AgentSnapshot } from "../extensions_src/utilities/subagent_types.ts";

const usage = emptyUsage();
const baseSnapshot = (overrides: Partial<{ agentState: AgentSnapshot["status"]["state"]; taskState: NonNullable<AgentSnapshot["task"]>["status"]["state"]; output: string; error: string; result: boolean }> = {}): AgentSnapshot => {
    const taskState = overrides.taskState ?? "running";
    const terminal = taskState === "succeeded" || taskState === "failed" || taskState === "stopped";
    const includeResult = overrides.result ?? terminal;
    return {
        agent: {
            schemaVersion: 1,
            agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            profile: "scout",
            purpose: "scan tree",
            harness: "pi",
            cwd: "/work",
            createdAt: "2026-01-01T00:00:00.000Z",
            profileSnapshot: { model: "provider/model", description: "x", allowAllTools: false, tools: ["read"], extensions: { subagent: { allowedTargets: [] } } },
            tmux: { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "s", windowId: "@1", paneId: "%1", windowName: "w" },
            capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true },
            callerProfile: "taskmaster",
            targetProfile: "scout",
            depth: 1,
            originSessionId: "origin",
        },
        status: {
            schemaVersion: 1,
            agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            state: overrides.agentState ?? "busy",
            activeTaskId: "task-1",
            latestTaskId: "task-1",
            bridgeReady: true,
            agentUsage: usage,
            accountedTaskIds: [],
            updatedAt: "2026-01-01T00:00:01.000Z",
        },
        task: {
            request: {
                schemaVersion: 1,
                agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                taskId: "task-1",
                purpose: "scan tree",
                prompt: "List the modules",
                createdAt: "2026-01-01T00:00:00.000Z",
            },
            status: {
                schemaVersion: 1,
                agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                taskId: "task-1",
                state: taskState,
                createdAt: "2026-01-01T00:00:00.000Z",
                startedAt: "2026-01-01T00:00:00.500Z",
                ...(terminal ? { finishedAt: "2026-01-01T00:00:02.000Z" } : {}),
            },
            result: includeResult
                ? {
                    schemaVersion: 1,
                    agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                    taskId: "task-1",
                    outcome: terminal ? taskState as "succeeded" | "failed" | "stopped" : "succeeded",
                    output: overrides.output ?? "done",
                    usage,
                    turns: 1,
                    interventions: [],
                    startedAt: "2026-01-01T00:00:00.500Z",
                    finishedAt: "2026-01-01T00:00:02.000Z",
                    ...(overrides.error ? { error: overrides.error } : {}),
                }
                : null,
            interventions: [],
            claimed: false,
            directory: "/state/agents/a/tasks/task-1",
        },
    };
};

void test("public schemas omit detail and expose debug only on get", () => {
    const start = createSubagentStartTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) }, ["scout"]);
    const send = createSubagentSendTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const get = createSubagentGetTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const wait = createSubagentWaitTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const stop = createSubagentStopTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });

    const props = (tool: { parameters: { properties?: Record<string, unknown>; required?: readonly string[] } }) => ({
        keys: Object.keys(tool.parameters.properties ?? {}).sort(),
        required: [...(tool.parameters.required ?? [])].sort(),
    });

    assert.deepEqual(props(start), { keys: ["profile", "prompt", "purpose"], required: ["profile", "prompt", "purpose"] });
    assert.deepEqual(props(send), { keys: ["agentId", "prompt", "purpose"], required: ["agentId", "prompt", "purpose"] });
    assert.deepEqual(props(get), { keys: ["agentId", "debug", "taskId"], required: ["agentId"] });
    assert.deepEqual(props(wait), { keys: ["condition", "taskIds", "timeoutSeconds"], required: ["condition", "taskIds", "timeoutSeconds"] });
    assert.deepEqual(props(stop), { keys: ["agentId"], required: ["agentId"] });
    assert.match(get.description, /debug/i);
    assert.match(get.description, /not needed for normal operation/i);
});

void test("prepareArguments maps legacy detail and purpose fallback", () => {
    const start = createSubagentStartTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) }, ["scout"]);
    const get = createSubagentGetTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const wait = createSubagentWaitTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });

    const preparedStart = start.prepareArguments?.({ profile: "scout", prompt: "Inspect the tree\nmore", detail: true } as never);
    assert.equal((preparedStart as { purpose: string }).purpose, "Inspect the tree");
    assert.equal("detail" in (preparedStart as object), false);

    const preparedGet = get.prepareArguments?.({ agentId: "a", detail: true } as never);
    assert.equal((preparedGet as { debug: boolean }).debug, true);
    assert.equal("detail" in (preparedGet as object), false);

    const preparedWait = wait.prepareArguments?.({ taskIds: ["t1"], condition: "all", timeoutSeconds: 30, detail: true } as never);
    assert.equal("detail" in (preparedWait as object), false);
    assert.deepEqual(preparedWait, { taskIds: ["t1"], condition: "all", timeoutSeconds: 30 });
});

void test("minimal projection keeps only parent-facing fields", () => {
    const running = projectMinimalAgentTask(baseSnapshot({ taskState: "running", result: true, output: "secret" }));
    assert.deepEqual(running, {
        agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        taskId: "task-1",
        profile: "scout",
        purpose: "scan tree",
        agentState: "busy",
        taskState: "running",
    });

    const succeeded = projectMinimalAgentTask(baseSnapshot({ agentState: "idle", taskState: "succeeded", output: "ok" }));
    assert.equal(succeeded.output, "ok");
    assert.equal(succeeded.error, undefined);
    assert.equal("activeTaskId" in succeeded, false);
    assert.equal("interventions" in succeeded, false);

    const wait = projectMinimalWaitResult([baseSnapshot({ taskState: "succeeded" }), baseSnapshot({ taskState: "running", result: false })], "timeout");
    assert.deepEqual(Object.keys(wait).sort(), ["outcome", "tasks"]);
    assert.equal(wait.outcome, "timeout");
    assert.equal(wait.tasks.length, 2);
});

void test("sanitize and debug projection hide provisional results", () => {
    const provisional = baseSnapshot({ taskState: "running", result: true, output: "early" });
    assert.equal(sanitizeSnapshot(provisional).task?.result, null);
    assert.equal(projectDebugSnapshot(provisional).task?.result, null);
    assert.equal(projectMinimalAgentTask(provisional).output, undefined);

    const debug = projectDebugSnapshot(baseSnapshot({ agentState: "idle", taskState: "succeeded", output: "done" }));
    assert.ok(debug.agent);
    assert.ok(debug.status);
    assert.ok(debug.task);
    assert.equal("accounting" in debug, false);
});

void test("serializer enforces aggregate size and marks truncation", () => {
    const huge = "x".repeat(60_000);
    const task: MinimalAgentTask = {
        agentId: "a",
        profile: "scout",
        purpose: "p",
        agentState: "idle",
        taskState: "succeeded",
        output: huge,
    };
    const text = serializeModelVisibleJson(task);
    assert.equal(exceedsModelVisibleLimit(text), false);
    const parsed = JSON.parse(text) as MinimalAgentTask;
    assert.equal(parsed.outputTruncated, true);
    assert.ok((parsed.output?.length ?? 0) < huge.length);
    JSON.parse(text);
});

void test("serializer bounds non-output metadata, multibyte, and escape-heavy payloads", () => {
    const debugHeavy = {
        agent: {
            agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            profile: "scout",
            purpose: "scan",
            profileSnapshot: { instructions: "😀".repeat(20_000) },
        },
        status: { state: "idle" },
        task: { request: { prompt: "line\n".repeat(3_000) } },
    };
    const debugText = serializeModelVisibleJson(debugHeavy);
    assert.equal(exceedsModelVisibleLimit(debugText), false);
    const debugParsed = JSON.parse(debugText) as typeof debugHeavy & { agent: { profileSnapshot: { outputTruncated?: true } } };
    assert.equal(debugParsed.agent.agentId, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    assert.equal(debugParsed.agent.profile, "scout");
    assert.ok(Array.from(debugParsed.agent.profileSnapshot.instructions).length < 20_000);

    const mixed = { output: "x", metadata: "m".repeat(60_000), note: "\\\n\"quoted\"".repeat(5_000) };
    const mixedText = serializeModelVisibleJson(mixed);
    assert.equal(exceedsModelVisibleLimit(mixedText), false);
    const mixedParsed = JSON.parse(mixedText) as typeof mixed & { outputTruncated?: true };
    assert.equal(mixedParsed.outputTruncated, true);
    assert.ok(mixedParsed.metadata.length < 60_000);
});

void test("debug projection omits accountedTaskIds and preserves envelope under array pressure", () => {
    const manyIds = Array.from({ length: 1_500 }, (_, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`);
    const snap = baseSnapshot({ agentState: "idle", taskState: "succeeded" });
    snap.status.accountedTaskIds = manyIds;
    const projected = projectDebugSnapshot(snap);
    assert.equal("accountedTaskIds" in projected.status, false);
    const text = serializeModelVisibleJson(projected);
    assert.equal(exceedsModelVisibleLimit(text), false);
    const parsed = JSON.parse(text) as { agent: unknown; status: Record<string, unknown>; task: unknown };
    assert.ok(parsed.agent);
    assert.ok(parsed.status);
    assert.ok(parsed.task);
    assert.equal("accountedTaskIds" in parsed.status, false);

    const rawWithIds = {
        agent: { agentId: snap.agent.agentId, profile: "scout", purpose: "p" },
        status: { state: "idle", accountedTaskIds: manyIds },
        task: { request: { purpose: "p", prompt: "x" }, status: { state: "succeeded" } },
    };
    const rawText = serializeModelVisibleJson(rawWithIds);
    assert.equal(exceedsModelVisibleLimit(rawText), false);
    const rawParsed = JSON.parse(rawText) as typeof rawWithIds & { status: { outputTruncated?: true } };
    assert.equal(rawParsed.agent.agentId, snap.agent.agentId);
    assert.ok(rawParsed.status.accountedTaskIds.length < manyIds.length);
    assert.equal(rawParsed.status.outputTruncated, true);
});

void test("serializer caps max-cardinality wait outputs without multi-clone blowup", () => {
    const tasks = Array.from({ length: 128 }, (_, index) => ({
        agentId: `agent-${index}`,
        profile: "scout",
        purpose: "p",
        agentState: "idle" as const,
        taskState: "succeeded" as const,
        output: "x".repeat(64 * 1024),
    }));
    const started = Date.now();
    const text = serializeModelVisibleJson({ outcome: "completed", tasks });
    const elapsed = Date.now() - started;
    assert.equal(exceedsModelVisibleLimit(text), false);
    assert.ok(elapsed < 2_000, `serializer took ${elapsed}ms`);
    const parsed = JSON.parse(text) as { outcome: string; tasks: Array<{ output?: string; outputTruncated?: true }> };
    assert.equal(parsed.outcome, "completed");
    assert.equal(parsed.tasks.length, 128);
    assert.ok(parsed.tasks.every(task => (task.output?.length ?? 0) < 64 * 1024));
});

void test("serializer preserves max-cardinality wait envelope with multibyte purposes", () => {
    const tasks = Array.from({ length: 128 }, (_, index) => ({
        agentId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        taskId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        profile: "scout",
        purpose: "😀".repeat(120),
        agentState: "idle" as const,
        taskState: "succeeded" as const,
    }));
    const text = serializeModelVisibleJson({ outcome: "completed", tasks });
    assert.equal(exceedsModelVisibleLimit(text), false);
    const parsed = JSON.parse(text) as { outcome: string; tasks: Array<{ agentId: string; purpose: string; outputTruncated?: true }> };
    assert.equal(parsed.outcome, "completed");
    assert.equal(parsed.tasks.length, 128);
    assert.equal(parsed.tasks[127]!.agentId, tasks[127]!.agentId);
    assert.ok(parsed.tasks.every(task => task.purpose.length < 240 && task.outputTruncated === true));
});

void test("serializer marks only content that is actually truncated", () => {
    const value = {
        outcome: "completed",
        tasks: [
            { agentId: "a", profile: "p", purpose: "p", agentState: "idle", taskState: "succeeded", output: "A".repeat(1_000) },
            { agentId: "b", profile: "p", purpose: "p", agentState: "idle", taskState: "succeeded", output: "B".repeat(100_000) },
        ],
    };
    const parsed = JSON.parse(serializeModelVisibleJson(value)) as typeof value & { tasks: Array<{ outputTruncated?: true }> };
    assert.equal(parsed.tasks[0]!.output, value.tasks[0]!.output);
    assert.equal(parsed.tasks[0]!.outputTruncated, undefined);
    assert.equal(parsed.tasks[1]!.outputTruncated, true);
    assert.match(parsed.tasks[1]!.output, /…$/u);
});

void test("serializer preserves debug envelope under structural extension pressure", () => {
    const extensions = Object.fromEntries(Array.from({ length: 6_000 }, (_, index) => [`facet-${index}`, {}]));
    const value = {
        agent: { agentId: "agent-1", profile: "scout", purpose: "inspect", profileSnapshot: { extensions } },
        status: { state: "idle" },
        task: null,
    };
    const text = serializeModelVisibleJson(value);
    assert.equal(exceedsModelVisibleLimit(text), false);
    const parsed = JSON.parse(text) as typeof value & { agent: { profileSnapshot: { outputTruncated?: true } } };
    assert.ok(parsed.agent);
    assert.ok(parsed.status);
    assert.equal(parsed.task, null);
    assert.ok(Object.keys(parsed.agent.profileSnapshot.extensions).length <= 128);
    assert.equal(parsed.agent.profileSnapshot.outputTruncated, true);
});

void test("wait serializer keeps input order and parseable JSON under budget", () => {
    const tasks = [
        projectMinimalAgentTask(baseSnapshot({ taskState: "succeeded", output: "one" })),
        projectMinimalAgentTask(baseSnapshot({ taskState: "failed", error: "boom", output: "" })),
    ];
    tasks[1]!.agentId = "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";
    tasks[1]!.taskId = "task-2";
    const text = serializeModelVisibleJson({ outcome: "completed", tasks });
    const parsed = JSON.parse(text) as { outcome: string; tasks: MinimalAgentTask[] };
    assert.equal(parsed.outcome, "completed");
    assert.equal(parsed.tasks[0]!.taskId, "task-1");
    assert.equal(parsed.tasks[1]!.taskId, "task-2");
});
