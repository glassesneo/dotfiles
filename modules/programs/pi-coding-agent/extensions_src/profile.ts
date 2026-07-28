import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    getAgentDir,
    type ExtensionAPI,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { emitActiveProfile, type ActiveProfileReason } from "./utilities/profile_events.ts";
import {
    validateProfileConfig,
    validateResolvedProfile,
    type AgentProfile,
    type AgentProfileConfig,
} from "./utilities/profile_types.ts";

const DEFAULT_CONFIG_PATH = join(getAgentDir(), "agent-profiles.json");
const PROFILE_STATE = "agent-profile-state";

export async function loadAgentProfileConfig(path: string, env: NodeJS.ProcessEnv = {}): Promise<AgentProfileConfig> {
    let value: unknown;
    try { value = JSON.parse(await readFile(path, "utf8")); }
    catch (error) { throw new Error(`Cannot read agent profile config ${path}: ${error instanceof Error ? error.message : String(error)}`); }
    const config = validateProfileConfig(value);
    if (!env.PI_AGENT_RESOLVED_PROFILE) return config;
    let resolved: { name: string; profile: AgentProfile };
    try { resolved = validateResolvedProfile(JSON.parse(env.PI_AGENT_RESOLVED_PROFILE)); }
    catch (error) { throw new Error(`PI_AGENT_RESOLVED_PROFILE is invalid: ${error instanceof Error ? error.message : String(error)}`); }
    return validateProfileConfig({ ...config, profiles: { ...config.profiles, [resolved.name]: resolved.profile } });
}

function splitModelId(model: string): [string, string] {
    const separator = model.indexOf("/");
    if (separator <= 0 || separator === model.length - 1) throw new Error(`Profile model must include provider: ${model}`);
    return [model.slice(0, separator), model.slice(separator + 1)];
}

function latestProfile(ctx: ExtensionContext): string | undefined {
    const entry = [...ctx.sessionManager.getBranch()].reverse().find(item => item.type === "custom" && item.customType === PROFILE_STATE) as { data?: { name?: unknown } } | undefined;
    return typeof entry?.data?.name === "string" ? entry.data.name : undefined;
}

export function routedProfileForInput(config: AgentProfileConfig, text: string): string | undefined {
    const match = /^\/([^/\s]+)(?=\s|$)/u.exec(text);
    return match?.[1] === undefined ? undefined : config.promptRoutes[match[1]];
}

export function registerProfileController(
    pi: ExtensionAPI,
    configPath = DEFAULT_CONFIG_PATH,
    env: NodeJS.ProcessEnv = process.env,
): { activeProfile: () => string | undefined } {
    let config: AgentProfileConfig | undefined;
    let activeName: string | undefined;
    let activeProfile: AgentProfile | undefined;

    const syncActiveTools = (profile: AgentProfile | undefined = activeProfile, requireComplete = false): boolean => {
        if (!profile) return false;
        const allTools = pi.getAllTools().map(tool => tool.name);
        const missing = profile.allowAllTools ? [] : profile.tools.filter(tool => !allTools.includes(tool));
        if (requireComplete && missing.length > 0) return false;
        pi.setActiveTools(profile.allowAllTools ? allTools : profile.tools.filter(tool => allTools.includes(tool)));
        return true;
    };

    pi.registerFlag("profile", { description: "Agent capability profile", type: "string" });

    const apply = async (name: string, ctx: ExtensionContext, persist: boolean, reason: ActiveProfileReason): Promise<boolean> => {
        if (!ctx.isIdle()) { ctx.ui.notify("Profile can only be changed while the agent is idle", "warning"); return false; }
        config ??= await loadAgentProfileConfig(configPath, env);
        const profile = config.profiles[name];
        if (!profile) { ctx.ui.notify(`Unknown profile ${name}. Available: ${Object.keys(config.profiles).join(", ")}`, "error"); return false; }
        let provider: string;
        let modelId: string;
        try { [provider, modelId] = splitModelId(profile.model); }
        catch (error) {
            ctx.ui.notify(`Profile ${name}: ${error instanceof Error ? error.message : String(error)}`, "error");
            return false;
        }
        const model = ctx.modelRegistry.find(provider, modelId);
        if (!model) { ctx.ui.notify(`Profile ${name}: model ${profile.model} not found`, "error"); return false; }
        const allTools = new Set(pi.getAllTools().map(tool => tool.name));
        const missingTools = profile.allowAllTools ? [] : profile.tools.filter(tool => !allTools.has(tool));
        if (missingTools.length > 0) {
            ctx.ui.notify(`Profile ${name}: tools unavailable: ${missingTools.join(", ")}`, "error");
            return false;
        }
        const previousModel = ctx.model;
        const previousThinking = pi.getThinkingLevel();
        const previousTools = pi.getActiveTools();
        try {
            if (!await pi.setModel(model)) { ctx.ui.notify(`Profile ${name}: no authentication for ${profile.model}`, "error"); return false; }
            pi.setThinkingLevel(profile.thinkingLevel ?? "off");
            if (!syncActiveTools(profile, true)) throw new Error("tool application failed");
        } catch (error) {
            if (previousModel !== undefined) await pi.setModel(previousModel);
            pi.setThinkingLevel(previousThinking);
            pi.setActiveTools(previousTools);
            ctx.ui.notify(`Profile ${name}: ${error instanceof Error ? error.message : String(error)}`, "error");
            return false;
        }
        activeName = name;
        activeProfile = structuredClone(profile);
        ctx.ui.setStatus("agent-profile", `profile:${name}`);
        if (persist) pi.appendEntry(PROFILE_STATE, { name });
        emitActiveProfile(pi, name, activeProfile, reason);
        return true;
    };

    const choose = async (ctx: ExtensionContext) => {
        config ??= await loadAgentProfileConfig(configPath, env);
        if (!ctx.hasUI) { ctx.ui.notify(`Active profile: ${activeName ?? config.defaultProfile}`, "info"); return; }
        const selected = await ctx.ui.select("Agent profile", Object.keys(config.profiles));
        if (selected) await apply(selected, ctx, true, "switch");
    };

    pi.registerCommand("profile", {
        description: "Show or switch the active agent profile",
        getArgumentCompletions(prefix) {
            if (!config) return null;
            const items = Object.keys(config.profiles).filter(name => name.startsWith(prefix)).map(name => ({
                value: name,
                label: name,
                description: config!.profiles[name]!.description,
            }));
            return items.length ? items : null;
        },
        async handler(args, ctx) {
            const name = args.trim();
            if (name) await apply(name, ctx, true, "switch"); else await choose(ctx);
        },
    });

    pi.registerShortcut("shift+tab", {
        description: "Cycle agent profiles",
        async handler(ctx) {
            config ??= await loadAgentProfileConfig(configPath, env);
            const current = config.profileCycle.indexOf(activeName ?? config.defaultProfile);
            const next = config.profileCycle[(current + 1 + config.profileCycle.length) % config.profileCycle.length];
            if (next) await apply(next, ctx, true, "switch");
        },
    });

    pi.on("session_start", async (_event, ctx) => {
        config = await loadAgentProfileConfig(configPath, env);
        const flag = pi.getFlag("profile");
        const requested = typeof flag === "string" && flag.trim() ? flag.trim() : latestProfile(ctx) ?? config.defaultProfile;
        if (!await apply(requested, ctx, true, "startup") && requested !== config.defaultProfile) {
            await apply(config.defaultProfile, ctx, true, "startup");
        }
    });
    pi.on("session_tree", async (_event, ctx) => {
        config ??= await loadAgentProfileConfig(configPath, env);
        await apply(latestProfile(ctx) ?? config.defaultProfile, ctx, false, "restore");
    });
    pi.on("input", async (event, ctx) => {
        try {
            config ??= await loadAgentProfileConfig(configPath, env);
            const target = routedProfileForInput(config, event.text);
            if (target === undefined) {
                syncActiveTools();
                return { action: "continue" as const };
            }
            return await apply(target, ctx, true, "route")
                ? { action: "continue" as const }
                : { action: "handled" as const };
        } catch (error) {
            ctx.ui.notify(`Profile route failed: ${error instanceof Error ? error.message : String(error)}`, "error");
            return { action: "handled" as const };
        }
    });
    pi.on("before_agent_start", async event => {
        if (!activeProfile) return;
        syncActiveTools();
        if (activeProfile.instructions) return { systemPrompt: `${event.systemPrompt}\n\n${activeProfile.instructions}` };
    });
    pi.on("tool_call", event => {
        if (activeProfile && !activeProfile.allowAllTools && !activeProfile.tools.includes(event.toolName)) {
            return { block: true, reason: `Tool ${event.toolName} is not allowed by profile ${activeName}` };
        }
    });
    return { activeProfile: () => activeName };
}

export default registerProfileController;
