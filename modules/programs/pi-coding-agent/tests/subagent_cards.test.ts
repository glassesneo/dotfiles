import assert from "node:assert/strict";
import test from "node:test";
import { createSubagentGetTool, createSubagentStopTool, createSubagentSubmitTool, createSubagentWaitTool } from "../extensions_src/subagent.ts";
import { emptyUsage, type AgentSnapshot } from "../extensions_src/utilities/subagent_types.ts";

const theme = {
    fg(_color: string, text: string) { return text; },
    bold(text: string) { return text; },
} as never;

const usage = emptyUsage();
const snapshot = (): AgentSnapshot => ({
    agent: {
        schemaVersion: 1,
        agentId: "550e8400-e29b-41d4-a716-446655440000",
        profile: "scout",
        purpose: "scan tree",
        harness: "pi",
        cwd: "/work",
        createdAt: "2026-01-01T00:00:00.000Z",
        profileSnapshot: { id: "99999999-9999-4999-8999-999999999999", model: "provider/model", availability: ["top-level", "subagent"] as ("top-level" | "subagent")[], description: "x", allowAllTools: false, tools: ["read"], extensions: { subagent: { allowedTargets: [] } } },
        tmux: { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "s", windowId: "@1", paneId: "%1", windowName: "w" },
        capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true },
        callerProfile: "taskmaster",
        targetProfile: "scout",
        depth: 1,
        originSessionId: "origin",
    },
    status: {
        schemaVersion: 1,
        agentId: "550e8400-e29b-41d4-a716-446655440000",
        state: "idle",
        latestTaskId: "task-1",
        bridgeReady: true,
        agentUsage: usage,
        accountedTaskIds: ["task-1"],
        updatedAt: "2026-01-01T00:00:02.000Z",
    },
    task: {
        request: {
            schemaVersion: 1,
            agentId: "550e8400-e29b-41d4-a716-446655440000",
            taskId: "task-1",
            purpose: "scan tree",
            prompt: "List modules\nand summarize",
            createdAt: "2026-01-01T00:00:00.000Z",
        },
        status: {
            schemaVersion: 1,
            agentId: "550e8400-e29b-41d4-a716-446655440000",
            taskId: "task-1",
            state: "succeeded",
            createdAt: "2026-01-01T00:00:00.000Z",
            startedAt: "2026-01-01T00:00:00.500Z",
            finishedAt: "2026-01-01T00:00:02.000Z",
        },
        result: {
            schemaVersion: 1,
            agentId: "550e8400-e29b-41d4-a716-446655440000",
            taskId: "task-1",
            outcome: "succeeded",
            output: "modules ok",
            usage,
            turns: 2,
            interventions: [{ sequence: 1, timestamp: "2026-01-01T00:00:01.000Z", text: "also tests", deliveryMode: "steer", images: [] }],
            startedAt: "2026-01-01T00:00:00.500Z",
            finishedAt: "2026-01-01T00:00:02.000Z",
        },
        interventions: [{ sequence: 1, timestamp: "2026-01-01T00:00:01.000Z", text: "also tests", deliveryMode: "steer", images: [] }],
        claimed: true,
        directory: "/state/agents/a/tasks/task-1",
    },
});

function renderText(component: { render: (width: number) => string[] } | undefined, width = 80): string {
    return component?.render(width).join("\n") ?? "";
}

void test("call cards summarize submit get wait stop without raw JSON", () => {
    const submit = createSubagentSubmitTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) }, ["scout"]);
    const existingSubmit = createSubagentSubmitTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const get = createSubagentGetTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const wait = createSubagentWaitTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const stop = createSubagentStopTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const ctx = { lastComponent: undefined } as never;

    const startText = renderText(submit.renderCall?.({ profile: "scout", purpose: "scan tree", prompt: "List modules\nand summarize" }, theme, ctx));
    assert.match(startText, /1 new agent/);
    assert.match(startText, /scout/);
    assert.match(startText, /scan tree/);
    assert.match(startText, /List modules/);
    assert.doesNotMatch(startText, /\{"profile"/);

    const sendText = renderText(existingSubmit.renderCall?.({ agentId: "550e8400-e29b-41d4-a716-446655440000", purpose: "again", prompt: "Retest" }, theme, ctx));
    assert.match(sendText, /1 existing agent/);
    assert.match(sendText, /550e8400/);
    assert.match(sendText, /again/);

    const getText = renderText(get.renderCall?.({ agentId: "550e8400-e29b-41d4-a716-446655440000", debug: true }, theme, ctx));
    assert.match(getText, /550e8400/);
    assert.match(getText, /active\/latest task/);
    assert.match(getText, /DEBUG/);

    const waitText = renderText(wait.renderCall?.({ taskIds: ["t1", "t2", "t3"], condition: "all" }, theme, ctx));
    assert.match(waitText, /all · 3 tasks/);

    const stopText = renderText(stop.renderCall?.({ agentId: "550e8400-e29b-41d4-a716-446655440000" }, theme, ctx));
    assert.match(stopText, /1 agent/);
    assert.match(stopText, /550e8400/);
});

void test("stop result cards distinguish fresh stops from idempotent terminal no-ops", () => {
    const stop = createSubagentStopTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const stopped = snapshot();
    stopped.task!.status.state = "stopped";
    stopped.task!.result!.outcome = "stopped";
    const fresh = renderText(stop.renderResult?.(
        { content: [{ type: "text", text: "{}" }], details: { ...stopped, accounting: { claimedTaskIds: [] }, stopDisposition: "stopped-now" } } as never,
        { expanded: false, isPartial: false }, theme,
        { args: { taskId: stopped.task!.request.taskId }, lastComponent: undefined } as never,
    ));
    assert.match(fresh, /TASK STOPPED/);
    const repeated = renderText(stop.renderResult?.(
        { content: [{ type: "text", text: "{}" }], details: { ...stopped, accounting: { claimedTaskIds: [] }, stopDisposition: "already-terminal" } } as never,
        { expanded: false, isPartial: false }, theme,
        { args: { taskId: stopped.task!.request.taskId }, lastComponent: undefined } as never,
    ));
    assert.match(repeated, /TASK ALREADY TERMINAL/);
    const pending = renderText(stop.renderResult?.(
        { content: [{ type: "text", text: "{}" }], details: { ...stopped, accounting: { claimedTaskIds: [] }, stopDisposition: "stop-pending" } } as never,
        { expanded: false, isPartial: false }, theme,
        { args: { taskId: stopped.task!.request.taskId }, lastComponent: undefined } as never,
    ));
    assert.match(pending, /TASK CANCELLATION COMPLETED/);
});

void test("submit result cards distinguish background target contexts", () => {
    const submit = createSubagentSubmitTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) }, ["scout"]);
    const completed = renderText(submit.renderResult?.(
        { content: [{ type: "text", text: "{}" }], details: { ...snapshot(), accounting: { claimedTaskIds: [] } } } as never,
        { expanded: false, isPartial: false },
        theme,
        { args: { profile: "scout", purpose: "scan tree", prompt: "List modules" }, lastComponent: undefined } as never,
    ));
    assert.match(completed, /SUBMITTED/);
    assert.match(completed, /NEW PROFILED AGENT/);

    const running = snapshot();
    running.status.state = "busy";
    running.task!.status.state = "running";
    running.task!.result = null;
    const timeout = renderText(submit.renderResult?.(
        { content: [{ type: "text", text: "{}" }], details: { ...running, accounting: { claimedTaskIds: [] } } } as never,
        { expanded: false, isPartial: false },
        theme,
        { args: { agentId: running.agent.agentId, purpose: "scan tree", prompt: "List modules" }, lastComponent: undefined } as never,
    ));
    assert.match(timeout, /SUBMITTED/);
    assert.match(timeout, /EXISTING AGENT/);
});

void test("result cards show profile state purpose prompt and terminal preview", () => {
    const get = createSubagentGetTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const details = { ...snapshot(), accounting: { claimedTaskIds: ["task-1"] } };
    const result = { content: [{ type: "text", text: "{}" }], details } as never;
    const args = { agentId: details.agent.agentId } as never;
    const collapsed = renderText(get.renderResult?.(result, { expanded: false, isPartial: false }, theme, { args, lastComponent: undefined } as never), 60);
    assert.match(collapsed, /scout/);
    assert.match(collapsed, /IDLE/);
    assert.match(collapsed, /SUCCEEDED/);
    assert.match(collapsed, /scan tree/);
    assert.match(collapsed, /List modules/);
    assert.match(collapsed, /modules ok/);
    assert.doesNotMatch(collapsed, /"agentId"/);

    const expanded = renderText(get.renderResult?.(result, { expanded: true, isPartial: false }, theme, { args, lastComponent: undefined } as never));
    assert.match(expanded, /550e8400-e29b-41d4-a716-446655440000/);
    assert.match(expanded, /List modules/);
    assert.match(expanded, /and summarize/);
    assert.match(expanded, /interventions/);
    assert.match(expanded, /path:/);
    assert.doesNotMatch(expanded, /^\s*\{/m);
});

void test("wait cards distinguish WAITING and COMPLETED and reuse Text", () => {
    const wait = createSubagentWaitTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const running = snapshot();
    running.status.state = "busy";
    running.task!.status.state = "running";
    running.task!.result = null;
    const details = {
        condition: "all" as const,
        agents: [running],
        accounting: { claimedTaskIds: [] as string[] },
    };
    const partial = { content: [{ type: "text", text: "{}" }], details } as never;
    const first = wait.renderResult?.(partial, { expanded: false, isPartial: true }, theme, { args: {}, lastComponent: undefined } as never);
    const waiting = renderText(first);
    assert.match(waiting, /WAITING/);
    assert.match(waiting, /0\/1 complete/);

    const completedAgent = snapshot();
    const completedDetails = {
        condition: "all" as const,
        outcome: "completed" as const,
        agents: [completedAgent],
        accounting: { claimedTaskIds: ["task-1"] },
    };
    const completed = wait.renderResult?.(
        { content: [{ type: "text", text: "{}" }], details: completedDetails } as never,
        { expanded: false, isPartial: false },
        theme,
        { args: {}, lastComponent: first } as never,
    );
    assert.equal(completed, first);
    assert.match(renderText(completed), /COMPLETED/);

});

void test("debug and legacy malformed results stay card-safe", () => {
    const get = createSubagentGetTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const debugResult = {
        content: [{ type: "text", text: "{}" }],
        details: { ...snapshot(), accounting: { claimedTaskIds: [] } },
    } as never;
    const debugText = renderText(get.renderResult?.(debugResult, { expanded: true, isPartial: false }, theme, {
        args: { agentId: "550e8400-e29b-41d4-a716-446655440000", debug: true },
        lastComponent: undefined,
    } as never));
    assert.match(debugText, /DEBUG/);
    assert.match(debugText, /tmux:/);
    assert.doesNotMatch(debugText, /"profileSnapshot"/);

    const legacy = renderText(get.renderResult?.(
        { content: [{ type: "text", text: "{\"agentId\":\"legacy\",\"reason\":\"condition_met\"}" }], details: { reason: "condition_met" } } as never,
        { expanded: false, isPartial: false },
        theme,
        { args: { agentId: "x" }, lastComponent: undefined } as never,
    ));
    assert.match(legacy, /Legacy subagent result/);

    const malformed = renderText(get.renderResult?.(
        { content: [{ type: "text", text: "not-json" }], details: 12 } as never,
        { expanded: true, isPartial: false },
        theme,
        { args: { agentId: "x" }, lastComponent: undefined } as never,
    ));
    assert.match(malformed, /Malformed subagent result/);
    assert.match(malformed, /12/);
});

void test("failed terminal card shows error text without color-only state", () => {
    const stop = createSubagentStopTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const failed = snapshot();
    failed.status.state = "failed";
    failed.task!.status.state = "failed";
    failed.task!.result = {
        ...failed.task!.result!,
        outcome: "failed",
        output: "",
        error: "pane exited unexpectedly",
    };
    const text = renderText(stop.renderResult?.(
        { content: [{ type: "text", text: "{}" }], details: { ...failed, accounting: { claimedTaskIds: [] } } } as never,
        { expanded: false, isPartial: false },
        theme,
        { args: { agentId: failed.agent.agentId }, lastComponent: undefined } as never,
    ), 60);
    assert.match(text, /FAILED/);
    assert.match(text, /pane exited unexpectedly/);
});

void test("expanded submit calls show the full prompt", () => {
    const start = createSubagentSubmitTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) }, ["scout"]);
    const send = createSubagentSubmitTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const prompt = ["line one", "line two", "line three", "x".repeat(250)].join("\n");
    const collapsed = renderText(start.renderCall?.(
        { profile: "scout", purpose: "scan", prompt },
        theme,
        { lastComponent: undefined, expanded: false } as never,
    ));
    assert.match(collapsed, /line one/);
    assert.doesNotMatch(collapsed, /line three/);
    assert.doesNotMatch(collapsed, /x{250}/);

    const expanded = renderText(start.renderCall?.(
        { profile: "scout", purpose: "scan", prompt },
        theme,
        { lastComponent: undefined, expanded: true } as never,
    ));
    assert.match(expanded, /line three/);
    assert.equal(expanded.replace(/\s+/gu, "").includes("x".repeat(250)), true);

    const sendExpanded = renderText(send.renderCall?.(
        { agentId: "550e8400-e29b-41d4-a716-446655440000", purpose: "again", prompt },
        theme,
        { lastComponent: undefined, expanded: true } as never,
    ));
    assert.match(sendExpanded, /line three/);
    assert.equal(sendExpanded.replace(/\s+/gu, "").includes("x".repeat(250)), true);
});

void test("wait cards resolve colliding Nature handles within one render set", async () => {
    const { assignNatureHandles } = await import("../extensions_src/utilities/subagent_display_tree.ts");
    const wait = createSubagentWaitTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const leftId = "aaaa0000-0000-4000-8000-000000000001";
    const rightId = "aaaa0000-0000-4000-8000-00000000000a";
    const alone = new Set([
        assignNatureHandles([leftId]).get(leftId)!,
        assignNatureHandles([rightId]).get(rightId)!,
    ]);
    assert.equal(alone.size, 1);
    const expected = assignNatureHandles([leftId, rightId]);
    assert.notEqual(expected.get(leftId), expected.get(rightId));

    const left = snapshot();
    left.agent.agentId = leftId;
    left.status.agentId = leftId;
    left.task!.request.agentId = leftId;
    const right = snapshot();
    right.agent.agentId = rightId;
    right.status.agentId = rightId;
    right.task!.request.agentId = rightId;
    right.task!.request.taskId = "task-2";
    const text = renderText(wait.renderResult?.(
        {
            content: [{ type: "text", text: "{}" }],
            details: {
                condition: "all",
                timeoutSeconds: 10,
                outcome: "completed",
                agents: [left, right],
                accounting: { claimedTaskIds: [] },
            },
        } as never,
        { expanded: false, isPartial: false },
        theme,
        { args: {}, lastComponent: undefined } as never,
    ));
    assert.match(text, new RegExp(expected.get(leftId)!.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
    assert.match(text, new RegExp(expected.get(rightId)!.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
});

void test("injected nature handle words appear on agent cards", async () => {
    const { assignNatureHandles } = await import("../extensions_src/utilities/subagent_display_tree.ts");
    const { renderAgentToolResult } = await import("../extensions_src/utilities/subagent_cards.ts");
    const words = ["Quark", "Photon"] as const;
    const agent = snapshot();
    const expected = assignNatureHandles([agent.agent.agentId], words).get(agent.agent.agentId)!;
    const text = renderText(renderAgentToolResult(
        { content: [{ type: "text", text: "{}" }], details: agent } as never,
        { expanded: false, isPartial: false },
        theme,
        { args: {}, lastComponent: undefined } as never,
        undefined,
        undefined,
        words,
    ));
    assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
    assert.match(text, /Quark|Photon/);
});

void test("malformed wait members keep expanded raw fallback", () => {
    const wait = createSubagentWaitTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const text = renderText(wait.renderResult?.(
        {
            content: [{ type: "text", text: "{}" }],
            details: {
                condition: "any",
                timeoutSeconds: 5,
                outcome: "timeout",
                agents: [snapshot(), { broken: true, agentId: "partial-member" }],
                accounting: { claimedTaskIds: [] },
            },
        } as never,
        { expanded: true, isPartial: false },
        theme,
        { args: {}, lastComponent: undefined } as never,
    ));
    assert.match(text, /Legacy subagent result|Malformed subagent result/);
    assert.match(text, /partial-member/);
});

void test("shallow-valid malformed wait task does not collapse sibling cards", () => {
    const wait = createSubagentWaitTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const valid = snapshot();
    const shallowBad = {
        agent: {
            agentId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            profile: "scout",
            purpose: "broken",
        },
        status: { state: "busy" },
        task: {},
    };
    const text = renderText(wait.renderResult?.(
        {
            content: [{ type: "text", text: "{}" }],
            details: {
                condition: "all",
                timeoutSeconds: 10,
                outcome: "completed",
                agents: [valid, shallowBad],
                accounting: { claimedTaskIds: [] },
            },
        } as never,
        { expanded: true, isPartial: false },
        theme,
        { args: {}, lastComponent: undefined } as never,
    ));
    assert.match(text, /scan tree/);
    assert.match(text, /550e8400-e29b-41d4-a716-446655440000/);
    assert.match(text, /Legacy subagent result|Malformed subagent result/);
    assert.match(text, /bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb|"task":\s*\{\}/);
    assert.doesNotMatch(text, /^Malformed subagent result — expand for raw payload$/m);
});

void test("other malformed nested wait fields fall back per member", () => {
    const wait = createSubagentWaitTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const valid = snapshot();
    const malformed = {
        agent: {
            agentId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
            profile: "scout",
            purpose: "broken",
            cwd: "/x",
            tmux: {},
        },
        status: {
            state: "busy",
            agentUsage: { totalTokens: 0, cost: { total: 0 } },
        },
        task: {
            request: { purpose: "broken" },
            status: { state: "running" },
        },
    };
    const text = renderText(wait.renderResult?.(
        {
            content: [{ type: "text", text: "{}" }],
            details: {
                condition: "all",
                timeoutSeconds: 10,
                outcome: "completed",
                agents: [valid, malformed],
                accounting: { claimedTaskIds: [] },
            },
        } as never,
        { expanded: true, isPartial: false },
        theme,
        { args: {}, lastComponent: undefined } as never,
    ));
    assert.match(text, /scan tree/);
    assert.match(text, /550e8400-e29b-41d4-a716-446655440000/);
    assert.match(text, /Legacy subagent result|Malformed subagent result/);
    assert.match(text, /cccccccc-cccc-cccc-cccc-cccccccccccc/);
    assert.doesNotMatch(text, /^Malformed subagent result — expand for raw payload$/m);
});

void test("expanded error text is bounded and cards use zero Text padding", () => {
    const stop = createSubagentStopTool({ configPath: "/x", env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const failed = snapshot();
    failed.status.state = "failed";
    failed.task!.status.state = "failed";
    const longError = Array.from({ length: 80 }, (_, index) => `error line ${index} ${"y".repeat(80)}`).join("\n");
    failed.task!.result = { ...failed.task!.result!, outcome: "failed", output: "", error: longError };
    const component = stop.renderResult?.(
        { content: [{ type: "text", text: "{}" }], details: { ...failed, accounting: { claimedTaskIds: [] } } } as never,
        { expanded: true, isPartial: false },
        theme,
        { args: { agentId: failed.agent.agentId }, lastComponent: undefined } as never,
    );
    const lines = component?.render(60) ?? [];
    const text = lines.join("\n");
    assert.match(text, /error line 0/);
    assert.doesNotMatch(text, /error line 79/);
    assert.ok(lines.length > 0);
    assert.notEqual(lines[0]!.trim(), "");
    assert.notEqual(lines.at(-1)!.trim(), "");
});
