import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerModeController } from "../extensions_src/mode.ts";
import { validateExecutionProfileConfig, validateModeConfig, validateModeProfileReferences } from "../extensions_src/utilities/mode_types.ts";

const mode = { description: "Synthetic", defaultProfile: "recon-default", tools: ["read"], skillOptIns: ["prompt-interface-design"], instructions: "Stay coherent." };
const profiles = {
    schemaVersion: 2,
    profiles: {
        "recon-default": { models: ["provider/recon", "provider/small", "provider/alternate"], thinkingLevel: "low", harness: "pi" },
        alternate: { models: ["provider/alternate"], thinkingLevel: "high", harness: "pi" },
        "ops-default": { models: ["provider/ops"], thinkingLevel: "high", harness: "pi" },
        external: { models: ["cursor/fast"], harness: "cursor-agent", harnessOptions: { worktree: false, trustWorkspace: true, sandbox: "disabled", permissionPolicy: "reject", mode: "ask" } },
    },
} as const;

// Mechanical validation: the generated execution-profiles.json boundary rejects stale or malformed profile authority before mode and orchestration consumers use it.
void test("schema v2 profiles require ordered valid candidates and exact external harness contracts", () => {
    const profileConfig = validateExecutionProfileConfig(profiles);
    assert.deepEqual(validateExecutionProfileConfig({ schemaVersion: 2, profiles: { fallback: { models: ["provider/primary", "provider/fallback"], thinkingLevel: "high", harness: "pi" } } }).profiles.fallback?.models, ["provider/primary", "provider/fallback"]);
    const config = validateModeConfig({ schemaVersion: 2, defaultMode: "recon", modes: { recon: mode } });
    validateModeProfileReferences(config, profileConfig);
    assert.deepEqual(config.modes.recon, mode);
    assert.throws(() => validateExecutionProfileConfig({ ...profiles, schemaVersion: 1 }), /Unsupported/u);
    assert.throws(() => validateExecutionProfileConfig({ schemaVersion: 2, profiles: { legacy: { model: "provider/legacy", thinkingLevel: "high", harness: "pi" } } }), /unknown keys/u);
    assert.throws(() => validateExecutionProfileConfig({ schemaVersion: 2, profiles: { empty: { models: [], thinkingLevel: "high", harness: "pi" } } }), /must not be empty/u);
    assert.throws(() => validateExecutionProfileConfig({ schemaVersion: 2, profiles: { duplicate: { models: ["provider/model", "provider/model"], thinkingLevel: "high", harness: "pi" } } }), /must not contain duplicates/u);
    assert.throws(() => validateExecutionProfileConfig({ schemaVersion: 2, profiles: { malformed: { models: ["not-a-model"], thinkingLevel: "high", harness: "pi" } } }), /provider\/model/u);
    assert.throws(() => validateExecutionProfileConfig({ schemaVersion: 2, profiles: { cursor: { ...profiles.profiles.external, models: ["cursor/fast", "cursor/backup"] } } }), /exactly one cursor model/u);
    assert.throws(() => validateExecutionProfileConfig({ schemaVersion: 2, profiles: { codex: { models: ["codex/model"], thinkingLevel: "high", harness: "codex", harnessOptions: { mode: "read-only", permissionPolicy: "reject", webSearch: "live" } } } }), /exact read-only cached/u);
    assert.throws(() => validateModeConfig({ schemaVersion: 1, defaultMode: "recon", modes: { recon: mode } }), /Unsupported/u);
    assert.throws(() => validateModeConfig({ schemaVersion: 2, defaultMode: "recon", modes: { recon: { ...mode, model: "provider/legacy" } } }), /unknown keys/u);
    assert.throws(() => validateModeProfileReferences(validateModeConfig({ schemaVersion: 2, defaultMode: "recon", modes: { recon: { ...mode, defaultProfile: "external" } } }), profileConfig), /pi harness/u);
});

async function controllerFixture() {
    const root = await mkdtemp(join(tmpdir(), "mode-controller-"));
    const configPath = join(root, "agent-modes.json");
    const profilePath = join(root, "execution-profiles.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: 2, defaultMode: "recon", modes: { recon: mode, ops: { ...mode, defaultProfile: "ops-default", tools: ["read", "write"], instructions: "Operate." } } }));
    await writeFile(profilePath, JSON.stringify(profiles));
    const handlers = new Map<string, (...args: any[]) => any>();
    const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
    const entries: Array<{ type: string; data: unknown }> = [];
    const statuses: string[] = [];
    const notices: string[] = [];
    const modelCalls: string[] = [];
    const sent: Array<{ message: any; options: any }> = [];
    let activeTools = ["read"];
    let thinking = "minimal";
    let failHigh = false;
    let usage: { tokens: number | null; contextWindow: number } | undefined;
    let setModelHandler: ((model: { provider: string; id: string }) => Promise<boolean>) | undefined;
    const available = new Set(["recon", "small", "alternate", "ops", "initial"]);
    const models = {
        recon: { provider: "provider", id: "recon", contextWindow: 128_000 },
        small: { provider: "provider", id: "small", contextWindow: 2_000 },
        alternate: { provider: "provider", id: "alternate", contextWindow: 128_000 },
        ops: { provider: "provider", id: "ops", contextWindow: 128_000 },
        initial: { provider: "provider", id: "initial", contextWindow: 128_000 },
    };
    const branch: any[] = [];
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
        sessionManager: { getBranch: () => branch },
        ui: { notify: (text: string) => notices.push(text), setStatus: (_id: string, text: string) => statuses.push(text), select: async () => undefined },
    };
    const pi = {
        getActiveTools: () => [...activeTools],
        setActiveTools: (tools: string[]) => { activeTools = [...tools]; },
        getAllTools: () => [{ name: "read" }, { name: "write" }],
        getThinkingLevel: () => thinking,
        setThinkingLevel: (value: string) => { if (failHigh && value === "high") { failHigh = false; throw new Error("thinking failed"); } thinking = value; },
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
        on: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler),
        events: { emit() {}, on() { return () => {}; } },
    } as unknown as ExtensionAPI;
    const controller = registerModeController(pi, configPath, profilePath);
    return {
        controller, handlers, commands, entries, statuses, notices, modelCalls, sent, branch, ctx,
        get tools() { return activeTools; },
        get thinking() { return thinking; },
        setNativeTools(value: string[]) { activeTools = [...value]; },
        setThinking(value: string) { thinking = value; },
        setUsage(value: { tokens: number | null; contextWindow: number } | undefined) { usage = value; },
        setModelHandler(value: ((model: { provider: string; id: string }) => Promise<boolean>) | undefined) { setModelHandler = value; },
        setCurrentModel(name: keyof typeof models) { ctx.model = models[name]; },
        setAvailable(name: keyof typeof models, value: boolean) { if (value) available.add(name); else available.delete(name); },
        failNextHigh() { failHigh = true; },
    };
}

// Admitted contract: given startup and named profile selection, the parent observes the named model/thinking state while mode-owned tools remain unchanged.
void test("startup and /profile expose named execution state without changing mode tools", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    assert.equal(h.controller.activeMode(), "recon");
    assert.equal(h.controller.activeProfile(), "recon-default");
    assert.equal(h.ctx.model.id, "recon");
    assert.equal(h.thinking, "low");
    assert.deepEqual(h.tools, ["read"]);
    assert.deepEqual(h.entries.find(entry => entry.type === "agent-mode-state")?.data, { schemaVersion: 2, mode: "recon" });
    await h.commands.get("profile")!.handler("alternate", h.ctx);
    assert.equal(h.controller.activeProfile(), "alternate");
    assert.equal(h.ctx.model.id, "alternate");
    assert.equal(h.thinking, "high");
    assert.deepEqual(h.tools, ["read"]);
    assert.match(h.statuses.at(-1) ?? "", /mode:recon · profile:alternate · model:provider\/alternate · fallback:0/u);
});

// Admitted contract: given unavailable ordered candidates at mode application, the parent observes the first selectable candidate rather than a partial mode change.
void test("mode application preflights candidates in order and keeps rollback-visible state", async () => {
    const h = await controllerFixture();
    h.setAvailable("recon", false);
    await h.handlers.get("session_start")?.({}, h.ctx);
    assert.equal(h.ctx.model.id, "small");
    assert.equal(h.controller.activeProfile(), "recon-default");
    assert.equal(h.thinking, "low");
    assert.deepEqual(h.tools, ["read"]);
    const route = h.entries.at(-1)?.data as any;
    assert.equal(route.profile, "recon-default");
    assert.deepEqual(route.models, ["provider/recon", "provider/small", "provider/alternate"]);
    assert.equal(route.route.activeIndex, 1);
    assert.equal(route.route.attempts[0].message, "diagnostic redacted");
});

// Admitted contract: given a final settled provider error, the parent promotes once to a capacity-fitting candidate and continues without surfacing routing details to the model.
void test("settled errors promote stickily, skip insufficient context, and continue internally", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    h.setUsage({ tokens: 10_000, contextWindow: 128_000 });
    await h.handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "error" }] }, h.ctx);
    await h.handlers.get("agent_settled")?.({}, h.ctx);
    assert.equal(h.ctx.model.id, "alternate");
    assert.equal(h.thinking, "low");
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.sent[0]?.options, { triggerTurn: true });
    assert.equal(h.sent[0]?.message.display, false);
    assert.doesNotMatch(h.sent[0]?.message.content ?? "", /provider\/|openai|alternate/iu);
    assert.match(h.statuses.at(-1) ?? "", /model:provider\/alternate · fallback:2/u);
    const route = h.entries.at(-1)?.data as any;
    assert.equal(route.route.activeIndex, 2);
    assert.equal(route.route.attempts.find((attempt: any) => attempt.index === 1)?.category, "context");
    await h.handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "stop" }] }, h.ctx);
    await h.handlers.get("agent_settled")?.({}, h.ctx);
    assert.equal(h.sent.length, 1);
});

// Admitted contract: given a tool-result error on one settled turn, the parent does not reinterpret it as a provider failure, while the next clean turn can still use fallback and a restore selection does not suspend it.
void test("tool-result errors suppress only their turn and restore selections remain eligible for fallback", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    h.setUsage({ tokens: 10_000, contextWindow: 128_000 });
    await h.handlers.get("agent_start")?.({}, h.ctx);
    await h.handlers.get("turn_start")?.({}, h.ctx);
    await h.handlers.get("message_end")?.({ message: { role: "toolResult", isError: true } }, h.ctx);
    await h.handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "error" }] }, h.ctx);
    await h.handlers.get("agent_settled")?.({}, h.ctx);
    assert.equal(h.sent.length, 0);
    assert.equal(h.ctx.model.id, "recon");

    await h.handlers.get("agent_start")?.({}, h.ctx);
    await h.handlers.get("model_select")?.({ model: { provider: "provider", id: "recon" }, source: "restore" }, h.ctx);
    await h.handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "error" }] }, h.ctx);
    await h.handlers.get("agent_settled")?.({}, h.ctx);
    assert.equal(h.ctx.model.id, "alternate");
    assert.equal(h.sent.length, 1);
});

// Admitted contract: given exhausted fallback candidates or an explicit human model change, the parent suspends automatic routing until a named profile is applied again.
void test("exhaustion and human model selection suspend automatic fallback until /profile reapplies it", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    h.setUsage({ tokens: 10_000, contextWindow: 128_000 });
    h.setAvailable("alternate", false);
    await h.handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "error" }] }, h.ctx);
    await h.handlers.get("agent_settled")?.({}, h.ctx);
    assert.equal(h.sent.length, 0);
    assert.match(h.notices.at(-1) ?? "", /fallback exhausted/u);
    const callsAfterExhaustion = h.modelCalls.length;
    await h.handlers.get("agent_settled")?.({}, h.ctx);
    assert.equal(h.modelCalls.length, callsAfterExhaustion);
    h.setAvailable("alternate", true);
    await h.handlers.get("model_select")?.({ model: { provider: "provider", id: "recon" }, source: "set" }, h.ctx);
    assert.equal(h.controller.activeProfile(), "custom");
    await h.handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "error" }] }, h.ctx);
    await h.handlers.get("agent_settled")?.({}, h.ctx);
    assert.equal(h.sent.length, 0);
    await h.commands.get("profile")!.handler("recon-default", h.ctx);
    await h.handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "error" }] }, h.ctx);
    await h.handlers.get("agent_settled")?.({}, h.ctx);
    assert.equal(h.ctx.model.id, "alternate");
    assert.equal(h.sent.length, 1);
});

// Admitted contract: given a persisted profile candidate and a Pi session running a different model, session startup and tree restoration reselect the persisted candidate before exposing its route.
void test("reload reconciliation reselects the persisted profile candidate", async () => {
    const h = await controllerFixture();
    h.branch.push(
        { type: "custom", customType: "agent-mode-state", data: { schemaVersion: 2, mode: "recon" } },
        { type: "custom", customType: "agent-mode-profile-route", data: { schemaVersion: 1, mode: "recon", profile: "recon-default", models: [...profiles.profiles["recon-default"].models], route: { activeIndex: 2, activeModel: "provider/alternate", attempts: [] } } },
    );
    await h.handlers.get("session_start")?.({}, h.ctx);
    assert.equal(h.ctx.model.id, "alternate");
    h.setCurrentModel("recon");
    await h.handlers.get("session_tree")?.({}, h.ctx);
    assert.equal(h.ctx.model.id, "alternate");
    assert.equal(h.modelCalls.filter(modelName => modelName === "alternate").length, 2);
    assert.match(h.statuses.at(-1) ?? "", /model:provider\/alternate/u);
});

// Admitted contract: given a persisted fallback route behind Pi's current candidate, reload keeps the later current candidate rather than selecting a lower candidate.
void test("reload reconciliation never moves the parent model backward", async () => {
    const h = await controllerFixture();
    h.setCurrentModel("alternate");
    h.branch.push(
        { type: "custom", customType: "agent-mode-state", data: { schemaVersion: 2, mode: "recon" } },
        { type: "custom", customType: "agent-mode-profile-route", data: { schemaVersion: 1, mode: "recon", profile: "recon-default", models: [...profiles.profiles["recon-default"].models], route: { activeIndex: 1, activeModel: "provider/small", attempts: [] } } },
    );
    await h.handlers.get("session_start")?.({}, h.ctx);
    assert.equal(h.ctx.model.id, "alternate");
    assert.equal(h.modelCalls.includes("small"), false);
    assert.match(h.statuses.at(-1) ?? "", /model:provider\/alternate · fallback:2/u);
    await h.handlers.get("session_tree")?.({}, h.ctx);
    assert.equal(h.ctx.model.id, "alternate");
    assert.equal(h.modelCalls.includes("small"), false);
});

// Admitted contract: given shutdown while the parent waits for a promotion setModel call, no continuation is sent after Pi resolves the call.
void test("shutdown fences an in-progress parent promotion", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    h.setUsage({ tokens: 10_000, contextWindow: 128_000 });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const blocked = new Promise<void>(resolve => { entered = resolve; });
    h.setModelHandler(async () => { entered(); await gate; return true; });
    await h.handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "error" }] }, h.ctx);
    const settling = h.handlers.get("agent_settled")?.({}, h.ctx);
    await blocked;
    await h.handlers.get("session_shutdown")?.({}, h.ctx);
    release();
    await settling;
    assert.equal(h.sent.length, 0);
});

// Admitted contract: given a profile route persisted for the same profile name and candidate list, session restoration resumes that route; changing the candidate list discards it.
void test("route persistence restores only compatible profile candidates", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    h.setUsage({ tokens: 10_000, contextWindow: 128_000 });
    await h.handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "error" }] }, h.ctx);
    await h.handlers.get("agent_settled")?.({}, h.ctx);
    await h.handlers.get("session_tree")?.({}, h.ctx);
    assert.equal(h.ctx.model.id, "alternate");
    const routeEntry = h.branch.findLast((entry: any) => entry.customType === "agent-mode-profile-route");
    routeEntry.data.models = ["provider/recon"];
    await h.handlers.get("session_tree")?.({}, h.ctx);
    assert.equal(h.ctx.model.id, "recon");
});

void test("failed profile and mode applications roll back the complete visible state", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    h.failNextHigh();
    await h.commands.get("profile")!.handler("alternate", h.ctx);
    assert.equal(h.controller.activeMode(), "recon");
    assert.equal(h.controller.activeProfile(), "recon-default");
    assert.equal(h.ctx.model.id, "recon");
    assert.equal(h.thinking, "low");
    assert.deepEqual(h.tools, ["read"]);
    assert.match(h.notices.at(-1) ?? "", /thinking failed/u);
    h.failNextHigh();
    await h.commands.get("mode")!.handler("ops", h.ctx);
    assert.equal(h.controller.activeMode(), "recon");
    assert.equal(h.controller.activeProfile(), "recon-default");
    assert.equal(h.ctx.model.id, "recon");
    assert.equal(h.thinking, "low");
    assert.deepEqual(h.tools, ["read"]);
});

void test("the provider boundary reasserts the explicit mode-owned tool schema", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    h.setNativeTools(["write"]);
    await h.handlers.get("context")?.({ messages: [] }, h.ctx);
    assert.deepEqual(h.tools, ["read"]);
});

void test("slash-like prompt content cannot invoke mode or profile commands", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    const before = h.handlers.get("before_agent_start")!;
    for (const prompt of ["/mode ops", "/profile alternate", "expanded template containing /mode ops"]) await before({ prompt, systemPrompt: "base", systemPromptOptions: { skills: [] } }, h.ctx);
    assert.equal(h.controller.activeMode(), "recon");
    assert.equal(h.controller.activeProfile(), "recon-default");
    assert.equal(h.ctx.model.id, "recon");
});
