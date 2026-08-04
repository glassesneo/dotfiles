import { type ExtensionContext, type ExtensionUIContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import type { CommandPaletteDisposition } from "./command_palette_contributions.ts";
import { paletteHelp, paletteKeyAction, type ResolvedPaletteKeymap } from "./command_palette_keymap.ts";
import { actionHint } from "./extension_keybindings.ts";
import { formatPaletteBreadcrumb, renderFramedLines } from "./command_palette_tui.ts";
import { historyAvailability, openSubagentHistory } from "./subagent_history.ts";
import {
    AGENT_STATE_BADGES,
    buildSubagentDisplayTree,
    flattenVisibleDisplayNodes,
    formatStateBadge,
    formatTaskStateBadge,
    profileColorRole,
    retainSelection,
    TASK_STATE_BADGES,
    treeConnectors,
    type SubagentDisplayNode,
    type SubagentDisplayTree,
} from "./subagent_display_tree.ts";
import { OriginAgentDiscovery, stopSubagentAgent } from "./subagent_management.ts";
import { openLivePreview, type LivePreviewDisposition } from "./subagent_preview.ts";
import { openAgentWindow, probeTmux, unlinkAgentWindow, type CommandExecutor } from "./subagent_tmux.ts";
import { isTerminalAgent, isTerminalTask, type AgentSnapshot, type TaskState } from "./subagent_types.ts";

export interface SubagentPaletteDependencies {
    stateRoot: string;
    originSessionId: string;
    exec: CommandExecutor;
    tmux: string;
    historyViewerExtension: string;
    piCommand: string;
    natureHandleWords: readonly string[];
    tmuxPreviewActions?: Record<string, readonly string[]>;
    env?: NodeJS.ProcessEnv;
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
    /** Optional test/harness overrides for open paths. */
    openHistory?: typeof openSubagentHistory;
    openLiveWindow?: typeof openAgentWindow;
    previewLive?: (exec: CommandExecutor, tmux: string, context: NonNullable<Awaited<ReturnType<typeof probeTmux>>>, target: AgentSnapshot["agent"]["tmux"], title: string, seams?: Parameters<typeof openLivePreview>[5]) => Promise<LivePreviewDisposition>;
    stopAgent?: typeof stopSubagentAgent;
    discover?: () => Promise<{ agents: AgentSnapshot[]; malformedCount: number }>;
}

export type SubagentPaletteResult = CommandPaletteDisposition;

/** Framed-body inner width at which the selected-agent detail pane appears. */
export const DETAIL_BREAKPOINT = 100;

export type DetailSemanticRole = Extract<ThemeColor, "accent" | "success" | "error" | "warning" | "muted">;

export interface DetailPaneModel {
    role: DetailSemanticRole;
    title: string;
    badgeState?: TaskState;
    body: string;
    notices: ReadonlyArray<{ text: string; role: DetailSemanticRole }>;
}

function dimIf(theme: Theme, ghost: boolean, text: string): string {
    return ghost ? theme.fg("dim", text) : text;
}

function normalizeNewlines(text: string): string {
    return text.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
}

function padToWidth(text: string, width: number): string {
    const truncated = truncateToWidth(text, width, "");
    return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

function isNonblank(text: string | undefined): text is string {
    return typeof text === "string" && text.trim().length > 0;
}

/** Width-aware identity line without purpose.
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

/** One-row agent line: try purpose-bearing forms, then fall back to identity composition. */
export function composeAgentRow(options: {
    width: number;
    marker: string;
    connector: string;
    expand: string;
    handle: string;
    profile: string;
    state: string;
    purpose: string;
}): string {
    const gap = " ";
    const fits = (text: string): boolean => visibleWidth(text) <= options.width;
    const purpose = options.purpose.trim().length > 0 ? options.purpose : "";
    if (purpose) {
        const purposePrefixes = [
            `${options.marker}${options.connector}${options.expand}${options.handle}${gap}${options.state}${gap}${options.profile}`,
            `${options.marker}${options.connector}${options.expand}${options.handle}${gap}${options.state}`,
            `${options.marker}${options.expand}${options.handle}${gap}${options.state}`,
        ];
        for (const prefix of purposePrefixes) {
            const full = `${prefix}${gap}${purpose}`;
            if (fits(full)) return full;
        }
        for (const prefix of purposePrefixes) {
            const used = visibleWidth(prefix) + 1;
            if (used >= options.width) continue;
            const budget = options.width - used;
            if (budget < 2) continue;
            const shortened = truncateToWidth(purpose, budget, "…");
            const line = `${prefix}${gap}${shortened}`;
            if (fits(line)) return line;
        }
    }
    return composeIdentityLine(options);
}

/** Split framed-body inner width into list and optional detail columns. */
export function splitPaletteColumns(innerWidth: number): { listWidth: number; detailWidth?: number } {
    const width = Math.max(1, innerWidth);
    if (width < DETAIL_BREAKPOINT) return { listWidth: width };
    const listWidth = Math.min(52, Math.max(36, Math.round(width * 0.4)));
    return { listWidth, detailWidth: Math.max(1, width - listWidth - 3) };
}

/** Derive detail-pane content from the selected snapshot. */
export function detailPaneModel(snapshot: AgentSnapshot | undefined): DetailPaneModel {
    if (!snapshot) {
        return { role: "muted", title: "Detail", body: "", notices: [{ text: "No agent selected.", role: "muted" }] };
    }
    const task = snapshot.task;
    if (!task) {
        return {
            role: "warning",
            title: "Purpose",
            body: snapshot.agent.purpose,
            notices: [{ text: "No task record", role: "muted" }],
        };
    }
    if (!isTerminalTask(task.status.state)) {
        return {
            role: "accent",
            title: "Instruction",
            badgeState: task.status.state,
            body: task.request.prompt,
            notices: [],
        };
    }
    if (task.result) {
        const role: DetailSemanticRole = task.status.state === "succeeded" ? "success" : task.status.state === "failed" ? "error" : "warning";
        if (isNonblank(task.result.output)) {
            return { role, title: "Answer", badgeState: task.status.state, body: task.result.output, notices: [] };
        }
        if (isNonblank(task.result.error)) {
            return { role, title: "Answer", badgeState: task.status.state, body: task.result.error, notices: [] };
        }
        return {
            role,
            title: "Answer",
            badgeState: task.status.state,
            body: "",
            notices: [{ text: "No answer text was recorded.", role: "muted" }],
        };
    }
    return {
        role: "warning",
        title: "Answer",
        badgeState: task.status.state,
        body: task.request.prompt,
        notices: [{ text: "Answer not recorded", role: "warning" }],
    };
}

/** Clip lines to height with a final ellipsis when content overflows; does not pad. */
export function clipOverflowLines(lines: readonly string[], height: number, width: number): string[] {
    const rows = Math.max(0, height);
    if (rows === 0) return [];
    if (lines.length <= rows) return lines.map(line => truncateToWidth(line, width, ""));
    const clipped: string[] = [];
    for (let index = 0; index < rows; index += 1) {
        const line = lines[index] ?? "";
        if (index < rows - 1) {
            clipped.push(truncateToWidth(line, width, ""));
            continue;
        }
        // Vertical overflow: always mark the final visible row, even when it fits horizontally.
        const budget = Math.max(1, width);
        const head = truncateToWidth(line, Math.max(0, budget - 1), "");
        clipped.push(truncateToWidth(`${head}…`, budget, ""));
    }
    return clipped;
}

/** Wrap and vertically clip detail body lines; ellipsis marks clipped overflow. */
export function clipDetailLines(lines: readonly string[], height: number, width: number): string[] {
    const clipped = clipOverflowLines(lines, height, width);
    while (clipped.length < Math.max(0, height)) clipped.push("");
    return clipped;
}

/**
 * Compose detail pane sections while keeping required notices visible.
 * Notices are reserved first, then header, then body fills any remainder and clips with ellipsis.
 * When a nonblank body would otherwise receive zero rows, drop trailing decorative header
 * lines (the divider) so title + clipped body/ellipsis + notice can share the minimum height.
 * Visual order remains header → body → notices.
 */
export function composeDetailSections(options: {
    width: number;
    height: number;
    headerLines: readonly string[];
    bodyLines: readonly string[];
    noticeLines: readonly string[];
}): string[] {
    const width = Math.max(1, options.width);
    const height = Math.max(0, options.height);
    if (height === 0) return [];
    const notices = options.noticeLines.map(line => truncateToWidth(line, width, ""));
    const header = options.headerLines.map(line => truncateToWidth(line, width, ""));
    const noticeCount = Math.min(notices.length, height);
    const reservedNotices = notices.slice(0, noticeCount);
    const afterNotices = height - noticeCount;
    let headerCount = Math.min(header.length, afterNotices);
    let bodyHeight = afterNotices - headerCount;
    // Free one body row for overflow ellipsis by omitting the divider when height is tight.
    if (options.bodyLines.length > 0 && bodyHeight === 0 && afterNotices > 0) {
        headerCount = Math.min(header.length, Math.max(0, afterNotices - 1));
        bodyHeight = afterNotices - headerCount;
    }
    const reservedHeader = header.slice(0, headerCount);
    const clippedBody = clipOverflowLines(options.bodyLines, bodyHeight, width);
    const out = [...reservedHeader, ...clippedBody, ...reservedNotices];
    while (out.length < height) out.push("");
    return out.slice(0, height);
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
            this.#setStatus("warning", `Live preview is available only for live agents. Press ${actionHint(this.#keymap, "confirm")} for history.`);
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
                    `${node.handle} · ${actionHint(this.#deps.tmuxPreviewActions ?? {}, "cancel")} back · ${actionHint(this.#deps.tmuxPreviewActions ?? {}, "openFull")} open full`,
                    { bindings: this.#deps.tmuxPreviewActions },
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
        else if (action === "preview") void this.action("preview");
        else if (action === "unlink") void this.action("unlink");
        else return;
        this.invalidate();
        this.#tui.requestRender();
    }

    #nodeLine(node: SubagentDisplayNode, selected: boolean, connector: string, width: number): string {
        const badge = AGENT_STATE_BADGES[node.snapshot.status.state];
        const expand = node.children.length > 0 ? (this.#collapsed.has(node.agentId) ? "▸ " : "▾ ") : "  ";
        const marker = selected ? "> " : "  ";
        const handle = dimIf(this.#theme, node.ghost, this.#theme.bold(node.handle));
        const profile = dimIf(this.#theme, node.ghost, this.#theme.fg(profileColorRole(node.snapshot.agent.profile), node.snapshot.agent.profile));
        const stateText = this.#theme.fg(badge.role, formatStateBadge(node.snapshot.status.state));
        const purpose = dimIf(this.#theme, node.ghost, this.#theme.fg("muted", node.snapshot.agent.purpose));
        const lineRaw = composeAgentRow({
            width,
            marker,
            connector,
            expand,
            handle,
            profile,
            state: stateText,
            purpose,
        });
        // Selected background must cover the full padded left-list row, not only the text remnant.
        const padded = padToWidth(truncateToWidth(lineRaw, width, ""), width);
        if (!selected) return padded;
        return padToWidth(truncateToWidth(this.#theme.bg("selectedBg", padded), width, ""), width);
    }

    #listViewport(visible: readonly SubagentDisplayNode[], connectors: Map<string, string>, width: number, rows: number): string[] {
        if (visible.length === 0) {
            const lines = [padToWidth(truncateToWidth(this.#theme.fg("warning", " No agents for this origin session."), width, ""), width)];
            while (lines.length < rows) lines.push(padToWidth("", width));
            return lines.slice(0, rows);
        }
        const flat = visible.map(node => this.#nodeLine(node, node.agentId === this.#selectedAgentId, connectors.get(node.agentId) ?? "", width));
        const selectedIndex = Math.max(0, visible.findIndex(node => node.agentId === this.#selectedAgentId));
        let start = selectedIndex - Math.floor(Math.max(0, rows - 1) / 2);
        start = Math.max(0, Math.min(start, Math.max(0, flat.length - rows)));
        if (selectedIndex >= start + rows) start = selectedIndex - rows + 1;
        const lines = flat.slice(start, start + rows);
        while (lines.length < rows) lines.push(padToWidth("", width));
        return lines.slice(0, rows);
    }

    #detailLines(width: number, height: number): string[] {
        const model = detailPaneModel(this.selected());
        const noticeLines = model.notices.map(notice => this.#theme.fg(notice.role, notice.text));
        if (model.body.length === 0 && model.notices.length === 1 && model.title === "Detail") {
            return composeDetailSections({
                width,
                height,
                headerLines: [],
                bodyLines: [],
                noticeLines,
            });
        }
        const badge = model.badgeState
            ? ` ${this.#theme.fg(TASK_STATE_BADGES[model.badgeState].role, formatTaskStateBadge(model.badgeState))}`
            : "";
        const headerLines = [
            `${this.#theme.fg(model.role, model.title)}${badge}`,
            this.#theme.fg(model.role, "─".repeat(Math.max(1, width))),
        ];
        const bodyLines = isNonblank(model.body)
            ? wrapTextWithAnsi(normalizeNewlines(model.body), Math.max(1, width))
            : [];
        return composeDetailSections({
            width,
            height,
            headerLines,
            bodyLines,
            noticeLines,
        });
    }

    #viewport(visible: readonly SubagentDisplayNode[], connectors: Map<string, string>, width: number, viewportRows: number): string[] {
        const rows = Math.max(1, viewportRows);
        const columns = splitPaletteColumns(width);
        const list = this.#listViewport(visible, connectors, columns.listWidth, rows);
        if (columns.detailWidth === undefined) {
            return list.map(line => truncateToWidth(line, width, ""));
        }
        const detail = this.#detailLines(columns.detailWidth, rows);
        const divider = " │ ";
        return list.map((left, index) => {
            const right = padToWidth(detail[index] ?? "", columns.detailWidth!);
            return truncateToWidth(`${left}${divider}${right}`, width, "");
        });
    }

    render(width: number): string[] {
        const w = Math.max(1, width);
        if (this.#cachedLines && this.#cachedWidth === w) return this.#cachedLines;
        const rows = Math.max(10, Math.min(22, Math.floor(this.#tui.terminal.rows * 0.7)));
        const inner = Math.max(1, w - 2);
        const visible = this.visibleNodes();
        const connectors = treeConnectors(visible, this.#tree.byId);
        const help = paletteHelp(this.#keymap, ["moveUp", "moveDown", "collapse", "expand", "confirm", "stop", "refresh", "preview", "unlink", "cancel"]);
        const confirmHint = actionHint(this.#keymap, "confirm");
        const terminalPreviewMessage = `Live preview is available only for live agents. Press ${confirmHint} for history.`;
        const statusLines = !this.#acting && this.#status === terminalPreviewMessage
            ? ["Live preview is available only for live agents.", `Press ${confirmHint} for history.`]
            : [this.#acting ? "WORKING" : this.#status];
        const body: string[] = [
            truncateToWidth(` ${this.#theme.fg("muted", `${paletteHelp(this.#keymap, ["confirm", "preview", "unlink"])} · Stop ends a live agent`)}`, inner, ""),
            "",
            ...this.#viewport(visible, connectors, inner, Math.max(2, rows - 5 - statusLines.length)),
            ...statusLines.map(line => truncateToWidth(` ${this.#theme.fg(this.#statusKind, line)}`, inner, "")),
            truncateToWidth(` ${this.#theme.fg("dim", help)}`, inner, ""),
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
