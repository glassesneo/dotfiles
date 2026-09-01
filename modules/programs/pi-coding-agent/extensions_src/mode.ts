import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { formatSkillsForPrompt, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { provideCommandPaletteContribution } from "./utilities/command_palette_contributions.ts";
import { emitActiveMode, type ActiveModeReason } from "./utilities/mode_events.ts";
import {
    PROFILE_FALLBACK_CONTINUATION,
    PROFILE_FALLBACK_CONTINUATION_TYPE,
    reconcileProfileRoute,
    restoreCompatibleProfileRoute,
    selectProfileCandidate,
    promoteProfileCandidate,
    type ProfileRoute,
} from "./utilities/pi_profile_fallback.ts";
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
const PROFILE_ROUTE_STATE = "agent-mode-profile-route";
const MODE_STATUS = "agent-mode-identity";
interface ModeState { schemaVersion: 2; mode: string }
interface ProfileRouteState { schemaVersion: 1; mode: string; profile: string; models: string[]; route: ProfileRoute }

export async function loadAgentModeConfig(path = CONFIG): Promise<AgentModeConfig> {
    try { return validateModeConfig(JSON.parse(await readFile(path, "utf8"))); }
    catch (error) { throw new Error(`Cannot read agent mode config ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}
export async function loadExecutionProfileConfig(path = PROFILES): Promise<ExecutionProfileConfig> {
    try { return validateExecutionProfileConfig(JSON.parse(await readFile(path, "utf8"))); }
    catch (error) { throw new Error(`Cannot read execution profile config ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}
function modelName(model: ExtensionContext["model"]): string | undefined { return model ? `${model.provider}/${model.id}` : undefined; }
function restoredMode(ctx: ExtensionContext): string | undefined {
    const entry = [...ctx.sessionManager.getBranch()].reverse().find(item => item.type === "custom" && item.customType === MODE_STATE) as { data?: unknown } | undefined;
    const data = entry?.data as Partial<ModeState> | undefined;
    return data?.schemaVersion === 2 && typeof data.mode === "string" ? data.mode : undefined;
}
export function modeIdentityText(name: string, profile: string, model = "unavailable", fallbackCount = 0): string {
    return `PARENT · mode:${name} · profile:${profile} · model:${model} · fallback:${fallbackCount}`;
}

export function registerModeController(pi: ExtensionAPI, configPath = CONFIG, profilePath = configPath === CONFIG ? PROFILES : join(dirname(configPath), "execution-profiles.json")): { activeMode: () => string | undefined; activeProfile: () => string | undefined } {
    let config: AgentModeConfig | undefined;
    let profileConfig: ExecutionProfileConfig | undefined;
    let activeName: string | undefined;
    let activeMode: AgentMode | undefined;
    let activeProfile: string | undefined;
    let activeRoute: ProfileRoute | undefined;
    let fallbackSuspended = false;
    let applyingSelection = false;
    let shuttingDown = false;
    let lastAssistantStopReason: string | undefined;
    let turnHadToolError = false;
    const setTools = (tools: string[]) => { const current = pi.getActiveTools(); if (current.length !== tools.length || current.some((tool, index) => tool !== tools[index])) pi.setActiveTools(tools); };
    const reassertTools = () => { if (activeMode) setTools(activeMode.tools); };
    const setIdentity = (ctx: ExtensionContext) => {
        if (activeName && activeProfile) ctx.ui.setStatus(MODE_STATUS, modeIdentityText(activeName, activeProfile, activeRoute?.activeModel ?? modelName(ctx.model), activeRoute?.activeIndex ?? 0));
    };
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
        if (shuttingDown) return undefined;
        const failures: string[] = [];
        try { if (previous.model && !await pi.setModel(previous.model)) failures.push("model"); } catch { failures.push("model"); }
        try { pi.setThinkingLevel(previous.thinking); } catch { failures.push("thinking"); }
        try { setTools(previous.tools); } catch { failures.push("tools"); }
        return failures.length ? `; rollback failed for ${failures.join(", ")}` : undefined;
    };
    const restoredRoute = (ctx: ExtensionContext, mode: string): { profile: string; route: ProfileRoute } | undefined => {
        const entry = [...ctx.sessionManager.getBranch()].reverse().find(item => item.type === "custom" && item.customType === PROFILE_ROUTE_STATE) as { data?: unknown } | undefined;
        const data = entry?.data as Partial<ProfileRouteState> | undefined;
        if (data?.schemaVersion !== 1 || data.mode !== mode || typeof data.profile !== "string") return undefined;
        const profile = resolvePiProfile(data.profile);
        const route = profile && restoreCompatibleProfileRoute(profile, data.profile, data);
        return profile && route ? { profile: data.profile, route: reconcileProfileRoute(profile, route, modelName(ctx.model)) } : undefined;
    };
    const persistRoute = (): void => {
        const profile = activeProfile && resolvePiProfile(activeProfile);
        if (!activeName || !activeProfile || !profile || !activeRoute || activeRoute.activeModel !== profile.models[activeRoute.activeIndex]) return;
        pi.appendEntry(PROFILE_ROUTE_STATE, { schemaVersion: 1, mode: activeName, profile: activeProfile, models: [...profile.models], route: structuredClone(activeRoute) } satisfies ProfileRouteState);
    };
    const selectProfile = async (input: { mode: AgentMode; modeName: string; profileName: string; profile: ExecutionProfile; ctx: ExtensionContext; previous: { model: ExtensionContext["model"]; thinking: ReturnType<ExtensionAPI["getThinkingLevel"]>; tools: string[] }; route?: ProfileRoute; setModeTools: boolean; persistMode: boolean; reason: ActiveModeReason }): Promise<boolean> => {
        applyingSelection = true;
        let result: Awaited<ReturnType<typeof selectProfileCandidate>>;
        try {
            result = await selectProfileCandidate({
                profile: input.profile,
                profileName: input.profileName,
                registry: input.ctx.modelRegistry,
                route: input.route,
                activate: async model => {
                    if (shuttingDown) return false;
                    const selected = await pi.setModel(model);
                    return selected && !shuttingDown;
                },
            });
            if (!result.ok) throw new Error(result.error);
            if (shuttingDown) throw new Error("Session is shutting down");
            pi.setThinkingLevel(input.profile.thinkingLevel!);
            if (input.setModeTools) setTools(input.mode.tools);
        } catch (error) {
            const rollbackFailure = await rollback(input.previous);
            input.ctx.ui.notify(`Profile ${input.profileName}: ${error instanceof Error ? error.message : String(error)}${rollbackFailure ?? ""}`, "error");
            return false;
        } finally { applyingSelection = false; }
        activeName = input.modeName;
        activeMode = structuredClone(input.mode);
        activeProfile = input.profileName;
        activeRoute = result.route;
        fallbackSuspended = false;
        setIdentity(input.ctx);
        if (input.persistMode) pi.appendEntry(MODE_STATE, { schemaVersion: 2, mode: input.modeName } satisfies ModeState);
        persistRoute();
        emitActiveMode(pi, input.modeName, input.mode, input.reason);
        return true;
    };
    const applyMode = async (name: string, ctx: ExtensionContext, persist: boolean, reason: ActiveModeReason, restore = false): Promise<boolean> => {
        if (!ctx.isIdle()) { ctx.ui.notify("Mode can only be changed while the agent is idle", "warning"); return false; }
        await ensureConfig();
        const mode = config!.modes[name];
        if (!mode) { ctx.ui.notify(`Unknown mode ${name}. Available: ${Object.keys(config!.modes).join(", ")}`, "error"); return false; }
        const restored = restore ? restoredRoute(ctx, name) : undefined;
        const profileName = restored?.profile ?? mode.defaultProfile;
        const profile = resolvePiProfile(profileName);
        if (!profile?.thinkingLevel) { ctx.ui.notify(`Mode ${name}: profile ${profileName} is not parent-selectable`, "error"); return false; }
        const allTools = pi.getAllTools().map(tool => tool.name);
        const missing = mode.tools.filter(tool => !allTools.includes(tool));
        if (missing.length) { ctx.ui.notify(`Mode ${name}: tools unavailable: ${missing.join(", ")}`, "error"); return false; }
        const selected = await selectProfile({ mode, modeName: name, profileName, profile, ctx, previous: { model: ctx.model, thinking: pi.getThinkingLevel(), tools: pi.getActiveTools() }, route: restored?.route, setModeTools: true, persistMode: persist, reason });
        if (!selected && restore) {
            activeRoute = undefined;
            fallbackSuspended = true;
            setIdentity(ctx);
        }
        return selected;
    };
    const applyProfile = async (name: string, ctx: ExtensionContext): Promise<boolean> => {
        if (!ctx.isIdle()) { ctx.ui.notify("Profile can only be changed while the agent is idle", "warning"); return false; }
        await ensureConfig();
        const profile = resolvePiProfile(name);
        if (!profile?.thinkingLevel) {
            const known = profileConfig!.profiles[name];
            const available = Object.entries(profileConfig!.profiles).filter(([, item]) => item.harness === "pi").map(([profileName]) => profileName).join(", ");
            ctx.ui.notify(known ? `Profile ${name} is not selectable by the parent` : `Unknown profile ${name}. Available: ${available}`, "error");
            return false;
        }
        if (!activeMode || !activeName) { ctx.ui.notify("Select a mode before selecting a profile", "error"); return false; }
        return selectProfile({ mode: activeMode, modeName: activeName, profileName: name, profile, ctx, previous: { model: ctx.model, thinking: pi.getThinkingLevel(), tools: pi.getActiveTools() }, setModeTools: false, persistMode: false, reason: "switch" });
    };
    const chooseMode = async (ctx: ExtensionContext) => { await ensureConfig(); const selected = await ctx.ui.select("Agent mode", Object.keys(config!.modes)); if (selected) await applyMode(selected, ctx, true, "switch"); };
    const chooseProfile = async (ctx: ExtensionContext) => { await ensureConfig(); const names = Object.entries(profileConfig!.profiles).filter(([, profile]) => profile.harness === "pi").map(([name]) => name); const selected = await ctx.ui.select("Execution profile", names); if (selected) await applyProfile(selected, ctx); };
    pi.registerFlag("agent-mode", { description: "Top-level agent mode", type: "string" });
    pi.registerCommand("mode", { description: "Show or switch the top-level agent mode", getArgumentCompletions(prefix) { if (!config) return null; return Object.entries(config.modes).filter(([name]) => name.startsWith(prefix)).map(([value, mode]) => ({ value, label: value, description: mode.description })); }, async handler(args, ctx) { const name = args.trim(); if (name) await applyMode(name, ctx, true, "switch"); else await chooseMode(ctx); } });
    pi.registerCommand("profile", { description: "Show or select a named parent execution profile", getArgumentCompletions(prefix) { if (!profileConfig) return null; return Object.entries(profileConfig.profiles).filter(([name, profile]) => profile.harness === "pi" && name.startsWith(prefix)).map(([value, profile]) => ({ value, label: value, description: `${profile.models.join(" → ")} · ${profile.thinkingLevel}` })); }, async handler(args, ctx) { const name = args.trim(); if (name) await applyProfile(name, ctx); else await chooseProfile(ctx); } });
    provideCommandPaletteContribution(pi.events, { owner: "mode", id: "select", label: "/mode  Select agent mode", description: "Choose recon or ops for the parent session.", keywords: ["mode", "recon", "ops"], currentValue: () => activeName ? `Current: ${activeName}` : undefined, disabledReason: ctx => ctx.isIdle() ? undefined : "Mode can only be changed while the agent is idle", async run(ctx) { await chooseMode(ctx); return "return" as const; } });
    provideCommandPaletteContribution(pi.events, { owner: "mode", id: "profile", label: "/profile  Select execution profile", description: "Choose a named Pi execution profile for the parent session.", keywords: ["profile", "model", "thinking"], currentValue: () => activeProfile ? `Current: ${activeProfile}` : undefined, disabledReason: ctx => ctx.isIdle() ? undefined : "Profile can only be changed while the agent is idle", async run(ctx) { await chooseProfile(ctx); return "return" as const; } });
    pi.on("session_start", async (_event, ctx) => {
        shuttingDown = false;
        config = await loadAgentModeConfig(configPath);
        profileConfig = await loadExecutionProfileConfig(profilePath);
        validateModeProfileReferences(config, profileConfig);
        const flag = pi.getFlag("agent-mode");
        const requested = typeof flag === "string" && flag.trim() ? flag.trim() : restoredMode(ctx) ?? config.defaultMode;
        if (!await applyMode(requested, ctx, true, "startup", true) && requested !== config.defaultMode) await applyMode(config.defaultMode, ctx, true, "startup", true);
    });
    pi.on("session_tree", async (_event, ctx) => {
        await ensureConfig();
        const restored = restoredMode(ctx) ?? config!.defaultMode;
        await applyMode(restored, ctx, false, "restore", true);
    });
    pi.on("model_select", (event, ctx) => {
        if (event.source === "restore" || applyingSelection || !activeMode || !activeName) return;
        activeProfile = "custom";
        fallbackSuspended = true;
        setIdentity(ctx);
        ctx.ui.notify("Automatic profile fallback suspended after explicit model selection", "info");
    });
    pi.on("thinking_level_select", (_event, ctx) => {
        if (applyingSelection || !activeMode || !activeName) return;
        activeProfile = "custom";
        fallbackSuspended = true;
        setIdentity(ctx);
    });
    pi.on("agent_start", () => {
        lastAssistantStopReason = undefined;
        turnHadToolError = false;
    });
    pi.on("turn_start", () => { turnHadToolError = false; });
    pi.on("turn_end", event => {
        if (event.toolResults.some(result => result.isError)) turnHadToolError = true;
    });
    pi.on("message_end", event => {
        if (event.message.role === "toolResult" && event.message.isError) turnHadToolError = true;
    });
    pi.on("agent_end", event => {
        const assistant = [...event.messages].reverse().find(message => message.role === "assistant") as { stopReason?: unknown } | undefined;
        lastAssistantStopReason = typeof assistant?.stopReason === "string" ? assistant.stopReason : undefined;
    });
    pi.on("agent_settled", async (_event, ctx) => {
        const stopReason = lastAssistantStopReason;
        const toolError = turnHadToolError;
        lastAssistantStopReason = undefined;
        turnHadToolError = false;
        const profile = activeProfile && resolvePiProfile(activeProfile);
        if (shuttingDown || fallbackSuspended || !profile || !activeRoute || stopReason !== "error" || toolError) return;
        const usage = ctx.getContextUsage();
        applyingSelection = true;
        let promotion: Awaited<ReturnType<typeof promoteProfileCandidate>>;
        try {
            promotion = await promoteProfileCandidate({ profile, profileName: activeProfile!, route: activeRoute, registry: ctx.modelRegistry, tokens: usage?.tokens, activate: async model => {
                if (shuttingDown) return false;
                const selected = await pi.setModel(model);
                if (!selected || shuttingDown) return false;
                pi.setThinkingLevel(profile.thinkingLevel!);
                return !shuttingDown;
            } });
        } finally { applyingSelection = false; }
        if (shuttingDown) return;
        activeRoute = promotion.route;
        persistRoute();
        setIdentity(ctx);
        if (promotion.action === "exhausted") {
            fallbackSuspended = true;
            ctx.ui.notify(promotion.error, "error");
            return;
        }
        if (shuttingDown) return;
        pi.sendMessage({ customType: PROFILE_FALLBACK_CONTINUATION_TYPE, content: PROFILE_FALLBACK_CONTINUATION, display: false }, { triggerTurn: true });
    });
    pi.on("session_shutdown", () => { shuttingDown = true; });
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
