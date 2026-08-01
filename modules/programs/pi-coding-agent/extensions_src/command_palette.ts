import type { Model } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { copyToClipboard, getAgentDir, type ExtensionAPI, type ExtensionContext, type ToolInfo } from "@earendil-works/pi-coding-agent";
import { commandPaletteActionIds, extractLastAssistantText, formatContextUsage, summarizeSession, type CommandPaletteActionId, type PaletteAction, type PaletteListItem } from "./utilities/command_palette_core.ts";
import { COMMAND_PALETTE_DISCOVER_EVENT, COMMAND_PALETTE_REGISTER_EVENT, CommandPaletteContributionRegistry, contributionIdentity, type CommandPaletteDisposition } from "./utilities/command_palette_contributions.ts";
import { loadPaletteKeymap, type ResolvedPaletteKeymap } from "./utilities/command_palette_keymap.ts";
import { formatPaletteBreadcrumb, PaletteListComponent, runPaletteList } from "./utilities/command_palette_tui.ts";
import { onActiveProfile } from "./utilities/profile_events.ts";

export function buildCommandPaletteActions(pi: Pick<ExtensionAPI, "getActiveTools" | "getThinkingLevel">, ctx: Pick<ExtensionContext, "model" | "ui">): PaletteAction[] {
    const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none";
    const activeTools = pi.getActiveTools().length;
    return [
        { id: "model", label: "/model  Select model", description: "Choose an authenticated provider and model.", keywords: ["provider", "model"], uiKind: "select", currentValue: model },
        { id: "thinking", label: "/thinking  Select reasoning effort", description: "Choose a thinking level supported by the current model.", keywords: ["thinking", "reasoning", "effort"], uiKind: "select", currentValue: pi.getThinkingLevel(), disabledReason: ctx.model ? undefined : "No current model" },
        { id: "tools", label: "/tools  Configure active tools", description: "Enable or disable tools. Changes apply immediately.", keywords: ["tool", "active", "enable"], uiKind: "settings", currentValue: `${activeTools} active` },
        { id: "tool-output", label: "/tool-output  Toggle tool output expansion", description: "Expand or collapse transcript tool results.", keywords: ["tools", "output", "display"], uiKind: "toggle", currentValue: ctx.ui.getToolsExpanded() ? "expanded" : "collapsed" },
        { id: "session-info", label: "/session  Show session information", description: "View session identity, counts, model, and context usage.", keywords: ["session", "stats", "context"], uiKind: "information" },
        { id: "copy-last-response", label: "/copy  Copy last assistant response", description: "Copy the latest assistant text on the active branch.", keywords: ["clipboard", "copy", "response"], uiKind: "immediate" },
        { id: "theme", label: "/theme  Select theme", description: "Switch the live TUI theme and persist it through Pi.", keywords: ["appearance", "color", "theme"], uiKind: "select", currentValue: ctx.ui.theme.name ?? "current" },
    ];
}

function actionItems(actions: readonly PaletteAction[]): PaletteListItem<CommandPaletteActionId>[] {
    return actions.map(action => ({ value: action.id, label: action.label, description: action.description, keywords: action.keywords, state: action.currentValue ? `Current: ${action.currentValue}` : undefined, disabledReason: action.disabledReason }));
}

function childTitle(leaf: string): string {
    return formatPaletteBreadcrumb(["Command Palette", leaf]);
}

async function selectModel(pi: ExtensionAPI, ctx: ExtensionContext, keymap: ResolvedPaletteKeymap): Promise<string | undefined> {
    void ctx.modelRegistry.refresh();
    const models = ctx.modelRegistry.getAvailable();
    const items: PaletteListItem<Model<any>>[] = models.map(model => ({ value: model, label: `${model.provider}/${model.id}`, description: model.name, keywords: [model.provider, model.id, model.name], state: ctx.model?.provider === model.provider && ctx.model.id === model.id ? "Current" : undefined }));
    if (items.length === 0) return "No authenticated models available";
    const selected = await runPaletteList(ctx.ui, { title: childTitle("Select Model"), items, keymap });
    if (!selected) return undefined;
    try {
        if (!await pi.setModel(selected)) return `No API key for ${selected.provider}/${selected.id}`;
        return `Model: ${selected.provider}/${selected.id}`;
    } catch (error) {
        return `Model error: ${error instanceof Error ? error.message : String(error)}`;
    }
}

async function selectThinking(pi: ExtensionAPI, ctx: ExtensionContext, keymap: ResolvedPaletteKeymap): Promise<string | undefined> {
    if (!ctx.model) return "No current model";
    const current = pi.getThinkingLevel();
    const levels = getSupportedThinkingLevels(ctx.model);
    const selected = await runPaletteList(ctx.ui, { title: childTitle("Select Reasoning Effort"), keymap, items: levels.map(level => ({ value: level, label: level, state: level === current ? "Current" : undefined })) });
    if (!selected) return undefined;
    try {
        pi.setThinkingLevel(selected);
        return `Reasoning effort: ${pi.getThinkingLevel()}`;
    } catch (error) {
        return `Reasoning error: ${error instanceof Error ? error.message : String(error)}`;
    }
}

function toolItems(tools: readonly ToolInfo[], active: ReadonlySet<string>): PaletteListItem<string>[] {
    return tools.map(tool => ({ value: tool.name, label: tool.name, description: `${tool.description} • source: ${tool.sourceInfo.source}`, keywords: [tool.sourceInfo.source], state: active.has(tool.name) ? "Active" : "Inactive" }));
}

async function configureTools(pi: ExtensionAPI, ctx: ExtensionContext, keymap: ResolvedPaletteKeymap): Promise<string | undefined> {
    const tools = pi.getAllTools(); const active = new Set(pi.getActiveTools());
    if (tools.length === 0) return "No tools available";
    await runPaletteList(ctx.ui, { title: childTitle("Configure Active Tools"), keymap, items: toolItems(tools, active), onConfirm: async (item, component) => {
        if (active.has(item.value) && active.size === 1) {
            const confirmed = await ctx.ui.confirm("Disable last active tool?", "The model will have no active tools.");
            if (!confirmed) { component.setStatus("warning", "Last tool remains active."); return; }
        }
        if (active.has(item.value)) active.delete(item.value); else active.add(item.value);
        pi.setActiveTools([...active]); component.setItems(toolItems(tools, active)); component.setStatus("success", `${item.value} is now ${active.has(item.value) ? "active" : "inactive"}.`);
    } });
    return `${pi.getActiveTools().length} tools active`;
}

async function showSessionInfo(ctx: ExtensionContext, keymap: ResolvedPaletteKeymap, activeProfileName?: string): Promise<string | undefined> {
    const entries = ctx.sessionManager.getEntries(); const counts = summarizeSession(entries); const header = ctx.sessionManager.getHeader();
    const values = [
        ["Name", ctx.sessionManager.getSessionName() ?? "unnamed"], ["File", ctx.sessionManager.getSessionFile() ?? "in-memory"],
        ["Session ID", ctx.sessionManager.getSessionId()], ["Profile", activeProfileName ?? "unknown"], ["Entries", String(counts.entryCount)], ["User messages", String(counts.userCount)],
        ["Assistant messages", String(counts.assistantCount)], ["Tool calls", String(counts.toolCallCount)], ["Tool results", String(counts.toolResultCount)],
        ["Current model", ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none"], ["Context usage", formatContextUsage(ctx.getContextUsage())],
        ["Working directory", header?.cwd ?? ctx.cwd],
    ];
    await runPaletteList(ctx.ui, { title: childTitle("Session Information"), keymap, searchable: false, items: values.map(([label, value]) => ({ value: label, label: `${label}: ${value}` })), onConfirm: (_item, component) => component.close(null) });
    return undefined;
}

async function copyLastResponse(ctx: ExtensionContext): Promise<{ ok: boolean; message: string }> {
    const text = extractLastAssistantText(ctx.sessionManager.getBranch());
    if (!text) return { ok: false, message: "No assistant text on the active branch" };
    try {
        await copyToClipboard(text);
        return { ok: true, message: "Copied last assistant response" };
    } catch (error) {
        return { ok: false, message: `Clipboard error: ${error instanceof Error ? error.message : String(error)}` };
    }
}

async function selectTheme(ctx: ExtensionContext, keymap: ResolvedPaletteKeymap): Promise<string | undefined> {
    const current = ctx.ui.theme.name;
    const selected = await runPaletteList(ctx.ui, { title: childTitle("Select Theme"), keymap, items: ctx.ui.getAllThemes().map(theme => ({ value: theme.name, label: theme.name, description: theme.path ?? "built-in", state: theme.name === current ? "Current" : undefined })) });
    if (!selected) return undefined;
    const result = ctx.ui.setTheme(selected);
    if (!result.success) return `Theme error: ${result.error ?? "unknown error"}`;
    return `Theme: ${selected}`;
}

export async function executePaletteAction(
    id: CommandPaletteActionId,
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    keymap: ResolvedPaletteKeymap,
    root?: PaletteListComponent<string>,
    activeProfileName?: string,
): Promise<CommandPaletteDisposition> {
    switch (id) {
        case "model": {
            const message = await selectModel(pi, ctx, keymap);
            if (message) root?.setStatus(message.startsWith("No ") || message.includes("error") || message.includes("Error") ? "error" : "success", message);
            return "return";
        }
        case "thinking": {
            const message = await selectThinking(pi, ctx, keymap);
            if (message) root?.setStatus(message.startsWith("No ") || message.includes("error") || message.includes("Error") ? "error" : "success", message);
            return "return";
        }
        case "tools": {
            const message = await configureTools(pi, ctx, keymap);
            if (message) root?.setStatus(message.startsWith("No ") ? "warning" : "success", message);
            return "return";
        }
        case "tool-output": {
            const expanded = !ctx.ui.getToolsExpanded();
            ctx.ui.setToolsExpanded(expanded);
            root?.setStatus("success", `Tool output: ${expanded ? "expanded" : "collapsed"}`);
            return "return";
        }
        case "session-info": {
            await showSessionInfo(ctx, keymap, activeProfileName);
            return "return";
        }
        case "copy-last-response": {
            const result = await copyLastResponse(ctx);
            root?.setStatus(result.ok ? "success" : "error", result.message);
            return "return";
        }
        case "theme": {
            const message = await selectTheme(ctx, keymap);
            if (message) root?.setStatus(message.includes("error") || message.includes("Error") ? "error" : "success", message);
            return "return";
        }
    }
}

export default function commandPalette(pi: ExtensionAPI, agentDir = getAgentDir()): void {
    const { keymap } = loadPaletteKeymap(agentDir);
    const contributions = new CommandPaletteContributionRegistry(commandPaletteActionIds);
    const unregisterContributions = pi.events.on(COMMAND_PALETTE_REGISTER_EVENT, value => { contributions.register(value); });
    pi.on("session_start", () => { pi.events.emit(COMMAND_PALETTE_DISCOVER_EVENT, undefined); });
    pi.on("session_shutdown", unregisterContributions);
    let activeProfileName: string | undefined;
    onActiveProfile(pi, event => { activeProfileName = event.name; });
    let opening = false;
    const openPalette = async (ctx: ExtensionContext): Promise<void> => {
        if (opening) return;
        if (ctx.mode !== "tui") { ctx.ui.notify("Command Palette requires TUI mode", "warning"); return; }
        opening = true;
        try {
            pi.events.emit(COMMAND_PALETTE_DISCOVER_EVENT, undefined);
            if (contributions.invalidCount > 0) ctx.ui.notify(`Command Palette ignored ${contributions.invalidCount} invalid contribution registration(s)`, "warning");
            const buildItems = (): PaletteListItem<string>[] => {
                const actions = buildCommandPaletteActions(pi, ctx);
                if (actions.map(action => action.id).join(",") !== commandPaletteActionIds.join(",")) throw new Error("Command Palette registry is incomplete");
                const contributed = contributions.list();
                return [
                    ...actionItems(actions),
                    ...contributed.map(item => ({
                        value: contributionIdentity(item), label: item.label, description: item.description, keywords: item.keywords,
                        state: item.currentValue?.(ctx), disabledReason: item.disabledReason?.(ctx),
                    })),
                ];
            };
            await ctx.ui.custom<null>((tui, theme, _keybindings, done) => {
                const component = new PaletteListComponent<string>({
                    tui,
                    theme,
                    title: "Command Palette",
                    items: buildItems(),
                    keymap,
                    done: () => done(null),
                    onConfirm: async (item, root) => {
                        if (root.busy) return;
                        root.setBusy(true);
                        try {
                            let disposition: CommandPaletteDisposition = "return";
                            if ((commandPaletteActionIds as readonly string[]).includes(item.value)) {
                                disposition = await executePaletteAction(item.value as CommandPaletteActionId, pi, ctx, keymap, root, activeProfileName);
                            } else {
                                const contribution = contributions.list().find(entry => contributionIdentity(entry) === item.value);
                                const result = await contribution?.run(ctx);
                                disposition = result === "close" ? "close" : "return";
                            }
                            if (disposition === "close") {
                                root.close(null);
                                return;
                            }
                            const selectedValue = item.value;
                            root.setItems(buildItems());
                            root.selectValue(selectedValue);
                        } catch (error) {
                            root.setStatus("error", error instanceof Error ? error.message : String(error));
                        } finally {
                            root.setBusy(false);
                        }
                    },
                });
                return component;
            }, {
                overlay: true,
                overlayOptions: { anchor: "center", width: "35%", minWidth: 60, maxHeight: "70%", margin: 1 },
            });
        } finally { opening = false; }
    };
    for (const shortcut of keymap.open) {
        pi.registerShortcut(shortcut, { description: "Open Command Palette", handler: openPalette });
    }
}
