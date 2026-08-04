import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    CustomEditor,
    getAgentDir,
    type ExtensionAPI,
    type ExtensionContext,
    type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { provideCommandPaletteContribution } from "./utilities/command_palette_contributions.ts";
import { loadFeatureKeybindings } from "./utilities/extension_keybindings.ts";
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
    return { ...config, profiles: { ...config.profiles, [resolved.name]: resolved.profile } };
}

function splitModelId(model: string): [string, string] {
    const separator = model.indexOf("/");
    if (separator <= 0 || separator === model.length - 1) throw new Error(`Profile model must include provider: ${model}`);
    return [model.slice(0, separator), model.slice(separator + 1)];
}

interface ProfileStateV2 { schemaVersion: 2; profileId: string }

function latestProfileId(ctx: ExtensionContext): string | undefined {
    const entry = [...ctx.sessionManager.getBranch()].reverse().find(item => item.type === "custom" && item.customType === PROFILE_STATE) as { data?: unknown } | undefined;
    if (!entry?.data || typeof entry.data !== "object" || Array.isArray(entry.data)) return undefined;
    const data = entry.data as Partial<ProfileStateV2>;
    return data.schemaVersion === 2 && typeof data.profileId === "string" ? data.profileId : undefined;
}

export class ProfileBadgeEditor extends CustomEditor {
    #profileName: string | undefined;
    readonly #theme: EditorTheme;
    readonly #tui: Pick<TUI, "requestRender">;

    constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, profileName?: string) {
        super(tui, theme, keybindings);
        this.#tui = tui; this.#theme = theme; this.#profileName = profileName;
    }
    setProfileName(name: string): void { this.#profileName = name; this.invalidate(); this.#tui.requestRender(); }
    override handleInput(data: string): void { super.handleInput(data); }
    override render(width: number): string[] {
        const lines = super.render(width);
        const label = this.#profileName ? ` profile:${this.#profileName} ` : "";
        if (lines.length === 0 || !label || width < visibleWidth(label) + 8) return lines;
        const last = lines.at(-1)!;
        lines[lines.length - 1] = truncateToWidth(last, width - visibleWidth(label), "") + this.#theme.selectList.selectedText(label);
        return lines;
    }
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
    const profileKeys = loadFeatureKeybindings("profile").actions;
    let config: AgentProfileConfig | undefined;
    let activeName: string | undefined;
    let activeProfile: AgentProfile | undefined;
    let badgeEditor: ProfileBadgeEditor | undefined;

    const nameForId = (id: string | undefined): string | undefined => id === undefined || !config ? undefined : Object.entries(config.profiles).find(([, profile]) => profile.id === id)?.[0];

    const setActiveToolsIfChanged = (expectedTools: string[]): void => {
        const currentTools = pi.getActiveTools();
        if (currentTools.length === expectedTools.length && currentTools.every((tool, index) => tool === expectedTools[index])) return;
        pi.setActiveTools(expectedTools);
    };

    const syncActiveTools = (profile: AgentProfile | undefined = activeProfile, requireComplete = false): boolean => {
        if (!profile) return false;
        const allTools = pi.getAllTools().map(tool => tool.name);
        const missing = profile.allowAllTools ? [] : profile.tools.filter(tool => !allTools.includes(tool));
        if (requireComplete && missing.length > 0) return false;
        setActiveToolsIfChanged(profile.allowAllTools ? allTools : profile.tools.filter(tool => allTools.includes(tool)));
        return true;
    };

    pi.registerFlag("profile", { description: "Agent capability profile", type: "string" });

    const apply = async (name: string, ctx: ExtensionContext, persist: boolean, reason: ActiveProfileReason): Promise<boolean> => {
        if (!ctx.isIdle()) { ctx.ui.notify("Profile can only be changed while the agent is idle", "warning"); return false; }
        config ??= await loadAgentProfileConfig(configPath, env);
        const profile = config.profiles[name];
        const resolvedChildActivation = (reason === "startup" || reason === "restore") && env.PI_AGENT_RESOLVED_PROFILE !== undefined && profile?.availability.includes("subagent");
        const selectable = Object.entries(config.profiles).filter(([, candidate]) => candidate.availability.includes("top-level")).map(([candidate]) => candidate);
        if (!profile || (!profile.availability.includes("top-level") && !resolvedChildActivation)) { ctx.ui.notify(`Unknown top-level profile ${name}. Available: ${selectable.join(", ")}`, "error"); return false; }
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
            setActiveToolsIfChanged(previousTools);
            ctx.ui.notify(`Profile ${name}: ${error instanceof Error ? error.message : String(error)}`, "error");
            return false;
        }
        activeName = name;
        activeProfile = structuredClone(profile);
        badgeEditor?.setProfileName(name);
        if (persist) pi.appendEntry(PROFILE_STATE, { schemaVersion: 2, profileId: profile.id } satisfies ProfileStateV2);
        emitActiveProfile(pi, name, activeProfile, reason);
        return true;
    };

    const choose = async (ctx: ExtensionContext) => {
        config ??= await loadAgentProfileConfig(configPath, env);
        if (!ctx.hasUI) { ctx.ui.notify(`Active profile: ${activeName ?? config.defaultProfile}`, "info"); return; }
        const selected = await ctx.ui.select("Agent profile", Object.entries(config.profiles).filter(([, profile]) => profile.availability.includes("top-level")).map(([name]) => name));
        if (selected) await apply(selected, ctx, true, "switch");
    };

    provideCommandPaletteContribution(pi.events, {
        owner: "profile",
        id: "select",
        label: "/profile  Select agent profile",
        description: "Choose the active capability profile.",
        keywords: ["agent", "capability", "profile"],
        currentValue: () => activeName === undefined ? undefined : `Current: ${activeName}`,
        disabledReason: ctx => ctx.isIdle() ? undefined : "Profile can only be changed while the agent is idle",
        async run(ctx) { await choose(ctx); return "return" as const; },
    });

    pi.registerCommand("profile", {
        description: "Show or switch the active agent profile",
        getArgumentCompletions(prefix) {
            if (!config) return null;
            const items = Object.keys(config.profiles).filter(name => config!.profiles[name]!.availability.includes("top-level") && name.startsWith(prefix)).map(name => ({
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

    for (const shortcut of profileKeys.cycle ?? []) pi.registerShortcut(shortcut, {
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
        if (ctx.mode === "tui") {
            ctx.ui.setEditorComponent((tui, theme, keybindings) => {
                badgeEditor = new ProfileBadgeEditor(tui, theme, keybindings, activeName);
                return badgeEditor;
            });
        }
        const flag = pi.getFlag("profile");
        const requested = typeof flag === "string" && flag.trim() ? flag.trim() : nameForId(latestProfileId(ctx)) ?? config.defaultProfile;
        if (!await apply(requested, ctx, true, "startup") && requested !== config.defaultProfile) {
            if (env.PI_AGENT_RESOLVED_PROFILE) return;
            await apply(config.defaultProfile, ctx, true, "startup");
        }
    });
    pi.on("session_tree", async (_event, ctx) => {
        config ??= await loadAgentProfileConfig(configPath, env);
        await apply(nameForId(latestProfileId(ctx)) ?? config.defaultProfile, ctx, false, "restore");
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
