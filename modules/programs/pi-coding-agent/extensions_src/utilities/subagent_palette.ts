import { type ExtensionContext, type ExtensionUIContext, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import type { CommandPaletteDisposition } from "./command_palette_contributions.ts";
import { paletteHelp, paletteKeyAction, type ResolvedPaletteKeymap } from "./command_palette_keymap.ts";
import { formatPaletteBreadcrumb, renderFramedLines } from "./command_palette_tui.ts";
import { historyAvailability, openSubagentHistory } from "./subagent_history.ts";
import {
    AGENT_STATE_BADGES,
    buildSubagentDisplayTree,
    flattenVisibleDisplayNodes,
    formatStateBadge,
    profileColorRole,
    retainSelection,
    treeConnectors,
    type SubagentDisplayNode,
    type SubagentDisplayTree,
} from "./subagent_display_tree.ts";
import { OriginAgentDiscovery, stopSubagentAgent } from "./subagent_management.ts";
import { openLivePreview, type LivePreviewDisposition } from "./subagent_preview.ts";
import { openAgentWindow, probeTmux, unlinkAgentWindow, type CommandExecutor } from "./subagent_tmux.ts";
import { isTerminalAgent, type AgentSnapshot } from "./subagent_types.ts";

export interface SubagentPaletteDependencies {
    stateRoot: string;
    originSessionId: string;
    exec: CommandExecutor;
    tmux: string;
    historyViewerExtension: string;
    piCommand: string;
    natureHandleWords: readonly string[];
    env?: NodeJS.ProcessEnv;
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
    /** Optional test/harness overrides for open paths. */
    openHistory?: typeof openSubagentHistory;
    openLiveWindow?: typeof openAgentWindow;
    previewLive?: (exec: CommandExecutor, tmux: string, context: NonNullable<Awaited<ReturnType<typeof probeTmux>>>, target: AgentSnapshot["agent"]["tmux"], title: string) => Promise<LivePreviewDisposition>;
    stopAgent?: typeof stopSubagentAgent;
    discover?: () => Promise<{ agents: AgentSnapshot[]; malformedCount: number }>;
}

export type SubagentPaletteResult = CommandPaletteDisposition;

function dimIf(theme: Theme, ghost: boolean, text: string): string {
    return ghost ? theme.fg("dim", text) : text;
}

function joinParts(parts: readonly string[], separator = " · "): string {
    return parts.filter(part => part.trim().length > 0).join(separator);
}

/** Width-aware line 1.
 * Drop order: profile → connector → shorten state.
 * Preserve the full handle whenever marker+expand+handle fit with any state remnant.
 * Only truncate the handle when even a minimal state symbol cannot share the row.
 */
export function composeIdentityLine(options: {
    width: number;
    marker: string;
    connector: string;
    expand: string;
    handle: string;
    profile: string;
    state: string;
}): string {
    const gap = " ";
    const fits = (text: string): boolean => visibleWidth(text) <= options.width;
    const withState = (prefix: string, state: string): string => `${prefix}${gap}${state}`;
    const prefixes = [
        `${options.marker}${options.connector}${options.expand}${options.handle}${gap}${options.profile}`,
        `${options.marker}${options.connector}${options.expand}${options.handle}`,
        `${options.marker}${options.expand}${options.handle}`,
    ];
    for (const prefix of prefixes) {
        const line = withState(prefix, options.state);
        if (fits(line)) return line;
    }
    const handlePrefix = `${options.marker}${options.expand}${options.handle}`;
    if (visibleWidth(handlePrefix) < options.width) {
        const stateBudget = Math.max(1, options.width - visibleWidth(handlePrefix) - 1);
        return truncateToWidth(withState(handlePrefix, truncateToWidth(options.state, stateBudget, "")), options.width, "");
    }
    const stateSymbol = options.state.trim().split(/\s+/u)[0] ?? "";
    if (stateSymbol && visibleWidth(`${gap}${stateSymbol}`) < options.width) {
        const symbolPart = `${gap}${stateSymbol}`;
        const prefix = truncateToWidth(handlePrefix, options.width - visibleWidth(symbolPart), "");
        return truncateToWidth(`${prefix}${symbolPart}`, options.width, "");
    }
    return truncateToWidth(handlePrefix, options.width, "");
}

export function evenViewportRows(rows: number): number {
    const value = Math.max(2, rows);
    return value - (value % 2);
}

export class SubagentPaletteComponent implements Component, Focusable {
    readonly #tui: TUI;
    readonly #theme: Theme;
    readonly #ui: Pick<ExtensionUIContext, "confirm">;
    readonly #keymap: ResolvedPaletteKeymap;
    readonly #deps: SubagentPaletteDependencies;
    readonly #done: (value: SubagentPaletteResult) => void;
    #tree: SubagentDisplayTree = { roots: [], byId: new Map(), handles: new Map() };
    #collapsed = new Set<string>();
    #selectedAgentId?: string;
    #previousVisibleIds: string[] = [];
    #focused = false;
    #status = "Loading…";
    #statusKind: "success" | "error" | "warning" | "dim" = "dim";
    #timer?: NodeJS.Timeout;
    #refreshing = false;
    #refreshQueued = false;
    #refreshDone: Promise<void> = Promise.resolve();
    #lastRefreshApplied = false;
    #acting = false;
    #cancelRequested = false;
    #disposed = false;
    #closeDisposition: SubagentPaletteResult = "return";
    #cachedWidth?: number;
    #cachedLines?: string[];

    constructor(options: {
        tui: TUI;
        theme: Theme;
        ui: Pick<ExtensionUIContext, "confirm">;
        keymap: ResolvedPaletteKeymap;
        deps: SubagentPaletteDependencies;
        done: (value: SubagentPaletteResult) => void;
    }) {
        this.#tui = options.tui;
        this.#theme = options.theme;
        this.#ui = options.ui;
        this.#keymap = options.keymap;
        this.#deps = options.deps;
        this.#done = options.done;
    }

    get focused() { return this.#focused; }
    set focused(value: boolean) { this.#focused = value; }
    get selectedAgentId() { return this.#selectedAgentId; }
    get collapsedIds() { return new Set(this.#collapsed); }
    get acting() { return this.#acting; }
    selected(): AgentSnapshot | undefined {
        return this.#selectedAgentId ? this.#tree.byId.get(this.#selectedAgentId)?.snapshot : undefined;
    }
    visibleNodes(): SubagentDisplayNode[] {
        return flattenVisibleDisplayNodes(this.#tree.roots, this.#collapsed);
    }
    /** Test/harness seam: replace the display tree without tmux reconciliation. */
    replaceAgents(agents: readonly AgentSnapshot[], malformedCount = 0): void {
        this.#applySnapshots(agents, malformedCount);
        this.invalidate();
        this.#tui.requestRender();
    }
    invalidate() { this.#cachedWidth = undefined; this.#cachedLines = undefined; }
    start() { void this.refresh(); }

    close(disposition: SubagentPaletteResult = this.#closeDisposition) {
        if (this.#disposed) return;
        this.#disposed = true;
        if (this.#timer) (this.#deps.clearTimeout ?? clearTimeout)(this.#timer);
        this.#timer = undefined;
        this.#done(disposition);
    }

    #setStatus(kind: "success" | "error" | "warning" | "dim", text: string): void {
        this.#statusKind = kind;
        this.#status = text;
        this.invalidate();
        this.#tui.requestRender();
    }

    #applySnapshots(agents: readonly AgentSnapshot[], malformedCount: number): void {
        const previousVisible = this.visibleNodes().map(node => node.agentId);
        this.#tree = buildSubagentDisplayTree(agents, this.#deps.natureHandleWords);
        const known = new Set(this.#tree.byId.keys());
        this.#collapsed = new Set([...this.#collapsed].filter(id => known.has(id) && (this.#tree.byId.get(id)?.children.length ?? 0) > 0));
        const visible = this.visibleNodes();
        this.#selectedAgentId = retainSelection(this.#selectedAgentId, visible, previousVisible.length ? previousVisible : this.#previousVisibleIds);
        this.#previousVisibleIds = visible.map(node => node.agentId);
        this.#statusKind = malformedCount ? "warning" : "dim";
        this.#status = malformedCount ? `${malformedCount} incomplete agent record(s)` : `${agents.length} agent session(s)`;
    }

    /** Replace one agent in the current projection without waiting on discovery. */
    #upsertSnapshot(snapshot: AgentSnapshot): void {
        const agents = [...this.#tree.byId.values()].map(node => node.snapshot);
        const index = agents.findIndex(agent => agent.agent.agentId === snapshot.agent.agentId);
        if (index >= 0) agents[index] = snapshot;
        else agents.push(snapshot);
        this.#applySnapshots(agents, 0);
        this.#selectedAgentId = snapshot.agent.agentId;
        this.invalidate();
        this.#tui.requestRender();
    }

    async refresh(): Promise<boolean> {
        if (this.#disposed) return false;
        if (this.#refreshing) {
            this.#refreshQueued = true;
            await this.#refreshDone;
            return this.#lastRefreshApplied;
        }
        let resolveDone!: () => void;
        this.#refreshDone = new Promise<void>(resolve => { resolveDone = resolve; });
        this.#refreshing = true;
        this.#lastRefreshApplied = false;
        if (this.#timer) (this.#deps.clearTimeout ?? clearTimeout)(this.#timer);
        this.#timer = undefined;
        try {
            do {
                this.#refreshQueued = false;
                try {
                    const found = this.#deps.discover
                        ? await this.#deps.discover()
                        : await new OriginAgentDiscovery(this.#deps).refresh();
                    if (this.#disposed) return false;
                    this.#applySnapshots(found.agents, found.malformedCount);
                    this.#lastRefreshApplied = true;
                } catch (error) {
                    this.#lastRefreshApplied = false;
                    if (!this.#disposed) this.#setStatus("error", `Refresh failed: ${error instanceof Error ? error.message : String(error)}`);
                }
            } while (this.#refreshQueued && !this.#disposed);
        } finally {
            this.#refreshing = false;
            resolveDone();
            if (!this.#disposed) {
                this.invalidate();
                this.#tui.requestRender();
                this.#timer = (this.#deps.setTimeout ?? setTimeout)(() => {
                    this.#timer = undefined;
                    void this.refresh();
                }, 1000);
            }
        }
        return this.#lastRefreshApplied;
    }

    /** Wait until any in-flight refresh finishes, then load one fresh snapshot. */
    async #reloadAfterMutation(): Promise<boolean> {
        if (this.#refreshing) {
            this.#refreshQueued = true;
            await this.#refreshDone;
        }
        if (this.#disposed) return false;
        return this.refresh();
    }

    #move(delta: number): void {
        const visible = this.visibleNodes();
        if (visible.length === 0) return;
        const current = Math.max(0, visible.findIndex(node => node.agentId === this.#selectedAgentId));
        const next = Math.max(0, Math.min(visible.length - 1, current + delta));
        this.#selectedAgentId = visible[next]?.agentId;
        this.invalidate();
        this.#tui.requestRender();
    }

    #collapse(): void {
        const node = this.#selectedAgentId ? this.#tree.byId.get(this.#selectedAgentId) : undefined;
        if (!node) return;
        if (node.children.length > 0 && !this.#collapsed.has(node.agentId)) {
            this.#collapsed.add(node.agentId);
            this.invalidate();
            this.#tui.requestRender();
            return;
        }
        const parent = [...this.#tree.byId.values()].find(candidate => candidate.children.some(child => child.agentId === node.agentId));
        if (parent) {
            this.#selectedAgentId = parent.agentId;
            this.invalidate();
            this.#tui.requestRender();
        }
    }

    #expand(): void {
        const node = this.#selectedAgentId ? this.#tree.byId.get(this.#selectedAgentId) : undefined;
        if (!node) return;
        if (node.children.length > 0 && this.#collapsed.has(node.agentId)) {
            this.#collapsed.delete(node.agentId);
            this.invalidate();
            this.#tui.requestRender();
            return;
        }
        if (node.children.length > 0) {
            this.#selectedAgentId = node.children[0]?.agentId;
            this.invalidate();
            this.#tui.requestRender();
        }
    }

    async action(kind: "open" | "preview" | "unlink" | "stop") {
        const selected = this.selected();
        const node = this.#selectedAgentId ? this.#tree.byId.get(this.#selectedAgentId) : undefined;
        if (!selected || !node || this.#acting || this.#disposed) return;
        if ((kind === "stop" || kind === "unlink") && node.ghost) {
            this.#setStatus("warning", kind === "stop" ? "Stop is available only for live agents." : "Unlink is available only for live agents.");
            return;
        }
        if (kind === "preview" && isTerminalAgent(selected.status.state)) {
            this.#setStatus("warning", "Live preview is available only for live agents. Press Enter for history.");
            return;
        }
        this.#acting = true;
        this.#cancelRequested = false;
        this.#setStatus("warning", "WORKING");
        try {
            if (kind === "stop") {
                const confirmed = await this.#ui.confirm(`Stop ${node.handle}?`, "This kills the agent window and every linked view. Use Unlink to close only this view.");
                if (!confirmed) {
                    if (this.#cancelRequested) { this.close("return"); return; }
                    this.#setStatus("dim", `${this.#tree.byId.size} agent session(s)`);
                    return;
                }
                const stopped = await (this.#deps.stopAgent ?? stopSubagentAgent)({ ...this.#deps, agentId: selected.agent.agentId });
                // Apply Stop immediately, then reload. Re-assert after reload so a raced stale poll cannot revive the node.
                this.#upsertSnapshot(stopped);
                const refreshed = await this.#reloadAfterMutation();
                if (this.#disposed) return;
                this.#upsertSnapshot(stopped);
                if (refreshed) this.#setStatus("success", `Stopped ${node.handle}`);
                else this.#setStatus("warning", `Stopped ${node.handle}; refresh failed — showing stop result`);
                if (this.#cancelRequested) this.close("return");
                return;
            }
            if (kind === "open" && isTerminalAgent(selected.status.state)) {
                const availability = historyAvailability(selected);
                if (!availability.available) {
                    this.#setStatus("warning", availability.reason ?? "history unavailable");
                    if (this.#cancelRequested) this.close("return");
                    return;
                }
            }
            const context = await probeTmux(this.#deps.exec, this.#deps.tmux, this.#deps.env);
            if (!context) throw new Error("Current Pi is not attached to a usable tmux client");
            if (kind === "open") {
                if (isTerminalAgent(selected.status.state)) {
                    await (this.#deps.openHistory ?? openSubagentHistory)(this.#deps.exec, this.#deps, context, selected);
                    // History is not live tmux Open: dismiss only the subagent palette and restore root.
                    this.close("return");
                    return;
                }
                await (this.#deps.openLiveWindow ?? openAgentWindow)(this.#deps.exec, this.#deps.tmux, context, selected.agent.tmux);
                this.#closeDisposition = "close";
                this.close("close");
                return;
            }
            if (kind === "preview") {
                const disposition = await (this.#deps.previewLive ?? openLivePreview)(
                    this.#deps.exec,
                    this.#deps.tmux,
                    context,
                    selected.agent.tmux,
                    `${node.handle} · Esc/C-c/q back · Enter open full`,
                );
                if (disposition === "open-full") {
                    const currentContext = await probeTmux(this.#deps.exec, this.#deps.tmux, this.#deps.env);
                    if (!currentContext) throw new Error("Current Pi is not attached to a usable tmux client");
                    await (this.#deps.openLiveWindow ?? openAgentWindow)(this.#deps.exec, this.#deps.tmux, currentContext, selected.agent.tmux);
                    this.#closeDisposition = "close";
                    this.close("close");
                    return;
                }
                const refreshed = await this.#reloadAfterMutation();
                if (this.#disposed) return;
                if (this.#tree.byId.has(selected.agent.agentId)) this.#selectedAgentId = selected.agent.agentId;
                if (refreshed) this.#setStatus("dim", `Preview closed for ${node.handle}`);
                if (this.#cancelRequested) this.close("return");
                return;
            }
            await unlinkAgentWindow(this.#deps.exec, this.#deps.tmux, context, selected.agent.tmux);
            await this.#reloadAfterMutation();
            if (this.#disposed) return;
            this.#setStatus("success", `Unlinked ${node.handle}`);
            if (this.#cancelRequested) this.close("return");
        } catch (error) {
            if (this.#cancelRequested) {
                this.close("return");
                return;
            }
            if (!this.#disposed) this.#setStatus("error", `${kind} failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally { this.#acting = false; }
    }

    handleInput(data: string) {
        if (this.#disposed) return;
        const action = paletteKeyAction(data, this.#keymap);
        if (action === "cancel") {
            if (this.#acting) {
                // Defer close until the in-flight action settles so a successful live Open still emits "close".
                this.#cancelRequested = true;
                return;
            }
            this.close("return");
            return;
        }
        if (this.#acting) return;
        if (action === "moveUp") this.#move(-1);
        else if (action === "moveDown") this.#move(1);
        else if (action === "collapse") this.#collapse();
        else if (action === "expand") this.#expand();
        else if (action === "confirm") void this.action("open");
        else if (action === "stop") void this.action("stop");
        else if (action === "refresh") void this.refresh();
        else if (data === "v") void this.action("preview");
        else if (data === "u") void this.action("unlink");
        else return;
        this.invalidate();
        this.#tui.requestRender();
    }

    #nodeLines(node: SubagentDisplayNode, selected: boolean, connector: string, width: number): string[] {
        const badge = AGENT_STATE_BADGES[node.snapshot.status.state];
        const expand = node.children.length > 0 ? (this.#collapsed.has(node.agentId) ? "▸ " : "▾ ") : "  ";
        const marker = selected ? "> " : "  ";
        const handle = dimIf(this.#theme, node.ghost, this.#theme.bold(node.handle));
        const profile = dimIf(this.#theme, node.ghost, this.#theme.fg(profileColorRole(node.snapshot.agent.profile), node.snapshot.agent.profile));
        const stateText = this.#theme.fg(badge.role, formatStateBadge(node.snapshot.status.state));
        const line1Raw = composeIdentityLine({
            width,
            marker,
            connector,
            expand,
            handle,
            profile,
            state: stateText,
        });
        const line1 = truncateToWidth(selected ? this.#theme.bg("selectedBg", line1Raw) : line1Raw, width, "");

        const taskState = node.snapshot.task?.status.state ?? "no-task";
        const shortId = node.snapshot.agent.agentId.slice(0, 8);
        const intervention = (node.snapshot.task?.interventions.length ?? 0) > 0 ? "intervention" : "";
        const history = node.ghost
            ? (historyAvailability(node.snapshot).available ? "history" : "history unavailable")
            : "";
        const via = node.viaHandle ? `via ${node.viaHandle}` : "";
        const orphan = node.orphaned ? "orphaned lineage" : "";
        const purpose = dimIf(this.#theme, node.ghost, this.#theme.fg("muted", node.snapshot.agent.purpose));
        const meta = dimIf(this.#theme, node.ghost, this.#theme.fg("dim", joinParts([taskState, shortId, intervention, history, via, orphan])));
        const indentWidth = Math.min(width, visibleWidth(`${marker}${expand}`));
        const indent = " ".repeat(indentWidth);
        const line2Raw = truncateToWidth(`${indent}${purpose}  ${meta}`, width, "");
        const line2 = truncateToWidth(selected ? this.#theme.bg("selectedBg", line2Raw) : line2Raw, width, "");
        return [line1, line2];
    }

    #viewport(visible: readonly SubagentDisplayNode[], connectors: Map<string, string>, width: number, viewportRows: number): string[] {
        const rows = evenViewportRows(viewportRows);
        if (visible.length === 0) {
            const lines = [truncateToWidth(this.#theme.fg("warning", " No agents for this origin session."), width, "")];
            while (lines.length < rows) lines.push("");
            return lines.slice(0, rows);
        }
        const blocks = visible.map(node => this.#nodeLines(node, node.agentId === this.#selectedAgentId, connectors.get(node.agentId) ?? "", width));
        const offsets: number[] = [];
        const flat: string[] = [];
        for (const block of blocks) { offsets.push(flat.length); flat.push(...block); }
        const selectedIndex = Math.max(0, visible.findIndex(node => node.agentId === this.#selectedAgentId));
        const selectedStart = offsets[selectedIndex] ?? 0;
        const selectedLength = blocks[selectedIndex]?.length ?? 2;
        const selectedEnd = selectedStart + selectedLength - 1;
        let start = selectedStart - Math.floor(Math.max(0, rows - Math.min(selectedLength, rows)) / 2);
        start = Math.max(0, Math.min(start, Math.max(0, flat.length - rows)));
        if (selectedLength <= rows && selectedEnd >= start + rows) start = selectedEnd - rows + 1;
        // Always align to complete two-line blocks.
        start -= start % 2;
        const lines = flat.slice(start, start + rows);
        while (lines.length < rows) lines.push("");
        return lines.slice(0, rows);
    }

    render(width: number): string[] {
        const w = Math.max(1, width);
        if (this.#cachedLines && this.#cachedWidth === w) return this.#cachedLines;
        const rows = Math.max(10, Math.min(22, Math.floor(this.#tui.terminal.rows * 0.7)));
        const inner = Math.max(1, w - 2);
        const visible = this.visibleNodes();
        const connectors = treeConnectors(visible, this.#tree.byId);
        const help = paletteHelp(this.#keymap, ["moveUp", "moveDown", "collapse", "expand", "confirm", "stop", "refresh", "cancel"]);
        const terminalPreviewMessage = "Live preview is available only for live agents. Press Enter for history.";
        const statusLines = !this.#acting && this.#status === terminalPreviewMessage
            ? ["Live preview is available only for live agents.", "Press Enter for history."]
            : [this.#acting ? "WORKING" : this.#status];
        const body: string[] = [
            truncateToWidth(` ${this.#theme.fg("muted", "Enter open/history · v preview · u unlink · Stop ends a live agent")}`, inner, ""),
            "",
            ...this.#viewport(visible, connectors, inner, Math.max(2, rows - 5 - statusLines.length)),
            ...statusLines.map(line => truncateToWidth(` ${this.#theme.fg(this.#statusKind, line)}`, inner, "")),
            truncateToWidth(` ${this.#theme.fg("dim", `${help} · v preview · u unlink`)}`, inner, ""),
        ];
        const lines = renderFramedLines({
            theme: this.#theme,
            width: w,
            title: formatPaletteBreadcrumb(["Command Palette", "Subagent Sessions"]),
            body,
        });
        this.#cachedLines = lines.map(line => truncateToWidth(line, w, ""));
        this.#cachedWidth = w;
        return this.#cachedLines;
    }
}

export async function openSubagentPalette(ctx: ExtensionContext, keymap: ResolvedPaletteKeymap, deps: SubagentPaletteDependencies): Promise<SubagentPaletteResult> {
    if (ctx.mode !== "tui") { ctx.ui.notify("Subagent management requires TUI mode", "warning"); return "return"; }
    return await ctx.ui.custom<SubagentPaletteResult>((tui, theme, _bindings, done) => {
        const component = new SubagentPaletteComponent({ tui, theme, ui: ctx.ui, keymap, deps, done });
        component.start();
        return component;
    }, { overlay: true, overlayOptions: { anchor: "center", width: "70%", minWidth: 60, maxHeight: "80%", margin: 1 } }) ?? "return";
}
