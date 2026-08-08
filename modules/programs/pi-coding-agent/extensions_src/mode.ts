import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSkillsForPrompt, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { provideCommandPaletteContribution } from "./utilities/command_palette_contributions.ts";
import { emitActiveMode, type ActiveModeReason } from "./utilities/mode_events.ts";
import { validateModeConfig, type AgentMode, type AgentModeConfig } from "./utilities/mode_types.ts";

const CONFIG = join(getAgentDir(), "agent-modes.json");
const MODE_STATE = "agent-mode-state";
const MODE_STATUS = "agent-mode-identity";
interface ModeState { schemaVersion: 1; mode: string }

export async function loadAgentModeConfig(path = CONFIG): Promise<AgentModeConfig> {
    try { return validateModeConfig(JSON.parse(await readFile(path, "utf8"))); }
    catch (error) { throw new Error(`Cannot read agent mode config ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}
function splitModel(model: string): [string, string] { const at = model.indexOf("/"); return [model.slice(0, at), model.slice(at + 1)]; }
function restoredMode(ctx: ExtensionContext): string | undefined {
    const entry = [...ctx.sessionManager.getBranch()].reverse().find(item => item.type === "custom" && item.customType === MODE_STATE) as { data?: unknown } | undefined;
    const data = entry?.data as Partial<ModeState> | undefined;
    return data?.schemaVersion === 1 && typeof data.mode === "string" ? data.mode : undefined;
}
export function modeIdentityText(name: string): string { return `PARENT · mode:${name}`; }

export function registerModeController(pi: ExtensionAPI, configPath = CONFIG): { activeMode: () => string | undefined } {
    let config: AgentModeConfig | undefined;
    let activeName: string | undefined;
    let activeMode: AgentMode | undefined;
    let applyingSelection = false;
    const setTools = (tools: string[]) => { const current = pi.getActiveTools(); if (current.length !== tools.length || current.some((tool, index) => tool !== tools[index])) pi.setActiveTools(tools); };
    const reassertTools = () => { if (activeMode) setTools(activeMode.allowAllTools ? pi.getAllTools().map(tool => tool.name) : activeMode.tools); };
    const apply = async (name: string, ctx: ExtensionContext, persist: boolean, reason: ActiveModeReason): Promise<boolean> => {
        if (!ctx.isIdle()) { ctx.ui.notify("Mode can only be changed while the agent is idle", "warning"); return false; }
        config ??= await loadAgentModeConfig(configPath);
        const mode = config.modes[name];
        if (!mode) { ctx.ui.notify(`Unknown mode ${name}. Available: ${Object.keys(config.modes).join(", ")}`, "error"); return false; }
        const [provider, modelId] = splitModel(mode.model); const model = ctx.modelRegistry.find(provider, modelId);
        if (!model) { ctx.ui.notify(`Mode ${name}: model ${mode.model} not found`, "error"); return false; }
        const allTools = pi.getAllTools().map(tool => tool.name);
        const missing = mode.allowAllTools ? [] : mode.tools.filter(tool => !allTools.includes(tool));
        if (missing.length) { ctx.ui.notify(`Mode ${name}: tools unavailable: ${missing.join(", ")}`, "error"); return false; }
        const previous = { model: ctx.model, thinking: pi.getThinkingLevel(), tools: pi.getActiveTools() };
        applyingSelection = true;
        try {
            if (!await pi.setModel(model)) return false;
            pi.setThinkingLevel(mode.thinkingLevel);
            setTools(mode.allowAllTools ? allTools : mode.tools);
        } catch (error) {
            if (previous.model) await pi.setModel(previous.model); pi.setThinkingLevel(previous.thinking); setTools(previous.tools);
            ctx.ui.notify(`Mode ${name}: ${error instanceof Error ? error.message : String(error)}`, "error"); return false;
        } finally { applyingSelection = false; }
        activeName = name; activeMode = structuredClone(mode); ctx.ui.setStatus(MODE_STATUS, modeIdentityText(name));
        if (persist) pi.appendEntry(MODE_STATE, { schemaVersion: 1, mode: name } satisfies ModeState);
        emitActiveMode(pi, name, mode, reason); return true;
    };
    const choose = async (ctx: ExtensionContext) => { config ??= await loadAgentModeConfig(configPath); const selected = await ctx.ui.select("Agent mode", Object.keys(config.modes)); if (selected) await apply(selected, ctx, true, "switch"); };
    pi.registerFlag("agent-mode", { description: "Top-level agent mode", type: "string" });
    pi.registerCommand("mode", { description: "Show or switch the top-level agent mode", getArgumentCompletions(prefix) { if (!config) return null; return Object.entries(config.modes).filter(([name]) => name.startsWith(prefix)).map(([value, mode]) => ({ value, label: value, description: mode.description })); }, async handler(args, ctx) { const name = args.trim(); if (name) await apply(name, ctx, true, "switch"); else await choose(ctx); } });
    provideCommandPaletteContribution(pi.events, { owner: "mode", id: "select", label: "/mode  Select agent mode", description: "Choose recon or ops for the parent session.", keywords: ["mode", "recon", "ops"], currentValue: () => activeName ? `Current: ${activeName}` : undefined, disabledReason: ctx => ctx.isIdle() ? undefined : "Mode can only be changed while the agent is idle", async run(ctx) { await choose(ctx); return "return" as const; } });
    pi.on("session_start", async (_event, ctx) => { config = await loadAgentModeConfig(configPath); const flag = pi.getFlag("agent-mode"); const requested = typeof flag === "string" && flag.trim() ? flag.trim() : restoredMode(ctx) ?? config.defaultMode; if (!await apply(requested, ctx, true, "startup") && requested !== config.defaultMode) await apply(config.defaultMode, ctx, true, "startup"); });
    pi.on("session_tree", async (_event, ctx) => { config ??= await loadAgentModeConfig(configPath); await apply(restoredMode(ctx) ?? config.defaultMode, ctx, false, "restore"); });
    pi.on("model_select", async (event, ctx) => {
        if (applyingSelection || !activeMode) return;
        if (`${event.model.provider}/${event.model.id}` === activeMode.model) return;
        const [provider, modelId] = splitModel(activeMode.model);
        const expected = ctx.modelRegistry.find(provider, modelId);
        if (!expected) throw new Error(`Active mode ${activeName} model ${activeMode.model} is unavailable`);
        applyingSelection = true;
        try {
            if (!await pi.setModel(expected)) throw new Error(`Active mode ${activeName} model ${activeMode.model} could not be restored`);
            pi.setThinkingLevel(activeMode.thinkingLevel);
            ctx.ui.notify(`Model selection is controlled by mode ${activeName}`, "warning");
        } finally { applyingSelection = false; }
    });
    pi.on("thinking_level_select", event => {
        if (applyingSelection || !activeMode || event.level === activeMode.thinkingLevel) return;
        applyingSelection = true;
        try { pi.setThinkingLevel(activeMode.thinkingLevel); }
        finally { applyingSelection = false; }
    });
    pi.on("context", () => { reassertTools(); });
    pi.on("before_agent_start", (event, ctx) => {
        if (!activeMode) return;
        reassertTools();
        const loaded = event.systemPromptOptions.skills ?? []; const names = new Set(loaded.map(skill => skill.name));
        const missing = activeMode.skillOptIns.filter(name => !names.has(name));
        if (missing.length) ctx.ui.notify(`Mode ${activeName}: opted-in skills unavailable: ${missing.join(", ")}`, "warning");
        const opted = new Set(activeMode.skillOptIns);
        const skills = loaded.filter(skill => opted.has(skill.name) && skill.disableModelInvocation).map(skill => ({ ...skill, disableModelInvocation: false }));
        const addition = [formatSkillsForPrompt(skills), activeMode.instructions].filter(Boolean).join("\n\n");
        if (addition) return { systemPrompt: `${event.systemPrompt}\n\n${addition}` };
    });
    pi.on("tool_call", event => { if (activeMode && !activeMode.allowAllTools && !activeMode.tools.includes(event.toolName)) return { block: true, reason: `Tool ${event.toolName} is not allowed by mode ${activeName}` }; });
    return { activeMode: () => activeName };
}
export default registerModeController;
