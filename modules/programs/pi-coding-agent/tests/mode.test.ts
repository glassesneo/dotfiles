import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerModeController } from "../extensions_src/mode.ts";
import { validateModeConfig } from "../extensions_src/utilities/mode_types.ts";
const mode = { model: "provider/model", description: "Synthetic", thinkingLevel: "high", allowAllTools: false, tools: ["read"], skillOptIns: ["task-orchestration"], instructions: "Stay coherent." };
void test("schema-v1 mode config exposes one exact coherent mode state", () => { const config = validateModeConfig({ schemaVersion: 1, defaultMode: "recon", modes: { recon: mode } }); assert.deepEqual(config.modes.recon, mode); });
void test("legacy routing and unknown fields are rejected", () => { assert.throws(() => validateModeConfig({ schemaVersion: 1, defaultMode: "recon", promptRoutes: {}, modes: { recon: mode } }), /unknown keys/u); assert.throws(() => validateModeConfig({ schemaVersion: 5, defaultMode: "recon", modes: { recon: mode } }), /Unsupported/u); });

async function controllerFixture() {
    const root = await mkdtemp(join(tmpdir(), "mode-controller-")); const configPath = join(root, "modes.json"); await writeFile(configPath, JSON.stringify({ schemaVersion: 1, defaultMode: "recon", modes: { recon: { ...mode, model: "provider/recon", thinkingLevel: "low" }, ops: { ...mode, model: "provider/ops", allowAllTools: true, tools: [], instructions: "Operate." } } }));
    const handlers = new Map<string, (...args: any[]) => any>(); const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>(); const entries: unknown[] = []; const statuses: string[] = []; const notices: string[] = []; const modelCalls: string[] = []; let activeTools = ["read"]; let thinking = "minimal"; let failHigh = false;
    const models = { recon: { provider: "provider", id: "recon" }, ops: { provider: "provider", id: "ops" }, initial: { provider: "provider", id: "initial" } }; const branch: any[] = [];
    const ctx: any = { model: models.initial, cwd: "/work", isIdle: () => true, modelRegistry: { find: (_provider: string, id: string) => (models as any)[id] }, sessionManager: { getBranch: () => branch }, ui: { notify: (text: string) => notices.push(text), setStatus: (_id: string, text: string) => statuses.push(text), select: async () => undefined } };
    const pi = { getActiveTools: () => [...activeTools], setActiveTools: (tools: string[]) => { activeTools = [...tools]; }, getAllTools: () => [{ name: "read" }, { name: "write" }], getThinkingLevel: () => thinking, setThinkingLevel: (value: string) => { if (failHigh && value === "high") { failHigh = false; throw new Error("thinking failed"); } thinking = value; }, async setModel(value: any) { modelCalls.push(value.id); ctx.model = value; return true; }, appendEntry: (_type: string, data: unknown) => { entries.push(data); branch.push({ type: "custom", customType: "agent-mode-state", data }); }, registerFlag() {}, getFlag: () => undefined, registerCommand: (name: string, command: any) => commands.set(name, command), on: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler), events: { emit() {}, on() { return () => {}; } } } as unknown as ExtensionAPI;
    const controller = registerModeController(pi, configPath); return { controller, handlers, commands, entries, statuses, notices, modelCalls, branch, ctx, get tools() { return activeTools; }, setNativeTools(value: string[]) { activeTools = [...value]; }, get thinking() { return thinking; }, setThinking(value: string) { thinking = value; }, failNextHigh() { failHigh = true; } };
}

void test("mode startup, restore, switch, and failed switch expose one coherent state with rollback", async () => {
    const h = await controllerFixture(); await h.handlers.get("session_start")?.({}, h.ctx); assert.equal(h.controller.activeMode(), "recon"); assert.equal(h.ctx.model.id, "recon"); assert.equal(h.thinking, "low"); assert.deepEqual(h.tools, ["read"]); assert.deepEqual(h.entries.at(-1), { schemaVersion: 1, mode: "recon" }); assert.match(h.statuses.at(-1) ?? "", /mode:recon/u);
    await h.commands.get("mode")!.handler("ops", h.ctx); assert.equal(h.controller.activeMode(), "ops"); assert.equal(h.ctx.model.id, "ops"); assert.deepEqual(h.tools, ["read", "write"]);
    h.branch.push({ type: "custom", customType: "agent-mode-state", data: { schemaVersion: 1, mode: "recon" } }); await h.handlers.get("session_tree")?.({}, h.ctx); assert.equal(h.controller.activeMode(), "recon"); assert.equal(h.ctx.model.id, "recon");
    h.failNextHigh(); await h.commands.get("mode")!.handler("ops", h.ctx); assert.equal(h.controller.activeMode(), "recon"); assert.equal(h.ctx.model.id, "recon"); assert.equal(h.thinking, "low"); assert.deepEqual(h.tools, ["read"]); assert.match(h.notices.at(-1) ?? "", /thinking failed/u);
});

void test("native model and thinking selection are reconciled to the consumer-visible active mode", async () => {
    const h = await controllerFixture(); await h.handlers.get("session_start")?.({}, h.ctx);
    h.ctx.model = { provider: "provider", id: "ops" }; await h.handlers.get("model_select")?.({ model: h.ctx.model, previousModel: { provider: "provider", id: "recon" }, source: "set" }, h.ctx);
    assert.equal(h.controller.activeMode(), "recon"); assert.equal(h.ctx.model.id, "recon"); assert.equal(h.thinking, "low"); assert.deepEqual(h.tools, ["read"]); assert.match(h.statuses.at(-1) ?? "", /mode:recon/u); assert.deepEqual(h.entries.at(-1), { schemaVersion: 1, mode: "recon" });
    h.setThinking("high");
    await h.handlers.get("thinking_level_select")?.({ level: "high", previousLevel: "low" }, h.ctx); assert.equal(h.thinking, "low"); assert.equal(h.controller.activeMode(), "recon");
});

void test("the pre-provider boundary restores mode-derived schemas after native tool removal or addition", async () => {
    const h = await controllerFixture(); await h.handlers.get("session_start")?.({}, h.ctx);
    h.setNativeTools(["write"]); await h.handlers.get("context")?.({ messages: [] }, h.ctx); assert.deepEqual(h.tools, ["read"]);
    await h.commands.get("mode")!.handler("ops", h.ctx); h.setNativeTools(["read"]); await h.handlers.get("context")?.({ messages: [] }, h.ctx); assert.deepEqual(h.tools, ["read", "write"]);
});

void test("arbitrary slash-like and expanded template prompts cannot change mode", async () => {
    const h = await controllerFixture(); await h.handlers.get("session_start")?.({}, h.ctx); const before = h.handlers.get("before_agent_start")!; for (const prompt of ["/mode ops", "/idea-design", "expanded template containing /mode ops"]) await before({ prompt, systemPrompt: "base", systemPromptOptions: { skills: [] } }, h.ctx); assert.equal(h.controller.activeMode(), "recon"); assert.equal(h.ctx.model.id, "recon"); assert.equal(h.entries.length, 1);
});
