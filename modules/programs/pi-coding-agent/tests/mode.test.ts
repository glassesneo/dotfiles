import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerModeController } from "../extensions_src/mode.ts";
import { PARENT_TRANSITION_REQUEST_EVENT, PARENT_TRANSITION_RESULT_EVENT } from "../extensions_src/utilities/orchestration_transition.ts";
import { validateActiveModeEvent } from "../extensions_src/utilities/mode_events.ts";
import { validateExecutionConfig, validateModeConfig } from "../extensions_src/utilities/mode_types.ts";

const execution = { models: ["provider/primary", "provider/small", "provider/alternate"], thinkingLevel: "low" as const, harness: "pi" as const };
const controlTools = ["switch_mode", "session_handoff"];
const reconMode = { description: "Synthetic recon", tools: ["read", ...controlTools], skillOptIns: ["prompt-interface-design"], instructions: "Investigate." };
const leaderMode = { description: "Synthetic leader", tools: ["read", ...controlTools], skillOptIns: [], instructions: "Delegate implementation." };
const opsMode = { description: "Synthetic ops", tools: ["read", "write", ...controlTools], skillOptIns: [], instructions: "Operate." };
const modeConfig = { schemaVersion: 4 as const, defaultMode: "recon", execution, modes: { recon: reconMode, leader: leaderMode, ops: opsMode } };

// Mechanical check: the consumer validator uniquely owns schema-v4 shape and exact parent/child harness rejection.
void test("schema v4 separates Pi parent execution from authority modes", () => {
    assert.deepEqual(validateExecutionConfig({ models: ["provider/one"], thinkingLevel: "high", harness: "pi" }).models, ["provider/one"]);
    assert.deepEqual(validateModeConfig(modeConfig), modeConfig);
    assert.throws(() => validateModeConfig({ ...modeConfig, schemaVersion: 3 }), /Unsupported/u);
    assert.throws(() => validateModeConfig({ ...modeConfig, execution: { models: ["cursor/fast"], harness: "cursor-agent", harnessOptions: { worktree: false, trustWorkspace: true, sandbox: "disabled", permissionPolicy: "reject", mode: "ask" } } }), /pi harness/u);
    assert.throws(() => validateModeConfig({ ...modeConfig, modes: { recon: { ...reconMode, execution } } }), /unknown keys/u);
    assert.deepEqual(validateActiveModeEvent({ schemaVersion: 2, name: "leader", reason: "switch" }), { schemaVersion: 2, name: "leader", reason: "switch" });
    assert.throws(() => validateActiveModeEvent({ schemaVersion: 2, name: "leader", mode: leaderMode, reason: "switch" }), /unknown keys/u);
});

async function controllerFixture() {
    const root = await mkdtemp(join(tmpdir(), "mode-controller-"));
    const configPath = join(root, "agent-modes.json");
    await writeFile(configPath, JSON.stringify(modeConfig));
    const handlerLists = new Map<string, Array<(...args: any[]) => any>>();
    const registerHandler = (name: string, handler: (...args: any[]) => any) => { handlerLists.set(name, [...(handlerLists.get(name) ?? []), handler]); };
    const handlers = {
        get(name: string) {
            const list = handlerLists.get(name);
            return list && list.length ? (...args: any[]) => { let result: unknown; for (const handler of list) result = handler(...args); return result; } : undefined;
        },
    };
    const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
    const entries: Array<{ type: string; data: unknown }> = [];
    const statuses: string[] = [];
    const notices: string[] = [];
    const modelCalls: string[] = [];
    const sent: Array<{ message: any; options: any }> = [];
    const emitted: Array<{ name: string; value: unknown }> = [];
    const registeredTools = new Map<string, any>();
    const handoffCommands: Array<{ content: unknown; options: unknown }> = [];
    const newSessionCalls: any[] = [];
    const newSessionEntries: Array<{ type: string; data: unknown }> = [];
    const freshEditor: string[] = [];
    const freshNotices: string[] = [];
    let activeTools = ["read"];
    let thinking = "minimal";
    let sessionId = "session-1";
    let editorText = "";
    let usage: { tokens: number | null; contextWindow: number } | undefined;
    let setModelHandler: ((model: { provider: string; id: string }) => Promise<boolean>) | undefined;
    let transitionResponder: ((value: any) => unknown) | undefined;
    const emitTransitionResult = (value: any) => handlers.get(`event:${PARENT_TRANSITION_RESULT_EVENT}`)?.(value);
    const available = new Set(["primary", "small", "alternate", "manual", "initial"]);
    const models = {
        primary: { provider: "provider", id: "primary", contextWindow: 128_000 },
        small: { provider: "provider", id: "small", contextWindow: 2_000 },
        alternate: { provider: "provider", id: "alternate", contextWindow: 128_000 },
        manual: { provider: "provider", id: "manual", contextWindow: 128_000 },
        initial: { provider: "provider", id: "initial", contextWindow: 128_000 },
    };
    const branch: any[] = [];
    const sessionManager = { getBranch: () => branch, getSessionId: () => sessionId, getSessionFile: () => "/tmp/synthetic-session.jsonl" };
    const ctx: any = {
        model: models.initial,
        cwd: "/work",
        isIdle: () => true,
        getContextUsage: () => usage,
        modelRegistry: {
            find: (_provider: string, id: string) => available.has(id) ? (models as any)[id] : undefined,
            hasConfiguredAuth: (model: any) => available.has(model.id),
            getApiKeyAndHeaders: async (model: any) => available.has(model.id) ? { ok: true } : { ok: false, error: "token=not-for-display" },
        },
        sessionManager,
        ui: { notify: (text: string) => notices.push(text), setStatus: (_id: string, text: string) => statuses.push(text), select: async () => undefined, getEditorText: () => editorText, editor: async (_title: string, prefill: string) => prefill },
    };
    const commandCtx: any = {
        isIdle: () => true,
        waitForIdle: async () => {},
        sessionManager,
        model: ctx.model,
        ui: { notify: (text: string) => notices.push(text), setStatus: (_id: string, text: string) => statuses.push(text) },
        newSession: async (options: any) => {
            await options.setup?.({ appendCustomEntry: (type: string, data: unknown) => newSessionEntries.push({ type, data }) });
            await options.withSession?.({ ui: { setEditorText: (text: string) => freshEditor.push(text), notify: (text: string) => freshNotices.push(text) } });
            newSessionCalls.push(options);
            return { cancelled: false };
        },
    };
    const pi = {
        getActiveTools: () => [...activeTools],
        setActiveTools: (tools: string[]) => { activeTools = [...tools]; },
        getAllTools: () => [{ name: "read" }, { name: "write" }, { name: "switch_mode" }, { name: "session_handoff" }],
        getThinkingLevel: () => thinking,
        setThinkingLevel: (value: string) => { thinking = value; },
        async setModel(value: any) {
            modelCalls.push(value.id);
            const selected = setModelHandler ? await setModelHandler(value) : available.has(value.id);
            if (selected) ctx.model = value;
            return selected;
        },
        appendEntry: (type: string, data: unknown) => { entries.push({ type, data }); branch.push({ type: "custom", customType: type, data }); },
        sendMessage: (message: unknown, options: unknown) => sent.push({ message, options }),
        registerFlag() {},
        getFlag: () => undefined,
        registerCommand: (name: string, command: any) => commands.set(name, command),
        registerTool: (tool: any) => { registeredTools.set(tool.name, tool); },
        sendUserMessage: (content: unknown, options: unknown) => handoffCommands.push({ content, options }),
        on: (name: string, handler: (...args: any[]) => any) => { registerHandler(name, handler); },
        events: {
            emit: (name: string, value: unknown) => {
                emitted.push({ name, value });
                if (name === PARENT_TRANSITION_REQUEST_EVENT && transitionResponder) return transitionResponder(value);
                return true;
            },
            on(name: string, handler: (...args: any[]) => any) { registerHandler(`event:${name}`, handler); },
        },
    } as unknown as ExtensionAPI;
    const healthyMeshResponder = (value: any) => {
        if (value.operation === "prepare") emitTransitionResult({ schemaVersion: 1, requestId: value.requestId, status: "prepared", token: `token-${value.requestId.slice(0, 8)}` });
        else if (value.operation === "apply") emitTransitionResult({ schemaVersion: 1, requestId: value.requestId, status: "applied" });
        else emitTransitionResult({ schemaVersion: 1, requestId: value.requestId, status: "cancelled" });
    };
    transitionResponder = healthyMeshResponder;
    const controller = registerModeController(pi, configPath);
    const latestExecution = () => [...entries].reverse().find(entry => entry.type === "agent-parent-execution-state")?.data as any;
    return {
        controller, handlers, commands, entries, statuses, notices, modelCalls, sent, emitted, branch, ctx, commandCtx, latestExecution, registeredTools, handoffCommands, newSessionCalls, newSessionEntries, freshEditor, freshNotices,
        get tools() { return activeTools; },
        get thinking() { return thinking; },
        setNativeTools(value: string[]) { activeTools = [...value]; },
        setThinking(value: string) { thinking = value; },
        setUsage(value: { tokens: number | null; contextWindow: number } | undefined) { usage = value; },
        setModelHandler(value: ((model: { provider: string; id: string }) => Promise<boolean>) | undefined) { setModelHandler = value; },
        setCurrentModel(name: keyof typeof models) { ctx.model = models[name]; },
        setSessionId(value: string) { sessionId = value; },
        setEditorText(value: string) { editorText = value; },
        setAvailable(name: keyof typeof models, value: boolean) { if (value) available.add(name); else available.delete(name); },
        setTransitionResponder(value: ((value: any) => unknown) | undefined) { transitionResponder = value; },
        async tick() { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); },
    };
}

// Admission: a schema cannot observe ordered candidate activation at the controller boundary; failed preflight would leave a parent unusable.
// Given a new session with unavailable candidates, when parent execution initializes, the parent observes the first selectable candidate and one common route independent of mode.
void test("new sessions initialize the common execution in candidate order", async () => {
    const h = await controllerFixture();
    h.setAvailable("primary", false);
    await h.handlers.get("session_start")?.({}, h.ctx);
    assert.equal(h.controller.activeMode(), "recon");
    assert.equal(h.ctx.model.id, "small");
    assert.equal(h.thinking, "low");
    assert.deepEqual(h.tools, reconMode.tools);
    assert.deepEqual(h.entries.find(entry => entry.type === "agent-mode-state")?.data, { schemaVersion: 2, mode: "recon" });
    assert.equal(h.latestExecution().state, "active");
    assert.deepEqual(h.latestExecution().models, execution.models);
    assert.equal(h.latestExecution().route.activeIndex, 1);
    assert.equal(h.latestExecution().route.attempts[0].message, "diagnostic redacted");
    assert.match(h.statuses.at(-1) ?? "", /mode:recon · model:provider\/small · fallback:1/u);
});

// Admission: parent controls are a distinct runtime contract from mode authority tools; their availability must survive every parent mode.
// Given each configured parent mode, when it is active, the consumer observes both control tools while leader remains read-only.
void test("parent control tools remain active across all parent modes", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    for (const [name, authorityTools] of Object.entries({ recon: reconMode.tools, leader: leaderMode.tools, ops: opsMode.tools })) {
        await h.commands.get("mode")!.handler(name, h.ctx);
        assert.deepEqual(h.tools, authorityTools);
        for (const toolName of ["switch_mode", "session_handoff"]) assert.equal(h.handlers.get("tool_call")?.({ toolCallId: `${name}-${toolName}`, toolName }, h.ctx), undefined);
    }
    assert.deepEqual(leaderMode.tools, ["read", ...controlTools]);
});

// Admission: mode application and execution routing are separate runtime owners; types cannot detect an accidental setModel/reset during a switch.
// Given an active routed parent, when mode changes, the consumer observes only tools/instructions/identity/event changes and unchanged model, thinking, route, and fallback state.
void test("mode switches preserve common execution and emit the payload-only mode event", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    const calls = h.modelCalls.length;
    const executionEntries = h.entries.filter(entry => entry.type === "agent-parent-execution-state").length;
    await h.commands.get("mode")!.handler("ops", h.ctx);
    assert.equal(h.controller.activeMode(), "ops");
    assert.equal(h.ctx.model.id, "primary");
    assert.equal(h.thinking, "low");
    assert.deepEqual(h.tools, opsMode.tools);
    assert.equal(h.modelCalls.length, calls);
    assert.equal(h.entries.filter(entry => entry.type === "agent-parent-execution-state").length, executionEntries);
    assert.deepEqual(h.emitted.at(-1), { name: "neo.dotfiles.pi:active-mode", value: { schemaVersion: 2, name: "ops", reason: "switch" } });
});

// Admission: provider failure, tool failure, and capacity headroom are runtime facts not covered by config validation.
// Given settled failures, when they cross the fallback controller, only a clean provider error promotes to a capacity-fitting candidate and continues once.
void test("provider fallback skips insufficient context while tool errors suppress only their turn", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    h.setUsage({ tokens: 10_000, contextWindow: 128_000 });
    await h.handlers.get("agent_start")?.({}, h.ctx);
    await h.handlers.get("message_end")?.({ message: { role: "toolResult", isError: true } }, h.ctx);
    await h.handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "error" }] }, h.ctx);
    await h.handlers.get("agent_settled")?.({}, h.ctx);
    assert.equal(h.ctx.model.id, "primary");
    assert.equal(h.sent.length, 0);

    await h.handlers.get("before_agent_start")?.({ prompt: "continue synthetic work", systemPrompt: "base", systemPromptOptions: { skills: [] } }, h.ctx);
    await h.handlers.get("agent_start")?.({}, h.ctx);
    await h.handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "error" }] }, h.ctx);
    await h.handlers.get("agent_settled")?.({}, h.ctx);
    assert.equal(h.ctx.model.id, "alternate");
    assert.equal(h.thinking, "low");
    assert.equal(h.latestExecution().state, "active");
    assert.equal(h.latestExecution().route.attempts.find((attempt: any) => attempt.index === 1)?.category, "context");
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.sent[0]?.options, { triggerTurn: true });
    assert.doesNotMatch(h.sent[0]?.message.content ?? "", /provider\/|alternate/iu);
});

// Admission: explicit native overrides can be overwritten only by runtime lifecycle code; schema validation cannot prove suspension survives mode/reload/tree boundaries.
// Given an explicit model/thinking override, when mode, reload, and tree restoration occur, the parent preserves native execution and keeps fallback manual.
void test("manual execution suspension survives mode switches, reload, and tree restore", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    h.setCurrentModel("manual");
    h.setThinking("high");
    await h.handlers.get("model_select")?.({ source: "set", model: h.ctx.model }, h.ctx);
    await h.handlers.get("thinking_level_select")?.({ level: "high", previousLevel: "low" }, h.ctx);
    assert.equal(h.latestExecution().state, "manual");
    const calls = h.modelCalls.length;

    await h.commands.get("mode")!.handler("leader", h.ctx);
    await h.handlers.get("session_start")?.({}, h.ctx);
    await h.handlers.get("session_tree")?.({}, h.ctx);
    assert.equal(h.controller.activeMode(), "leader");
    assert.equal(h.ctx.model.id, "manual");
    assert.equal(h.thinking, "high");
    assert.equal(h.modelCalls.length, calls);
    assert.equal(h.latestExecution().state, "manual");

    await h.handlers.get("before_agent_start")?.({ prompt: "must not fallback", systemPrompt: "base", systemPromptOptions: { skills: [] } }, h.ctx);
    await h.handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "error" }] }, h.ctx);
    await h.handlers.get("agent_settled")?.({}, h.ctx);
    assert.equal(h.sent.length, 0);
});

// Admission: an exhausted route is a distinct persisted consumer state; resetting it on mode/reload would retry providers contrary to user-observable suspension.
// Given exhausted common execution, when mode changes and the session reloads, no candidate or continuation is retried.
void test("exhausted fallback stays stopped across mode changes and reload", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    h.setUsage({ tokens: 10_000, contextWindow: 128_000 });
    h.setAvailable("alternate", false);
    await h.handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "error" }] }, h.ctx);
    await h.handlers.get("agent_settled")?.({}, h.ctx);
    assert.equal(h.latestExecution().state, "exhausted");
    const calls = h.modelCalls.length;
    h.setAvailable("alternate", true);
    await h.commands.get("mode")!.handler("ops", h.ctx);
    await h.handlers.get("session_start")?.({}, h.ctx);
    await h.handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "error" }] }, h.ctx);
    await h.handlers.get("agent_settled")?.({}, h.ctx);
    assert.equal(h.modelCalls.length, calls);
    assert.equal(h.sent.length, 0);
    assert.equal(h.latestExecution().state, "exhausted");
});

// Admission: branch-local route restoration and config compatibility are executable persistence behavior, not a type-system guarantee.
// Given active saved execution, when reload/tree selects a branch, a compatible route resumes forward while an incompatible identity initializes from the new config.
void test("active execution restores only from a compatible branch state", async () => {
    const h = await controllerFixture();
    h.branch.push(
        { type: "custom", customType: "agent-mode-state", data: { schemaVersion: 2, mode: "leader" } },
        { type: "custom", customType: "agent-parent-execution-state", data: { schemaVersion: 1, state: "active", models: [...execution.models], thinkingLevel: "low", route: { activeIndex: 2, activeModel: "provider/alternate", attempts: [] } } },
        { type: "custom", customType: "agent-mode-execution-route", data: { schemaVersion: 1, mode: "ops", models: [...execution.models], route: { activeIndex: 1, activeModel: "provider/small", attempts: [] } } },
    );
    await h.handlers.get("session_start")?.({}, h.ctx);
    assert.equal(h.controller.activeMode(), "leader");
    assert.equal(h.ctx.model.id, "alternate");
    assert.equal(h.modelCalls.includes("small"), false);

    const latest = h.branch.findLast((entry: any) => entry.customType === "agent-parent-execution-state");
    latest.data.models = ["provider/changed"];
    h.setCurrentModel("manual");
    await h.handlers.get("session_tree")?.({}, h.ctx);
    assert.equal(h.ctx.model.id, "primary");
    assert.equal(h.latestExecution().state, "active");
});

// Admission: shutdown can race asynchronous model activation; without the runtime fence a hidden continuation starts after teardown.
// Given shutdown during promotion, when setModel resolves, the controller sends no continuation.
void test("shutdown fences an in-progress parent promotion", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    h.setUsage({ tokens: 10_000, contextWindow: 128_000 });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const blocked = new Promise<void>(resolve => { entered = resolve; });
    h.setModelHandler(async () => { entered(); await gate; return true; });
    await h.handlers.get("before_agent_start")?.({ prompt: "shutdown race", systemPrompt: "base", systemPromptOptions: { skills: [] } }, h.ctx);
    await h.handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "error" }] }, h.ctx);
    const settling = h.handlers.get("agent_settled")?.({}, h.ctx);
    await blocked;
    await h.handlers.get("session_shutdown")?.({}, h.ctx);
    release();
    await settling;
    assert.equal(h.sent.length, 0);
});

void test("the provider boundary reasserts mode tools without changing execution", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    const calls = h.modelCalls.length;
    h.setNativeTools(["write"]);
    await h.handlers.get("context")?.({ messages: [] }, h.ctx);
    assert.deepEqual(h.tools, ["read", "switch_mode", "session_handoff"]);
    assert.equal(h.modelCalls.length, calls);
});

// Mechanical check: switch_mode reserves work in the tool turn and applies it only through the internal command.
void test("switch_mode validates, schedules, and applies one pending mode switch", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    const tool = h.registeredTools.get("switch_mode")!;

    await h.handlers.get("turn_start")?.({}, h.ctx);
    await h.handlers.get("tool_call")?.({ toolCallId: "call-unchanged", toolName: "switch_mode" }, h.ctx);
    const unchanged = await tool.execute("call-unchanged", { mode: "recon" }, new AbortController().signal, () => {}, h.ctx);
    assert.match((unchanged.content[0] as any).text, /^unchanged:/u);
    assert.equal(unchanged.isError, undefined);

    await h.handlers.get("turn_start")?.({}, h.ctx);
    await h.handlers.get("tool_call")?.({ toolCallId: "call-unknown", toolName: "switch_mode" }, h.ctx);
    const unknown = await tool.execute("call-unknown", { mode: "missing" }, new AbortController().signal, () => {}, h.ctx);
    assert.equal(unknown.isError, true);
    assert.match((unknown.content[0] as any).text, /^Unknown mode/u);

    await h.handlers.get("turn_start")?.({}, h.ctx);
    await h.handlers.get("tool_call")?.({ toolCallId: "call-1", toolName: "switch_mode" }, h.ctx);
    const scheduled = await tool.execute("call-1", { mode: "ops" }, new AbortController().signal, () => {}, h.ctx);
    assert.equal(scheduled.isError, undefined);
    assert.equal(scheduled.terminate, true);
    assert.match((scheduled.content[0] as any).text, /^scheduled/u);
    assert.equal(h.controller.activeMode(), "recon");
    assert.deepEqual(h.tools, reconMode.tools);
    assert.match(String(h.handoffCommands[0]?.content), /^\/mode-switch [0-9a-f-]+$/u);
    assert.deepEqual(h.handoffCommands[0]?.options, { deliverAs: "followUp", expandPromptTemplates: true });

    await h.handlers.get("turn_start")?.({}, h.ctx);
    await h.handlers.get("tool_call")?.({ toolCallId: "call-pending", toolName: "switch_mode" }, h.ctx);
    const pending = await tool.execute("call-pending", { mode: "leader" }, new AbortController().signal, () => {}, h.ctx);
    assert.equal(pending.isError, true);
    assert.match((pending.content[0] as any).text, /already pending/u);

    const requestId = String(h.handoffCommands[0]!.content).split(" ")[1]!;
    await h.commands.get("mode-switch")!.handler(requestId, h.commandCtx);
    assert.equal(h.controller.activeMode(), "ops");
    assert.deepEqual(h.tools, opsMode.tools);
    const receipts = h.entries.filter(entry => entry.type === "agent-mesh-transition").map(entry => entry.data as any);
    assert.equal(receipts.length, 1);
    const receipt = receipts[0]!;
    assert.equal(receipt.schemaVersion, 1);
    assert.deepEqual({ kind: receipt.kind, status: receipt.status, mode: receipt.mode, requestId: receipt.requestId }, { kind: "mode", status: "applied", mode: "ops", requestId });
    assert.match(receipt.completedAt, /^\d{4}-\d{2}-\d{2}T/u);
    const continuations = h.sent.filter(message => (message.message as any).customType === "agent-mode-continuation");
    assert.equal(continuations.length, 1);
    assert.deepEqual(continuations[0]?.options, { triggerTurn: true, deliverAs: "followUp" });

    await h.commands.get("mode-switch")!.handler(requestId, h.commandCtx);
    assert.equal(h.notices.at(-1), "Mode switch request is unknown or was already consumed");

    const stale = await controllerFixture();
    await stale.handlers.get("session_start")?.({}, stale.ctx);
    await stale.handlers.get("turn_start")?.({}, stale.ctx);
    await stale.handlers.get("tool_call")?.({ toolCallId: "stale-call", toolName: "switch_mode" }, stale.ctx);
    await stale.registeredTools.get("switch_mode")!.execute("stale-call", { mode: "ops" }, new AbortController().signal, () => {}, stale.ctx);
    const staleRequestId = String(stale.handoffCommands[0]!.content).split(" ")[1]!;
    stale.setSessionId("session-2");
    await stale.commands.get("mode-switch")!.handler(staleRequestId, stale.commandCtx);
    assert.match(stale.notices.at(-1) ?? "", /session changed/u);
    assert.equal(stale.controller.activeMode(), "recon");

    const expired = await controllerFixture();
    await expired.handlers.get("session_start")?.({}, expired.ctx);
    await expired.handlers.get("turn_start")?.({}, expired.ctx);
    await expired.handlers.get("tool_call")?.({ toolCallId: "expired-call", toolName: "switch_mode" }, expired.ctx);
    await expired.registeredTools.get("switch_mode")!.execute("expired-call", { mode: "ops" }, new AbortController().signal, () => {}, expired.ctx);
    const expiredRequestId = String(expired.handoffCommands[0]!.content).split(" ")[1]!;
    const now = Date.now;
    Date.now = () => now() + 5 * 60 * 1000 + 1;
    try { await expired.commands.get("mode-switch")!.handler(expiredRequestId, expired.commandCtx); }
    finally { Date.now = now; }
    assert.match(expired.notices.at(-1) ?? "", /expired/u);
    assert.equal(expired.controller.activeMode(), "recon");
});

// Admission: batching switch_mode with other tools would change authority mid-batch; the standalone check is runtime behavior.
// Given two tool calls in one batch, when switch_mode runs, it fails without changing the mode or contacting the mesh.
void test("switch_mode refuses to run inside a mixed tool batch", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    await h.handlers.get("turn_start")?.({}, h.ctx);
    await h.handlers.get("tool_call")?.({ toolCallId: "call-1", toolName: "switch_mode" }, h.ctx);
    await h.handlers.get("tool_call")?.({ toolCallId: "call-2", toolName: "bash" }, h.ctx);
    const tool = h.registeredTools.get("switch_mode")!;
    const result = await tool.execute("call-1", { mode: "ops" }, new AbortController().signal, () => {}, h.ctx);
    assert.equal(result.isError, true);
    assert.equal(h.controller.activeMode(), "recon");
    assert.deepEqual(h.tools, reconMode.tools);
    assert.equal(h.emitted.filter(entry => entry.name === PARENT_TRANSITION_REQUEST_EVENT).length, 0);
});

// Mechanical check: a failed command-time apply restores the configured parent mode and reports the mesh failure.
void test("mode-switch rolls back the parent side when the mesh apply fails", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    await h.handlers.get("turn_start")?.({}, h.ctx);
    await h.handlers.get("tool_call")?.({ toolCallId: "call-1", toolName: "switch_mode" }, h.ctx);
    const tool = h.registeredTools.get("switch_mode")!;
    const scheduled = await tool.execute("call-1", { mode: "ops" }, new AbortController().signal, () => {}, h.ctx);
    assert.equal(scheduled.terminate, true);

    const emitTransitionResult = (value: any) => { const emit = h.handlers.get(`event:${PARENT_TRANSITION_RESULT_EVENT}`); if (emit) emit(value); };
    h.setTransitionResponder(value => {
        if (value.operation === "prepare") emitTransitionResult({ schemaVersion: 1, requestId: value.requestId, status: "prepared", token: `token-${value.requestId.slice(0, 8)}` });
        else if (value.operation === "apply") emitTransitionResult({ schemaVersion: 1, requestId: value.requestId, status: "failed", error: "synthetic mesh failure" });
    });
    const requestId = String(h.handoffCommands[0]!.content).split(" ")[1]!;
    await h.commands.get("mode-switch")!.handler(requestId, h.commandCtx);
    assert.equal(h.controller.activeMode(), "recon");
    assert.deepEqual(h.tools, reconMode.tools);
    assert.deepEqual(h.branch.findLast((entry: any) => entry.customType === "agent-mode-state")?.data, { schemaVersion: 2, mode: "recon" });
    assert.match(h.notices.at(-1) ?? "", /not applied/u);
    assert.match(h.notices.join(" "), /synthetic mesh failure/u);
    const continuations = h.sent.filter(message => (message.message as any).customType === "agent-mode-continuation");
    assert.equal(continuations.length, 1);
    assert.deepEqual(continuations[0]?.options, { triggerTurn: true, deliverAs: "followUp" });
});

// Admission: a scheduled refusal ends the original model turn; one continuation is required to wake the model with the durable reason.
// Given a pending switch whose prepare is refused, when /mode-switch runs, the mode stays unchanged and exactly one follow-up turn is queued.
void test("mode-switch queues one continuation after prepare refusal", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    await h.handlers.get("turn_start")?.({}, h.ctx);
    await h.handlers.get("tool_call")?.({ toolCallId: "call-refused", toolName: "switch_mode" }, h.ctx);
    const scheduled = await h.registeredTools.get("switch_mode")!.execute("call-refused", { mode: "ops" }, new AbortController().signal, () => {}, h.ctx);
    assert.equal(scheduled.terminate, true);
    const requestId = String(h.handoffCommands[0]!.content).split(" ")[1]!;
    const emitTransitionResult = (value: any) => { const emit = h.handlers.get(`event:${PARENT_TRANSITION_RESULT_EVENT}`); if (emit) emit(value); };
    h.setTransitionResponder(value => emitTransitionResult({ schemaVersion: 1, requestId: value.requestId, status: "rejected", error: "agent worker is starting" }));
    await h.commands.get("mode-switch")!.handler(requestId, h.commandCtx);
    assert.equal(h.controller.activeMode(), "recon");
    assert.match(h.notices.join(" "), /refused/u);
    assert.match(h.notices.join(" "), /agent worker is starting/u);
    const continuations = h.sent.filter(message => (message.message as any).customType === "agent-mode-continuation");
    assert.equal(continuations.length, 1);
    assert.deepEqual(continuations[0]?.options, { triggerTurn: true, deliverAs: "followUp" });
});

// Admission: a refused prepare must not touch the parent; the failure reason is user-visible.
// Given a mesh that refuses prepare, when /mode switches, the mode is unchanged and the refusal is surfaced.
void test("/mode surfaces a refused transition without changing the mode", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    const emitTransitionResult = (value: any) => { const emit = h.handlers.get(`event:${PARENT_TRANSITION_RESULT_EVENT}`); if (emit) emit(value); };
    h.setTransitionResponder(value => emitTransitionResult({ schemaVersion: 1, requestId: value.requestId, status: "rejected", error: "mesh is not quiescent" }));
    await h.commands.get("mode")!.handler("ops", h.ctx);
    assert.equal(h.controller.activeMode(), "recon");
    assert.deepEqual(h.tools, reconMode.tools);
    assert.match(h.notices.at(-1) ?? "", /mesh is not quiescent/u);
});

// Mechanical check: session_handoff turns confirmed editor text into a fresh-session setup without sending it as a user message.
void test("session_handoff schedules and executes a fresh ops session", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    await h.handlers.get("turn_start")?.({}, h.ctx);
    await h.handlers.get("tool_call")?.({ toolCallId: "call-2", toolName: "session_handoff" }, h.ctx);
    const tool = h.registeredTools.get("session_handoff")!;
    const empty = await tool.execute("call-2", { prompt: "" }, new AbortController().signal, () => {}, h.ctx);
    assert.equal(empty.isError, true);
    assert.match((empty.content[0] as any).text, /non-empty prompt/u);

    h.setEditorText("uncommitted draft");
    await h.handlers.get("turn_start")?.({}, h.ctx);
    await h.handlers.get("tool_call")?.({ toolCallId: "draft-call", toolName: "session_handoff" }, h.ctx);
    const draft = await tool.execute("draft-call", { prompt: "Draft this handoff" }, new AbortController().signal, () => {}, h.ctx);
    assert.equal(draft.isError, true);
    assert.match((draft.content[0] as any).text, /uncommitted draft/u);
    h.setEditorText("");

    const prompt = "Implement the synthetic path";
    await h.handlers.get("turn_start")?.({}, h.ctx);
    await h.handlers.get("tool_call")?.({ toolCallId: "call-2", toolName: "session_handoff" }, h.ctx);
    const result = await tool.execute("call-2", { prompt }, new AbortController().signal, () => {}, h.ctx);
    assert.equal(result.isError, undefined);
    assert.equal(result.terminate, true);
    assert.match((result.content[0] as any).text, /^scheduled/u);
    assert.match(String(h.handoffCommands[0]?.content), /^\/mesh-handoff [0-9a-f-]+$/u);
    assert.deepEqual(h.handoffCommands[0]?.options, { deliverAs: "followUp", expandPromptTemplates: true });
    assert.equal(h.emitted.filter(entry => entry.name === PARENT_TRANSITION_REQUEST_EVENT).length, 0);

    await h.handlers.get("turn_start")?.({}, h.ctx);
    await h.handlers.get("tool_call")?.({ toolCallId: "pending-call", toolName: "session_handoff" }, h.ctx);
    const pending = await tool.execute("pending-call", { prompt: "Another handoff" }, new AbortController().signal, () => {}, h.ctx);
    assert.equal(pending.isError, true);
    assert.match((pending.content[0] as any).text, /already pending/u);

    const requestId = String(h.handoffCommands[0]!.content).split(" ")[1]!;
    await h.commands.get("mesh-handoff")!.handler(requestId, h.commandCtx);
    const receipt = h.entries.findLast(entry => entry.type === "agent-mesh-transition")?.data as any;
    assert.deepEqual({ kind: receipt.kind, status: receipt.status, requestId: receipt.requestId }, { kind: "handoff", status: "prepared", requestId });
    assert.match(receipt.completedAt, /^\d{4}-\d{2}-\d{2}T/u);
    assert.deepEqual(h.newSessionEntries, [
        { type: "agent-mode-state", data: { schemaVersion: 2, mode: "ops" } },
        { type: "agent-session-handoff", data: { schemaVersion: 1, requestId, sourceSessionId: "session-1", targetMode: "ops" } },
    ]);
    assert.deepEqual(h.freshEditor, [prompt]);
    assert.match(h.freshNotices[0] ?? "", /handoff complete/u);
    assert.equal(h.sent.length, 0);
    assert.equal(h.newSessionCalls.length, 1);
    assert.equal(h.newSessionCalls[0]?.parentSession, h.ctx.sessionManager.getSessionFile());

    await h.handlers.get("turn_start")?.({}, h.ctx);
    await h.handlers.get("tool_call")?.({ toolCallId: "rejected-call", toolName: "session_handoff" }, h.ctx);
    await tool.execute("rejected-call", { prompt: "Rejected handoff" }, new AbortController().signal, () => {}, h.ctx);
    const rejectedRequestId = String(h.handoffCommands.at(-1)!.content).split(" ")[1]!;
    const emitTransitionResult = (value: any) => { const emit = h.handlers.get(`event:${PARENT_TRANSITION_RESULT_EVENT}`); if (emit) emit(value); };
    h.setTransitionResponder(value => emitTransitionResult({ schemaVersion: 1, requestId: value.requestId, status: "rejected", error: "synthetic handoff refusal" }));
    await h.commands.get("mesh-handoff")!.handler(rejectedRequestId, h.commandCtx);
    assert.match(h.notices.at(-1) ?? "", /refused/u);
    assert.match(h.notices.join(" "), /synthetic handoff refusal/u);
    assert.equal(h.newSessionCalls.length, 1);
});

// Admission: an edited-out summary must cancel without dispatching; the mesh is never contacted.
// Given an editor that returns no summary, when session_handoff runs, nothing is queued.
void test("session_handoff cancels on an empty editor result", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    (h.ctx.ui as any).editor = async () => "   ";
    await h.handlers.get("turn_start")?.({}, h.ctx);
    await h.handlers.get("tool_call")?.({ toolCallId: "call-2", toolName: "session_handoff" }, h.ctx);
    const tool = h.registeredTools.get("session_handoff")!;
    const result = await tool.execute("call-2", { prompt: "Draft this handoff" }, new AbortController().signal, () => {}, h.ctx);
    assert.equal(result.isError, undefined);
    assert.match((result.content[0] as any).text, /^cancelled/u);
    assert.equal(h.handoffCommands.length, 0);
});

// Mechanical check: a handoff session must start in the handoff target mode even when older saved state says otherwise.
// Given a fresh branch carrying only saved recon state plus the handoff metadata entry, when the new session starts, ops wins over the saved mode.
void test("a handoff session starts in the target mode over saved state", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    h.branch.length = 0;
    h.branch.push({ type: "custom", customType: "agent-mode-state", data: { schemaVersion: 2, mode: "recon" } });
    h.branch.push({ type: "custom", customType: "agent-session-handoff", data: { schemaVersion: 1, requestId: "handoff-1", sourceSessionId: "session-1", targetMode: "ops" } });
    await h.handlers.get("session_start")?.({ type: "session_start", reason: "new" }, h.ctx);
    assert.equal(h.controller.activeMode(), "ops");
    assert.deepEqual(h.tools, opsMode.tools);

    const control = await controllerFixture();
    control.branch.length = 0;
    control.branch.push({ type: "custom", customType: "agent-mode-state", data: { schemaVersion: 2, mode: "recon" } });
    await control.handlers.get("session_start")?.({ type: "session_start", reason: "reload" }, control.ctx);
    assert.equal(control.controller.activeMode(), "recon");
});

// Mechanical check: an unknown or consumed internal handoff request cannot replace the current session.
void test("/mesh-handoff rejects an unknown request and does nothing", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    await h.commands.get("mesh-handoff")!.handler("missing", h.commandCtx);
    assert.equal(h.notices.at(-1), "Session handoff request is unknown or was already consumed");
    assert.equal(h.newSessionCalls.length, 0);
    assert.equal(h.emitted.filter(entry => entry.name === PARENT_TRANSITION_REQUEST_EVENT).length, 0);
});
