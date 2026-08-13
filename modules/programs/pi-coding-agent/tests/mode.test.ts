import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerModeController } from "../extensions_src/mode.ts";
import { validateExecutionProfileConfig, validateModeConfig, validateModeProfileReferences } from "../extensions_src/utilities/mode_types.ts";

const mode = { description: "Synthetic", defaultProfile: "recon-default", tools: ["read"], skillOptIns: ["task-orchestration"], instructions: "Stay coherent." };
const profiles = {
    schemaVersion: 1,
    profiles: {
        "recon-default": { model: "provider/recon", thinkingLevel: "low", harness: "pi" },
        alternate: { model: "provider/alternate", thinkingLevel: "high", harness: "pi" },
        "ops-default": { model: "provider/ops", thinkingLevel: "high", harness: "pi" },
        external: { model: "cursor/fast", harness: "cursor-agent", harnessOptions: { mode: "agent" } },
    },
} as const;

void test("schema v2 modes and schema v1 profiles reject stale shape and incompatible parent defaults", () => {
    const profileConfig = validateExecutionProfileConfig(profiles);
    const config = validateModeConfig({ schemaVersion: 2, defaultMode: "recon", modes: { recon: mode } });
    validateModeProfileReferences(config, profileConfig);
    assert.deepEqual(config.modes.recon, mode);
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
    const entries: unknown[] = [];
    const statuses: string[] = [];
    const notices: string[] = [];
    const modelCalls: string[] = [];
    let activeTools = ["read"];
    let thinking = "minimal";
    let failHigh = false;
    const models = {
        recon: { provider: "provider", id: "recon" },
        alternate: { provider: "provider", id: "alternate" },
        ops: { provider: "provider", id: "ops" },
        initial: { provider: "provider", id: "initial" },
    };
    const branch: any[] = [];
    const ctx: any = {
        model: models.initial,
        cwd: "/work",
        isIdle: () => true,
        modelRegistry: { find: (_provider: string, id: string) => (models as any)[id] },
        sessionManager: { getBranch: () => branch },
        ui: { notify: (text: string) => notices.push(text), setStatus: (_id: string, text: string) => statuses.push(text), select: async () => undefined },
    };
    const pi = {
        getActiveTools: () => [...activeTools],
        setActiveTools: (tools: string[]) => { activeTools = [...tools]; },
        getAllTools: () => [{ name: "read" }, { name: "write" }],
        getThinkingLevel: () => thinking,
        setThinkingLevel: (value: string) => { if (failHigh && value === "high") { failHigh = false; throw new Error("thinking failed"); } thinking = value; },
        async setModel(value: any) { modelCalls.push(value.id); ctx.model = value; return true; },
        appendEntry: (_type: string, data: unknown) => { entries.push(data); branch.push({ type: "custom", customType: "agent-mode-state", data }); },
        registerFlag() {},
        getFlag: () => undefined,
        registerCommand: (name: string, command: any) => commands.set(name, command),
        on: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler),
        events: { emit() {}, on() { return () => {}; } },
    } as unknown as ExtensionAPI;
    const controller = registerModeController(pi, configPath, profilePath);
    return {
        controller, handlers, commands, entries, statuses, notices, modelCalls, branch, ctx,
        get tools() { return activeTools; },
        setNativeTools(value: string[]) { activeTools = [...value]; },
        get thinking() { return thinking; },
        setThinking(value: string) { thinking = value; },
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
    assert.deepEqual(h.entries.at(-1), { schemaVersion: 2, mode: "recon" });
    await h.commands.get("profile")!.handler("alternate", h.ctx);
    assert.equal(h.controller.activeProfile(), "alternate");
    assert.equal(h.ctx.model.id, "alternate");
    assert.equal(h.thinking, "high");
    assert.deepEqual(h.tools, ["read"]);
    assert.match(h.statuses.at(-1) ?? "", /mode:recon · profile:alternate/u);
    await h.handlers.get("session_tree")?.({}, h.ctx);
    assert.equal(h.controller.activeProfile(), "alternate");
    assert.equal(h.ctx.model.id, "alternate");
    assert.equal(h.thinking, "high");
});

// Admitted contract: given native model/thinking changes and a later mode switch, the parent first observes custom and then the target mode's default named profile.
void test("native overrides become custom and a mode switch resets the default profile", async () => {
    const h = await controllerFixture();
    await h.handlers.get("session_start")?.({}, h.ctx);
    h.ctx.model = { provider: "provider", id: "alternate" };
    await h.handlers.get("model_select")?.({ model: h.ctx.model, previousModel: { provider: "provider", id: "recon" }, source: "set" }, h.ctx);
    assert.equal(h.controller.activeProfile(), "custom");
    assert.equal(h.ctx.model.id, "alternate");
    h.setThinking("high");
    await h.handlers.get("thinking_level_select")?.({ level: "high", previousLevel: "low" }, h.ctx);
    assert.equal(h.thinking, "high");
    assert.equal(h.controller.activeProfile(), "custom");
    assert.deepEqual(h.tools, ["read"]);
    await h.commands.get("mode")!.handler("ops", h.ctx);
    assert.equal(h.controller.activeMode(), "ops");
    assert.equal(h.controller.activeProfile(), "ops-default");
    assert.equal(h.ctx.model.id, "ops");
    assert.equal(h.thinking, "high");
    assert.deepEqual(h.tools, ["read", "write"]);
});

// Admitted contract: given an application failure after model selection, the parent observes the complete prior mode/profile/model/thinking/tool state.
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
    assert.equal(h.entries.length, 1);
});
