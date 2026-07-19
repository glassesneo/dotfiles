import type { Model } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { copyToClipboard, type ExtensionAPI, type ExtensionContext, type ToolInfo } from "@earendil-works/pi-coding-agent";
import { commandPaletteActionIds, extractLastAssistantText, formatContextUsage, summarizeSession, type CommandPaletteActionId, type PaletteAction, type PaletteListItem } from "./utilities/command_palette_core.ts";
import { loadPaletteKeymap, type ResolvedPaletteKeymap } from "./utilities/command_palette_keymap.ts";
import { runPaletteList } from "./utilities/command_palette_tui.ts";

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

async function selectModel(pi: ExtensionAPI, ctx: ExtensionContext, keymap: ResolvedPaletteKeymap): Promise<void> {
    ctx.modelRegistry.refresh();
    const models = ctx.modelRegistry.getAvailable();
    const items: PaletteListItem<Model<any>>[] = models.map(model => ({ value: model, label: `${model.provider}/${model.id}`, description: model.name, keywords: [model.provider, model.id, model.name], state: ctx.model?.provider === model.provider && ctx.model.id === model.id ? "Current" : undefined }));
    if (items.length === 0) { ctx.ui.notify("Command Palette: no authenticated models available", "warning"); return; }
    const selected = await runPaletteList(ctx.ui, { title: "Select Model", items, keymap });
    if (!selected) return;
    try { if (!await pi.setModel(selected)) ctx.ui.notify(`Command Palette: no API key for ${selected.provider}/${selected.id}`, "error"); else ctx.ui.notify(`Model: ${selected.provider}/${selected.id}`, "info"); }
    catch (error) { ctx.ui.notify(`Command Palette model error: ${error instanceof Error ? error.message : String(error)}`, "error"); }
}

async function selectThinking(pi: ExtensionAPI, ctx: ExtensionContext, keymap: ResolvedPaletteKeymap): Promise<void> {
    if (!ctx.model) { ctx.ui.notify("Command Palette: no current model", "warning"); return; }
    const current = pi.getThinkingLevel();
    const levels = getSupportedThinkingLevels(ctx.model);
    const selected = await runPaletteList(ctx.ui, { title: "Select Reasoning Effort", keymap, items: levels.map(level => ({ value: level, label: level, state: level === current ? "Current" : undefined })) });
    if (!selected) return;
    try { pi.setThinkingLevel(selected); ctx.ui.notify(`Reasoning effort: ${pi.getThinkingLevel()}`, "info"); }
    catch (error) { ctx.ui.notify(`Command Palette reasoning error: ${error instanceof Error ? error.message : String(error)}`, "error"); }
}

function toolItems(tools: readonly ToolInfo[], active: ReadonlySet<string>): PaletteListItem<string>[] {
    return tools.map(tool => ({ value: tool.name, label: tool.name, description: `${tool.description} • source: ${tool.sourceInfo.source}`, keywords: [tool.sourceInfo.source], state: active.has(tool.name) ? "Active" : "Inactive" }));
}

async function configureTools(pi: ExtensionAPI, ctx: ExtensionContext, keymap: ResolvedPaletteKeymap): Promise<void> {
    const tools = pi.getAllTools(); const active = new Set(pi.getActiveTools());
    if (tools.length === 0) { ctx.ui.notify("Command Palette: no tools available", "warning"); return; }
    await runPaletteList(ctx.ui, { title: "Configure Active Tools — changes apply immediately; cancel does not roll back", keymap, items: toolItems(tools, active), onConfirm: async (item, component) => {
        if (active.has(item.value) && active.size === 1) {
            const confirmed = await ctx.ui.confirm("Disable last active tool?", "The model will have no active tools.");
            if (!confirmed) { component.setStatus("warning", "Last tool remains active."); return; }
        }
        active.has(item.value) ? active.delete(item.value) : active.add(item.value);
        pi.setActiveTools([...active]); component.setItems(toolItems(tools, active)); component.setStatus("success", `${item.value} is now ${active.has(item.value) ? "active" : "inactive"}.`);
    } });
}

async function showSessionInfo(ctx: ExtensionContext, keymap: ResolvedPaletteKeymap): Promise<void> {
    const entries = ctx.sessionManager.getEntries(); const counts = summarizeSession(entries); const header = ctx.sessionManager.getHeader();
    const values = [
        ["Name", ctx.sessionManager.getSessionName() ?? "unnamed"], ["File", ctx.sessionManager.getSessionFile() ?? "in-memory"],
        ["Session ID", ctx.sessionManager.getSessionId()], ["Entries", String(counts.entryCount)], ["User messages", String(counts.userCount)],
        ["Assistant messages", String(counts.assistantCount)], ["Tool calls", String(counts.toolCallCount)], ["Tool results", String(counts.toolResultCount)],
        ["Current model", ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none"], ["Context usage", formatContextUsage(ctx.getContextUsage())],
        ["Working directory", header?.cwd ?? ctx.cwd],
    ];
    await runPaletteList(ctx.ui, { title: "Session Information", keymap, searchable: false, items: values.map(([label, value]) => ({ value: label, label: `${label}: ${value}` })), onConfirm: (_item, component) => component.close(null) });
}

async function copyLastResponse(ctx: ExtensionContext): Promise<void> {
    const text = extractLastAssistantText(ctx.sessionManager.getBranch());
    if (!text) { ctx.ui.notify("Command Palette: no assistant text on the active branch", "error"); return; }
    try { await copyToClipboard(text); ctx.ui.notify("Copied last assistant response", "info"); }
    catch (error) { ctx.ui.notify(`Clipboard error: ${error instanceof Error ? error.message : String(error)}`, "error"); }
}

async function selectTheme(ctx: ExtensionContext, keymap: ResolvedPaletteKeymap): Promise<void> {
    const current = ctx.ui.theme.name;
    const selected = await runPaletteList(ctx.ui, { title: "Select Theme", keymap, items: ctx.ui.getAllThemes().map(theme => ({ value: theme.name, label: theme.name, description: theme.path ?? "built-in", state: theme.name === current ? "Current" : undefined })) });
    if (!selected) return;
    const result = ctx.ui.setTheme(selected); if (!result.success) ctx.ui.notify(`Theme error: ${result.error ?? "unknown error"}`, "error"); else ctx.ui.notify(`Theme: ${selected}`, "info");
}

export async function executePaletteAction(id: CommandPaletteActionId, pi: ExtensionAPI, ctx: ExtensionContext, keymap: ResolvedPaletteKeymap): Promise<void> {
    switch (id) {
        case "model": return selectModel(pi, ctx, keymap); case "thinking": return selectThinking(pi, ctx, keymap); case "tools": return configureTools(pi, ctx, keymap);
        case "tool-output": { const expanded = !ctx.ui.getToolsExpanded(); ctx.ui.setToolsExpanded(expanded); ctx.ui.notify(`Tool output: ${expanded ? "expanded" : "collapsed"}`, "info"); return; }
        case "session-info": return showSessionInfo(ctx, keymap); case "copy-last-response": return copyLastResponse(ctx); case "theme": return selectTheme(ctx, keymap);
    }
}

export default function commandPalette(pi: ExtensionAPI): void {
    const { keymap } = loadPaletteKeymap();
    let opening = false;
    const openPalette = async (ctx: ExtensionContext): Promise<void> => {
        if (opening) return;
        if (ctx.mode !== "tui") { ctx.ui.notify("Command Palette requires TUI mode", "warning"); return; }
        opening = true;
        try {
            const actions = buildCommandPaletteActions(pi, ctx);
            if (actions.map(action => action.id).join(",") !== commandPaletteActionIds.join(",")) throw new Error("Command Palette registry is incomplete");
            const selected = await runPaletteList(ctx.ui, { title: "Command Palette", items: actionItems(actions), keymap });
            if (selected) await executePaletteAction(selected, pi, ctx, keymap);
        }
        finally { opening = false; }
    };
    for (const shortcut of keymap.open) {
        pi.registerShortcut(shortcut, { description: "Open Command Palette", handler: openPalette });
    }
}
