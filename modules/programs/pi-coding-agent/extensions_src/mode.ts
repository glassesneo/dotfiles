import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { formatSkillsForPrompt, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { provideCommandPaletteContribution } from "./utilities/command_palette_contributions.ts";
import { emitActiveMode, type ActiveModeReason } from "./utilities/mode_events.ts";
import {
    validateExecutionProfileConfig,
    validateModeConfig,
    validateModeProfileReferences,
    type AgentMode,
    type AgentModeConfig,
    type ExecutionProfile,
    type ExecutionProfileConfig,
} from "./utilities/mode_types.ts";

const CONFIG = join(getAgentDir(), "agent-modes.json");
const PROFILES = join(getAgentDir(), "execution-profiles.json");
const MODE_STATE = "agent-mode-state";
const MODE_STATUS = "agent-mode-identity";
interface ModeState { schemaVersion: 2; mode: string }

export async function loadAgentModeConfig(path = CONFIG): Promise<AgentModeConfig> {
    try { return validateModeConfig(JSON.parse(await readFile(path, "utf8"))); }
    catch (error) { throw new Error(`Cannot read agent mode config ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}
export async function loadExecutionProfileConfig(path = PROFILES): Promise<ExecutionProfileConfig> {
    try { return validateExecutionProfileConfig(JSON.parse(await readFile(path, "utf8"))); }
    catch (error) { throw new Error(`Cannot read execution profile config ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}
function splitModel(model: string): [string, string] { const at = model.indexOf("/"); return [model.slice(0, at), model.slice(at + 1)]; }
function restoredMode(ctx: ExtensionContext): string | undefined {
    const entry = [...ctx.sessionManager.getBranch()].reverse().find(item => item.type === "custom" && item.customType === MODE_STATE) as { data?: unknown } | undefined;
    const data = entry?.data as Partial<ModeState> | undefined;
    return data?.schemaVersion === 2 && typeof data.mode === "string" ? data.mode : undefined;
}
export function modeIdentityText(name: string, profile: string): string { return `PARENT · mode:${name} · profile:${profile}`; }

export function registerModeController(pi: ExtensionAPI, configPath = CONFIG, profilePath = configPath === CONFIG ? PROFILES : join(dirname(configPath), "execution-profiles.json")): { activeMode: () => string | undefined; activeProfile: () => string | undefined } {
    let config: AgentModeConfig | undefined;
    let profileConfig: ExecutionProfileConfig | undefined;
    let activeName: string | undefined;
    let activeMode: AgentMode | undefined;
    let activeProfile: string | undefined;
    let applyingSelection = false;
    const setTools = (tools: string[]) => { const current = pi.getActiveTools(); if (current.length !== tools.length || current.some((tool, index) => tool !== tools[index])) pi.setActiveTools(tools); };
    const reassertTools = () => { if (activeMode) setTools(activeMode.tools); };
    const setIdentity = (ctx: ExtensionContext) => { if (activeName && activeProfile) ctx.ui.setStatus(MODE_STATUS, modeIdentityText(activeName, activeProfile)); };
    const ensureConfig = async (): Promise<void> => {
        [config, profileConfig] = await Promise.all([
            config ? Promise.resolve(config) : loadAgentModeConfig(configPath),
            profileConfig ? Promise.resolve(profileConfig) : loadExecutionProfileConfig(profilePath),
        ]);
        validateModeProfileReferences(config, profileConfig);
    };
    const resolvePiProfile = (name: string): ExecutionProfile | undefined => {
        const profile = profileConfig?.profiles[name];
        return profile?.harness === "pi" ? profile : undefined;
    };
    const rollback = async (previous: { model: ExtensionContext["model"]; thinking: ReturnType<ExtensionAPI["getThinkingLevel"]>; tools: string[] }): Promise<string | undefined> => {
        const failures: string[] = [];
        try { if (previous.model && !await pi.setModel(previous.model)) failures.push("model"); } catch { failures.push("model"); }
        try { pi.setThinkingLevel(previous.thinking); } catch { failures.push("thinking"); }
        try { setTools(previous.tools); } catch { failures.push("tools"); }
        return failures.length ? `; rollback failed for ${failures.join(", ")}` : undefined;
    };
    const applyMode = async (name: string, ctx: ExtensionContext, persist: boolean, reason: ActiveModeReason): Promise<boolean> => {
        if (!ctx.isIdle()) { ctx.ui.notify("Mode can only be changed while the agent is idle", "warning"); return false; }
        await ensureConfig();
        const mode = config!.modes[name];
        if (!mode) { ctx.ui.notify(`Unknown mode ${name}. Available: ${Object.keys(config!.modes).join(", ")}`, "error"); return false; }
        const profile = resolvePiProfile(mode.defaultProfile);
        if (!profile?.thinkingLevel) { ctx.ui.notify(`Mode ${name}: default profile ${mode.defaultProfile} is not parent-selectable`, "error"); return false; }
        const [provider, modelId] = splitModel(profile.model); const model = ctx.modelRegistry.find(provider, modelId);
        if (!model) { ctx.ui.notify(`Mode ${name}: profile ${mode.defaultProfile} model ${profile.model} not found`, "error"); return false; }
        const allTools = pi.getAllTools().map(tool => tool.name);
        const missing = mode.tools.filter(tool => !allTools.includes(tool));
        if (missing.length) { ctx.ui.notify(`Mode ${name}: tools unavailable: ${missing.join(", ")}`, "error"); return false; }
        const previous = { model: ctx.model, thinking: pi.getThinkingLevel(), tools: pi.getActiveTools() };
        applyingSelection = true;
        try {
            if (!await pi.setModel(model)) throw new Error(`model ${profile.model} could not be selected`);
            pi.setThinkingLevel(profile.thinkingLevel);
            setTools(mode.tools);
        } catch (error) {
            const rollbackFailure = await rollback(previous);
            ctx.ui.notify(`Mode ${name}: ${error instanceof Error ? error.message : String(error)}${rollbackFailure ?? ""}`, "error");
            return false;
        } finally { applyingSelection = false; }
        activeName = name;
        activeMode = structuredClone(mode);
        activeProfile = mode.defaultProfile;
        setIdentity(ctx);
        if (persist) pi.appendEntry(MODE_STATE, { schemaVersion: 2, mode: name } satisfies ModeState);
        emitActiveMode(pi, name, mode, reason);
        return true;
    };
    const applyProfile = async (name: string, ctx: ExtensionContext): Promise<boolean> => {
        if (!ctx.isIdle()) { ctx.ui.notify("Profile can only be changed while the agent is idle", "warning"); return false; }
        await ensureConfig();
        const rawProfile = profileConfig!.profiles[name];
        if (!rawProfile) { ctx.ui.notify(`Unknown profile ${name}. Available: ${Object.entries(profileConfig!.profiles).filter(([, profile]) => profile.harness === "pi").map(([profileName]) => profileName).join(", ")}`, "error"); return false; }
        if (rawProfile.harness !== "pi" || !rawProfile.thinkingLevel) { ctx.ui.notify(`Profile ${name} is not selectable by the parent`, "error"); return false; }
        if (!activeMode || !activeName) { ctx.ui.notify("Select a mode before selecting a profile", "error"); return false; }
        const [provider, modelId] = splitModel(rawProfile.model); const model = ctx.modelRegistry.find(provider, modelId);
        if (!model) { ctx.ui.notify(`Profile ${name}: model ${rawProfile.model} not found`, "error"); return false; }
        const previous = { model: ctx.model, thinking: pi.getThinkingLevel(), tools: pi.getActiveTools() };
        applyingSelection = true;
        try {
            if (!await pi.setModel(model)) throw new Error(`model ${rawProfile.model} could not be selected`);
            pi.setThinkingLevel(rawProfile.thinkingLevel);
        } catch (error) {
            const rollbackFailure = await rollback(previous);
            ctx.ui.notify(`Profile ${name}: ${error instanceof Error ? error.message : String(error)}${rollbackFailure ?? ""}`, "error");
            return false;
        } finally { applyingSelection = false; }
        activeProfile = name;
        setIdentity(ctx);
        return true;
    };
    const chooseMode = async (ctx: ExtensionContext) => { await ensureConfig(); const selected = await ctx.ui.select("Agent mode", Object.keys(config!.modes)); if (selected) await applyMode(selected, ctx, true, "switch"); };
    const chooseProfile = async (ctx: ExtensionContext) => { await ensureConfig(); const names = Object.entries(profileConfig!.profiles).filter(([, profile]) => profile.harness === "pi").map(([name]) => name); const selected = await ctx.ui.select("Execution profile", names); if (selected) await applyProfile(selected, ctx); };
    pi.registerFlag("agent-mode", { description: "Top-level agent mode", type: "string" });
    pi.registerCommand("mode", { description: "Show or switch the top-level agent mode", getArgumentCompletions(prefix) { if (!config) return null; return Object.entries(config.modes).filter(([name]) => name.startsWith(prefix)).map(([value, mode]) => ({ value, label: value, description: mode.description })); }, async handler(args, ctx) { const name = args.trim(); if (name) await applyMode(name, ctx, true, "switch"); else await chooseMode(ctx); } });
    pi.registerCommand("profile", { description: "Show or select a named parent execution profile", getArgumentCompletions(prefix) { if (!profileConfig) return null; return Object.entries(profileConfig.profiles).filter(([name, profile]) => profile.harness === "pi" && name.startsWith(prefix)).map(([value, profile]) => ({ value, label: value, description: `${profile.model} · ${profile.thinkingLevel}` })); }, async handler(args, ctx) { const name = args.trim(); if (name) await applyProfile(name, ctx); else await chooseProfile(ctx); } });
    provideCommandPaletteContribution(pi.events, { owner: "mode", id: "select", label: "/mode  Select agent mode", description: "Choose recon or ops for the parent session.", keywords: ["mode", "recon", "ops"], currentValue: () => activeName ? `Current: ${activeName}` : undefined, disabledReason: ctx => ctx.isIdle() ? undefined : "Mode can only be changed while the agent is idle", async run(ctx) { await chooseMode(ctx); return "return" as const; } });
    provideCommandPaletteContribution(pi.events, { owner: "mode", id: "profile", label: "/profile  Select execution profile", description: "Choose a named Pi execution profile for the parent session.", keywords: ["profile", "model", "thinking"], currentValue: () => activeProfile ? `Current: ${activeProfile}` : undefined, disabledReason: ctx => ctx.isIdle() ? undefined : "Profile can only be changed while the agent is idle", async run(ctx) { await chooseProfile(ctx); return "return" as const; } });
    pi.on("session_start", async (_event, ctx) => { config = await loadAgentModeConfig(configPath); profileConfig = await loadExecutionProfileConfig(profilePath); validateModeProfileReferences(config, profileConfig); const flag = pi.getFlag("agent-mode"); const requested = typeof flag === "string" && flag.trim() ? flag.trim() : restoredMode(ctx) ?? config.defaultMode; if (!await applyMode(requested, ctx, true, "startup") && requested !== config.defaultMode) await applyMode(config.defaultMode, ctx, true, "startup"); });
    pi.on("session_tree", async (_event, ctx) => { await ensureConfig(); const restored = restoredMode(ctx) ?? config!.defaultMode; if (restored === activeName) { reassertTools(); setIdentity(ctx); return; } await applyMode(restored, ctx, false, "restore"); });
    pi.on("model_select", (_event, ctx) => {
        if (applyingSelection || !activeMode || !activeName) return;
        activeProfile = "custom";
        setIdentity(ctx);
    });
    pi.on("thinking_level_select", (_event, ctx) => {
        if (applyingSelection || !activeMode || !activeName) return;
        activeProfile = "custom";
        setIdentity(ctx);
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
    pi.on("tool_call", event => { if (activeMode && !activeMode.tools.includes(event.toolName)) return { block: true, reason: `Tool ${event.toolName} is not allowed by mode ${activeName}` }; });
    return { activeMode: () => activeName, activeProfile: () => activeProfile };
}
export default registerModeController;
