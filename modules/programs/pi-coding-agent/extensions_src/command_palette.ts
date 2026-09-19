import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { commandPaletteActionIds, formatContextUsage, summarizeSession, type CommandPaletteActionId, type PaletteAction, type PaletteListItem } from "./utilities/command_palette_core.ts";
import { COMMAND_PALETTE_DISCOVER_EVENT, COMMAND_PALETTE_REGISTER_EVENT, CommandPaletteContributionRegistry, contributionIdentity, type CommandPaletteDisposition } from "./utilities/command_palette_contributions.ts";
import { loadPaletteKeymap, type ResolvedPaletteKeymap } from "./utilities/command_palette_keymap.ts";
import { formatPaletteBreadcrumb, PaletteListComponent } from "./utilities/command_palette_tui.ts";
import { onActiveMode } from "./utilities/mode_events.ts";
import { openPopupView, providePopupView } from "./popup.ts";

export function buildCommandPaletteActions(_pi: ExtensionAPI, ctx: Pick<ExtensionContext, "ui">): PaletteAction[] {
    return [
        { id: "tool-output", label: "/tool-output  Toggle tool output expansion", description: "Expand or collapse transcript tool results.", keywords: ["tools", "output", "display"], uiKind: "toggle", currentValue: ctx.ui.getToolsExpanded() ? "expanded" : "collapsed" },
        { id: "session-info", label: "/session  Show session information", description: "View session identity, counts, model, and context usage.", keywords: ["session", "stats", "context"], uiKind: "information" },
    ];
}

function actionItems(actions: readonly PaletteAction[]): PaletteListItem<CommandPaletteActionId>[] {
    return actions.map(action => ({ value: action.id, label: action.label, description: action.description, keywords: action.keywords, state: action.currentValue ? `Current: ${action.currentValue}` : undefined, disabledReason: action.disabledReason }));
}

function childTitle(leaf: string): string { return formatPaletteBreadcrumb(["Command Palette", leaf]); }
let hostedViewSequence = 0;
async function runHostedPaletteList<T>(pi: ExtensionAPI, ctx: ExtensionContext, options: { title: string; items: readonly PaletteListItem<T>[]; keymap: ResolvedPaletteKeymap; searchable?: boolean; onConfirm?: (item: PaletteListItem<T>, component: PaletteListComponent<T>) => void | Promise<void> }): Promise<T | null> {
    const id = `command-palette-child-${hostedViewSequence++}`; let selected: T | null = null;
    providePopupView(pi, { id, title: options.title.replace(/^Command Palette › /u, ""), create(view) { return new PaletteListComponent<T>({ tui: view.tui, theme: view.theme, ...options, title: view.breadcrumb.join(" › "), done(value) { selected = value; view.done("back"); } }); } });
    await openPopupView(pi, id, ctx, "push"); return selected;
}

async function showSessionInfo(pi: ExtensionAPI, ctx: ExtensionContext, keymap: ResolvedPaletteKeymap, activeModeName?: string): Promise<string | undefined> {
    const entries = ctx.sessionManager.getEntries(); const counts = summarizeSession(entries); const header = ctx.sessionManager.getHeader();
    const values = [
        ["Name", ctx.sessionManager.getSessionName() ?? "unnamed"], ["File", ctx.sessionManager.getSessionFile() ?? "in-memory"],
        ["Session ID", ctx.sessionManager.getSessionId()], ["Mode", activeModeName ?? "unknown"], ["Entries", String(counts.entryCount)], ["User messages", String(counts.userCount)],
        ["Assistant messages", String(counts.assistantCount)], ["Tool calls", String(counts.toolCallCount)], ["Tool results", String(counts.toolResultCount)],
        ["Current model", ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none"], ["Context usage", formatContextUsage(ctx.getContextUsage())],
        ["Working directory", header?.cwd ?? ctx.cwd],
    ];
    await runHostedPaletteList(pi, ctx, { title: childTitle("Session Information"), keymap, searchable: false, items: values.map(([label, value]) => ({ value: label, label: `${label}: ${value}` })), onConfirm: (_item, component) => component.close(null) });
    return undefined;
}

export async function executePaletteAction(
    id: CommandPaletteActionId,
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    keymap: ResolvedPaletteKeymap,
    root?: PaletteListComponent<string>,
    activeModeName?: string,
): Promise<CommandPaletteDisposition> {
    switch (id) {
        case "tool-output": {
            const expanded = !ctx.ui.getToolsExpanded();
            ctx.ui.setToolsExpanded(expanded);
            root?.setStatus("success", `Tool output: ${expanded ? "expanded" : "collapsed"}`);
            return "return";
        }
        case "session-info": {
            await showSessionInfo(pi, ctx, keymap, activeModeName);
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
    let activeModeName: string | undefined;
    onActiveMode(pi, event => { activeModeName = event.name; });
    providePopupView(pi, { id: "command-palette", title: "Command Palette", create(view) {
        const ctx = view.extensionContext; pi.events.emit(COMMAND_PALETTE_DISCOVER_EVENT, undefined);
        const buildItems = (): PaletteListItem<string>[] => [...actionItems(buildCommandPaletteActions(pi, ctx)), ...contributions.list().map(item => ({ value: contributionIdentity(item), label: item.label, description: item.description, keywords: item.keywords, state: item.currentValue?.(ctx), disabledReason: item.disabledReason?.(ctx) }))];
        return new PaletteListComponent<string>({ tui: view.tui, theme: view.theme, title: view.breadcrumb.join(" › "), items: buildItems(), keymap, done: () => view.done("back"), onConfirm: async (item, root) => {
            if (root.busy) return; root.setBusy(true);
            try { let disposition: CommandPaletteDisposition = "return"; if ((commandPaletteActionIds as readonly string[]).includes(item.value)) disposition = await executePaletteAction(item.value as CommandPaletteActionId, pi, ctx, keymap, root, activeModeName); else { const result = await contributions.list().find(entry => contributionIdentity(entry) === item.value)?.run(ctx); disposition = result === "close" ? "close" : "return"; } if (disposition === "close") { view.done("close-all"); return; } const selected = item.value; root.setItems(buildItems()); root.selectValue(selected); } catch (error) { root.setStatus("error", error instanceof Error ? error.message : String(error)); } finally { root.setBusy(false); }
        } });
    } });
    const openPalette = async (ctx: ExtensionContext): Promise<void> => { try { await openPopupView(pi, "command-palette", ctx, "root"); } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); } };
    for (const shortcut of keymap.open) {
        pi.registerShortcut(shortcut, { description: "Open Command Palette", handler: openPalette });
    }
}
