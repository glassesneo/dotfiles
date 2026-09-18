import { type ExtensionUIContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import type { CommandPaletteDisposition } from "./command_palette_contributions.ts";
import { paletteHelp, paletteKeyAction, type ResolvedPaletteKeymap } from "./command_palette_keymap.ts";
import { actionHint } from "./extension_keybindings.ts";
import { formatPaletteBreadcrumb, renderFramedLines } from "./command_palette_tui.ts";
import { historyAvailability, openMeshHistory } from "./orchestration_history.ts";
import { displayIdentityForSnapshot, formatUsualStatus, publicCapabilityLabel } from "./orchestration_identity.ts";
import {
    AGENT_STATE_BADGES,
    buildMeshDisplayTree,
    flattenVisibleDisplayNodes,
    formatStateBadge,
    formatTaskStateBadge,
    retainSelection,
    TASK_STATE_BADGES,
    treeConnectors,
    type MeshDisplayNode,
    type MeshDisplayTree,
} from "./orchestration_display_tree.ts";
import { openLivePreview, type LivePreviewDisposition } from "./orchestration_preview.ts";
import { openAgentWindow, probeTmux, unlinkAgentWindow, type CommandExecutor } from "./orchestration_tmux.ts";
import { isTerminalAgent, isTerminalTask, type AgentSnapshot, type TaskSnapshot, type TaskState } from "./orchestration_types.ts";
import { formatMeshChildUsageLine, projectMeshChildUsage } from "./orchestration_usage.ts";

export interface MeshIdentity {
    meshId: string;
}

export interface MeshPaletteDependencies extends MeshIdentity {
    exec: CommandExecutor;
    tmux: string;
    historyViewerExtension: string;
    piCommand: string;
    natureHandleWords: readonly string[];
    tmuxPreviewActions?: Record<string, readonly string[]>;
    env?: NodeJS.ProcessEnv;
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
    /** Mesh-wide data and authority boundaries supplied by the orchestration owner. */
    discover: (identity: MeshIdentity) => Promise<{ agents: AgentSnapshot[]; malformedCount: number; tasks?: readonly TaskSnapshot[] }>;
    stopAgent: (request: MeshIdentity & { agentId: string; reason?: string }) => Promise<AgentSnapshot>;
    controlAgent?: (request: MeshIdentity & { agentId: string; action: "pause" | "interrupt" | "resume" }) => Promise<{ targets: Array<{ agentId: string; status: string; phase: string }> }>;
    openChildHistory?: (snapshot: AgentSnapshot) => Promise<void>;
    /** Optional test/harness overrides for open paths. */
    openHistory?: typeof openMeshHistory;
    openLiveWindow?: typeof openAgentWindow;
    previewLive?: (exec: CommandExecutor, tmux: string, context: NonNullable<Awaited<ReturnType<typeof probeTmux>>>, target: AgentSnapshot["agent"]["tmux"], title: string, seams?: Parameters<typeof openLivePreview>[5]) => Promise<LivePreviewDisposition>;
}

export type MeshPaletteResult = CommandPaletteDisposition;

/** Framed-body inner width at which the selected-agent detail pane appears. */
export const DETAIL_BREAKPOINT = 100;

export type DetailSemanticRole = Extract<ThemeColor, "accent" | "success" | "error" | "warning" | "muted">;

export interface DetailPaneModel {
    role: DetailSemanticRole;
    title: string;
    badgeState?: TaskState;
    identityLines: readonly string[];
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

/** Width-aware identity line. Handle and textual state stay ahead of capability and purpose. */
export function composeIdentityLine(options: {
    width: number;
    marker: string;
    connector: string;
    expand: string;
    handle: string;
    capability: string;
    purpose: string;
    state: string;
}): string {
    const prefixes = [
        `${options.marker}${options.connector}${options.expand}${options.handle} ${options.capability} ${options.purpose}`,
        `${options.marker}${options.expand}${options.handle} ${options.capability} ${options.purpose}`,
        `${options.marker}${options.expand}${options.handle} ${options.capability}`,
        `${options.marker}${options.expand}${options.handle}`,
    ];
    for (const prefix of prefixes) {
        const line = `${prefix} ${options.state}`;
        if (visibleWidth(line) <= options.width) return line;
    }
    const prefix = `${options.marker}${options.expand}`;
    const state = ` ${options.state}`;
    const handleBudget = options.width - visibleWidth(prefix) - visibleWidth(state);
    if (handleBudget >= 1) return `${prefix}${truncateToWidth(options.handle, handleBudget, "…")}${state}`;
    return truncateToWidth(`${prefix}${truncateToWidth(options.handle, 1, "")}${state}`, options.width, "");
}

/** One-row agent line, dropping purpose then capability before handle and state. */
export function composeAgentRow(options: {
    width: number;
    marker: string;
    connector: string;
    expand: string;
    handle: string;
    capability: string;
    purpose: string;
    state: string;
}): string {
    const identity = `${options.marker}${options.connector}${options.expand}${options.handle} ${options.capability}`;
    const candidates = [
        `${identity} ${options.purpose} ${options.state}`,
        `${identity} ${options.state}`,
        `${options.marker}${options.connector}${options.expand}${options.handle} ${options.state}`,
    ];
    for (const candidate of candidates) if (visibleWidth(candidate) <= options.width) return candidate;
    const purposeBudget = options.width - visibleWidth(`${identity}  ${options.state}`);
    if (purposeBudget >= 2) return truncateToWidth(`${identity} ${truncateToWidth(options.purpose, purposeBudget, "…")} ${options.state}`, options.width, "");
    return composeIdentityLine(options);
}

/** Split framed-body inner width into list and optional detail columns. */
export function splitPaletteColumns(innerWidth: number): { listWidth: number; detailWidth?: number } {
    const width = Math.max(1, innerWidth);
    if (width < DETAIL_BREAKPOINT) return { listWidth: width };
    const listWidth = Math.min(52, Math.max(36, Math.round(width * 0.4)));
    return { listWidth, detailWidth: Math.max(1, width - listWidth - 3) };
}

function lifecycleNotices(snapshot: AgentSnapshot): Array<{ text: string; role: DetailSemanticRole }> {
    const acceptance = snapshot.activity.acceptingTask ? "accepting tasks" : "not accepting tasks";
    const values: Array<{ text: string; role: DetailSemanticRole }> = [{ text: `Lifecycle ${snapshot.status.state} · activity ${snapshot.activity.phase} · ${acceptance} · context ${snapshot.activity.context.health}`, role: snapshot.activity.acceptingTask ? "success" : "muted" }];
    if (snapshot.stop) values.push({ text: `Stop ${snapshot.stop.state} · ${snapshot.stop.source} · ${snapshot.stop.reason}`, role: snapshot.stop.state === "failed" ? "error" : snapshot.stop.state === "confirmed" ? "warning" : "muted" });
    return values;
}

/** Derive detail-pane content from the selected snapshot. */
export function detailPaneModel(snapshot: AgentSnapshot | undefined, words?: readonly string[]): DetailPaneModel {
    if (!snapshot) {
        return { role: "muted", title: "Detail", identityLines: [], body: "", notices: [{ text: "No agent selected.", role: "muted" }] };
    }
    const identity = displayIdentityForSnapshot(snapshot, words);
    const capability = publicCapabilityLabel(identity) ?? "unavailable";
    const identityLines = [
        `Handle ${identity.handle}`,
        capability,
        identity.purpose ? `purpose ${identity.purpose}` : "No task",
        formatUsualStatus(identity.status) ?? "Status unknown",
        ...(identity.description ? [identity.description] : []),
        `ID ${identity.agentId}`,
        ...(identity.attempts ?? []).map(attempt => `attempt #${attempt.index} ${attempt.model} ${attempt.category}${attempt.message ? `: ${attempt.message}` : ""}`),
        `thinking ${identity.thinkingLevel ?? "unavailable"} · harness ${identity.harness ?? "unavailable"} · model ${identity.model ?? "unavailable"} · fallback ${identity.fallbackCount ?? 0}`,
        ...(snapshot.task?.result ? [snapshot.agent.capabilities.usage ? `Child usage ${snapshot.task.result.usage.totalTokens} tokens (mesh, separate from Pi totals)` : "Child usage unknown"] : []),
    ];
    const task = snapshot.task;
    if (!task) {
        return {
            role: "accent",
            title: "Agent",
            identityLines,
            body: [identity.description, snapshot.agent.definitionSnapshot.instructions].filter(isNonblank).join("\n\n"),
            notices: [{ text: "No task record", role: "muted" }, ...lifecycleNotices(snapshot)],
        };
    }
    if (!isTerminalTask(task.status.state)) {
        return {
            role: "accent",
            title: "Instruction",
            badgeState: task.status.state,
            identityLines,
            body: task.request.prompt,
            notices: lifecycleNotices(snapshot),
        };
    }
    if (task.result) {
        const role: DetailSemanticRole = task.status.state === "succeeded" ? "success" : task.status.state === "failed" ? "error" : "warning";
        if (isNonblank(task.result.output)) {
            return { role, title: "Answer", badgeState: task.status.state, identityLines, body: task.result.output, notices: lifecycleNotices(snapshot) };
        }
        if (isNonblank(task.result.error)) {
            return { role, title: "Answer", badgeState: task.status.state, identityLines, body: task.result.error, notices: lifecycleNotices(snapshot) };
        }
        return {
            role,
            title: "Answer",
            badgeState: task.status.state,
            identityLines,
            body: "",
            notices: [{ text: "No answer text was recorded.", role: "muted" }, ...lifecycleNotices(snapshot)],
        };
    }
    return {
        role: "warning",
        title: "Answer",
        badgeState: task.status.state,
        identityLines,
        body: task.request.prompt,
        notices: [{ text: "Answer not recorded", role: "warning" }, ...lifecycleNotices(snapshot)],
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

type PaletteRow = { id: string; kind: "agent"; node: MeshDisplayNode; connector: string };

function agentRowId(agentId: string): string { return `agent:${agentId}`; }

export class MeshAgentsPaletteComponent implements Component, Focusable {
    readonly #tui: TUI;
    readonly #theme: Theme;
    readonly #ui: Pick<ExtensionUIContext, "input" | "confirm"> & Partial<Pick<ExtensionUIContext, "select">>;
    readonly #keymap: ResolvedPaletteKeymap;
    readonly #deps: MeshPaletteDependencies;
    readonly #done: (value: MeshPaletteResult) => void;
    #tree: MeshDisplayTree = { roots: [], byId: new Map(), handles: new Map() };
    #inventory: AgentSnapshot[] = [];
    #tasks: TaskSnapshot[] = [];
    #showTerminal = false;
    #malformedCount = 0;
    #collapsed = new Set<string>();
    #selectedRowId?: string;
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
    #closeDisposition: MeshPaletteResult = "return";
    #cachedWidth?: number;
    #cachedLines?: string[];

    constructor(options: {
        tui: TUI;
        theme: Theme;
        ui: Pick<ExtensionUIContext, "input" | "confirm"> & Partial<Pick<ExtensionUIContext, "select">>;
        keymap: ResolvedPaletteKeymap;
        deps: MeshPaletteDependencies;
        done: (value: MeshPaletteResult) => void;
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
    get selectedRowId() { return this.#selectedRowId; }
    get collapsedIds() { return new Set(this.#collapsed); }
    get showTerminal() { return this.#showTerminal; }
    get hiddenTerminalCount() { return this.#inventory.filter(agent => isTerminalAgent(agent.status.state)).length; }
    get acting() { return this.#acting; }
    selected(): AgentSnapshot | undefined {
        return this.#selectedAgentId ? this.#tree.byId.get(this.#selectedAgentId)?.snapshot : undefined;
    }
    visibleNodes(): MeshDisplayNode[] {
        return flattenVisibleDisplayNodes(this.#tree.roots, this.#collapsed);
    }
    #rows(): PaletteRow[] {
        const agents = this.visibleNodes();
        const connectors = treeConnectors(agents, this.#tree.byId);
        return agents.map(node => ({ id: agentRowId(node.agentId), kind: "agent", node, connector: connectors.get(node.agentId) ?? "" }));
    }
    #selectRow(row: PaletteRow | undefined): void {
        this.#selectedRowId = row?.id;
        this.#selectedAgentId = row?.node.agentId;
    }
    #selectAgent(agentId: string): void {
        this.#selectedRowId = agentRowId(agentId);
        this.#selectedAgentId = agentId;
    }
    #normalizeSelection(): void {
        const rows = this.#rows();
        const selected = rows.find(row => row.id === this.#selectedRowId);
        if (selected) { this.#selectRow(selected); return; }
        const agent = this.#selectedAgentId ? rows.find(row => row.node.agentId === this.#selectedAgentId) : undefined;
        this.#selectRow(agent ?? rows[0]);
    }
    /** Test/harness seam: replace the display tree without tmux reconciliation. */
    replaceAgents(agents: readonly AgentSnapshot[], malformedCount = 0): void {
        this.#applySnapshots(agents, malformedCount);
        this.invalidate();
        this.#tui.requestRender();
    }
    invalidate() { this.#cachedWidth = undefined; this.#cachedLines = undefined; }
    start() { void this.refresh(); }

    requestClose(): boolean {
        if (this.#acting) { this.#cancelRequested = true; return false; }
        return true;
    }

    close(disposition: MeshPaletteResult = this.#closeDisposition) {
        if (this.#disposed) return;
        this.#done(disposition);
    }

    dispose() {
        if (this.#disposed) return;
        this.#disposed = true;
        this.#focused = false;
        if (this.#timer) (this.#deps.clearTimeout ?? clearTimeout)(this.#timer);
        this.#timer = undefined;
    }

    #setStatus(kind: "success" | "error" | "warning" | "dim", text: string): void {
        this.#statusKind = kind;
        this.#status = text;
        this.invalidate();
        this.#tui.requestRender();
    }

    #applySnapshots(agents: readonly AgentSnapshot[], malformedCount: number, tasks?: readonly TaskSnapshot[]): void {
        const previousVisible = this.visibleNodes().map(node => node.agentId);
        this.#inventory = [...agents];
        this.#malformedCount = malformedCount;
        if (tasks) this.#tasks = [...tasks];
        this.#rebuildProjection(previousVisible);
    }

    #rebuildProjection(previousVisible = this.visibleNodes().map(node => node.agentId)): void {
        this.#tree = buildMeshDisplayTree(this.#inventory, this.#deps.natureHandleWords, { showTerminal: this.#showTerminal });
        const known = new Set(this.#tree.byId.keys());
        this.#collapsed = new Set([...this.#collapsed].filter(id => known.has(id) && (this.#tree.byId.get(id)?.children.length ?? 0) > 0));
        const visible = this.visibleNodes();
        const retained = retainSelection(this.#selectedAgentId, visible, previousVisible.length ? previousVisible : this.#previousVisibleIds);
        if (retained) this.#selectAgent(retained);
        else this.#normalizeSelection();
        this.#previousVisibleIds = visible.map(node => node.agentId);
        const liveCount = this.#inventory.length - this.hiddenTerminalCount;
        const history = this.#showTerminal ? "terminal history shown" : `${this.hiddenTerminalCount} terminal hidden`;
        const usage = formatMeshChildUsageLine(projectMeshChildUsage(this.#inventory, this.#tasks));
        this.#statusKind = this.#malformedCount ? "warning" : "dim";
        this.#status = this.#malformedCount ? `${this.#malformedCount} incomplete agent record(s) · ${liveCount} live · ${history} · ${usage}` : `${liveCount} live agent session(s) · ${history} · ${usage}`;
    }

    #toggleTerminal(): void {
        const previousVisible = this.visibleNodes().map(node => node.agentId);
        this.#showTerminal = !this.#showTerminal;
        this.#rebuildProjection(previousVisible);
    }

    /** Replace one agent in the full inventory without waiting on discovery. */
    #upsertSnapshot(snapshot: AgentSnapshot): void {
        const agents = [...this.#inventory];
        const index = agents.findIndex(agent => agent.agent.agentId === snapshot.agent.agentId);
        if (index >= 0) agents[index] = snapshot;
        else agents.push(snapshot);
        this.#applySnapshots(agents, this.#malformedCount);
        if (this.#tree.byId.has(snapshot.agent.agentId)) this.#selectAgent(snapshot.agent.agentId);
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
                    const found = await this.#deps.discover({ meshId: this.#deps.meshId });
                    if (this.#disposed) return false;
                    this.#applySnapshots(found.agents, found.malformedCount, found.tasks ?? []);
                    this.#normalizeSelection();
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
        const rows = this.#rows();
        if (rows.length === 0) return;
        const current = Math.max(0, rows.findIndex(row => row.id === this.#selectedRowId));
        const next = Math.max(0, Math.min(rows.length - 1, current + delta));
        this.#selectRow(rows[next]);
        this.invalidate();
        this.#tui.requestRender();
    }

    #collapse(): void {
        const selected = this.#rows().find(row => row.id === this.#selectedRowId);
        const node = selected?.node;
        if (!node) return;
        if (node.children.length > 0 && !this.#collapsed.has(node.agentId)) {
            this.#collapsed.add(node.agentId);
            this.invalidate(); this.#tui.requestRender(); return;
        }
        const parent = [...this.#tree.byId.values()].find(candidate => candidate.children.some(child => child.agentId === node.agentId));
        if (parent) { this.#selectAgent(parent.agentId); this.invalidate(); this.#tui.requestRender(); }
    }

    #expand(): void {
        const selected = this.#rows().find(row => row.id === this.#selectedRowId);
        if (!selected) return;
        const node = selected.node;
        if (node.children.length > 0 && this.#collapsed.has(node.agentId)) {
            this.#collapsed.delete(node.agentId);
            this.invalidate(); this.#tui.requestRender(); return;
        }
        if (node.children.length > 0 && node.children[0]) {
            this.#selectAgent(node.children[0].agentId);
            this.invalidate(); this.#tui.requestRender();
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
                const selection = selected.agent.agentId;
                const choice = this.#ui.select ? await this.#ui.select(`Control ${node.handle}`, ["Pause", "Interrupt", "Resume", "Stop"]) : "Stop";
                if (this.#tree.byId.has(selection)) this.#selectAgent(selection);
                if (!choice) {
                    if (this.#cancelRequested) { this.close("return"); return; }
                    this.#setStatus("dim", `Control cancelled for ${node.handle}`);
                    return;
                }
                if (choice === "Pause" || choice === "Interrupt" || choice === "Resume") {
                    if (!this.#deps.controlAgent) { this.#setStatus("warning", "Execution control is unavailable."); return; }
                    const result = await this.#deps.controlAgent({ meshId: this.#deps.meshId, agentId: selected.agent.agentId, action: choice.toLowerCase() as "pause" | "interrupt" | "resume" });
                    const unsupported = result.targets.filter(target => target.status === "unsupported").length;
                    const unconfirmed = result.targets.filter(target => target.status === "not_ready" || target.phase === "interrupting").length;
                    this.#setStatus(unsupported || unconfirmed ? "warning" : "success", `${choice} ${node.handle}${unsupported ? `; ${unsupported} unsupported` : ""}${unconfirmed ? `; ${unconfirmed} not confirmed` : ""}`);
                    await this.#reloadAfterMutation();
                    if (this.#cancelRequested) this.close("return");
                    return;
                }
                const confirmed = await this.#ui.confirm(`Stop ${node.handle}?`, "This kills the agent window and every linked view. Use Unlink to close only this view.");
                if (this.#tree.byId.has(selection)) this.#selectAgent(selection);
                if (!confirmed) {
                    if (this.#cancelRequested) { this.close("return"); return; }
                    this.#setStatus("dim", `Stop cancelled for ${node.handle}`);
                    return;
                }
                const stopped = await this.#deps.stopAgent({ meshId: this.#deps.meshId, agentId: selected.agent.agentId });
                // Apply Stop immediately, then reload. Re-assert after reload so a raced stale poll cannot revive the node.
                this.#upsertSnapshot(stopped);
                const refreshed = await this.#reloadAfterMutation();
                if (this.#disposed) return;
                this.#upsertSnapshot(stopped);
                const pending = stopped.status.state === "stopping" || stopped.stop?.state === "requested" || stopped.stop?.state === "terminating";
                if (pending) this.#setStatus("warning", `Stop pending for ${node.handle}; process termination is not yet confirmed`);
                else if (refreshed) this.#setStatus("success", `Stopped ${node.handle}`);
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
                    await (this.#deps.openHistory ?? openMeshHistory)(this.#deps.exec, this.#deps, context, selected);
                    // History is not live tmux Open: dismiss only the Mesh Agents palette and restore root.
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
                if (this.#tree.byId.has(selected.agent.agentId)) this.#selectAgent(selected.agent.agentId);
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

    async #openChildHistory(): Promise<void> {
        const selected = this.selected();
        if (!selected || this.#acting || this.#disposed) return;
        if (!this.#deps.openChildHistory) {
            this.#setStatus("warning", "Child history is unavailable in this session.");
            return;
        }
        const selection = selected.agent.agentId;
        this.#acting = true;
        this.#cancelRequested = false;
        this.#setStatus("warning", "WORKING");
        try {
            await this.#deps.openChildHistory(selected);
            if (this.#disposed) return;
            if (this.#tree.byId.has(selection)) this.#selectAgent(selection);
            this.#focused = true;
            this.#setStatus("dim", `History closed for ${displayIdentityForSnapshot(selected, this.#deps.natureHandleWords).handle}`);
            if (this.#cancelRequested) this.close("return");
        } catch (error) {
            if (this.#cancelRequested) { this.close("return"); return; }
            if (!this.#disposed) this.#setStatus("error", `history failed: ${error instanceof Error ? error.message : String(error)}`);
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
        else if (action === "toggleTerminal") this.#toggleTerminal();
        else if (action === "history") void this.#openChildHistory();
        else return;
        this.invalidate();
        this.#tui.requestRender();
    }

    #nodeLine(node: MeshDisplayNode, selected: boolean, connector: string, width: number): string {
        const badge = AGENT_STATE_BADGES[node.snapshot.status.state];
        const identity = displayIdentityForSnapshot(node.snapshot, this.#deps.natureHandleWords);
        const expand = node.children.length > 0 ? (this.#collapsed.has(node.agentId) ? "▸ " : "▾ ") : "  ";
        const marker = selected ? "> " : "  ";
        const handle = dimIf(this.#theme, node.ghost, this.#theme.bold(identity.handle));
        const lifecycle = this.#theme.fg(badge.role, formatUsualStatus(identity.status) ?? formatStateBadge(node.snapshot.status.state));
        const stateText = lifecycle;
        const purpose = dimIf(this.#theme, node.ghost, this.#theme.fg("muted", identity.purpose ?? "No task"));
        const lineRaw = composeAgentRow({
            width,
            marker,
            connector,
            expand,
            handle,
            capability: publicCapabilityLabel(identity) ?? "",
            purpose,
            state: stateText,
        });
        // Selected background must cover the full padded left-list row, not only the text remnant.
        const padded = padToWidth(truncateToWidth(lineRaw, width, ""), width);
        if (!selected) return padded;
        return padToWidth(truncateToWidth(this.#theme.bg("selectedBg", padded), width, ""), width);
    }

    #listViewport(allRows: readonly PaletteRow[], width: number, rows: number): string[] {
        if (allRows.length === 0) {
            const toggleHint = actionHint(this.#keymap, "toggleTerminal") || "the terminal-history key";
            const empty = this.hiddenTerminalCount > 0 && !this.#showTerminal
                ? ` No live agents. Press ${toggleHint} for terminal history.`
                : " No agents in this mesh.";
            const lines = [padToWidth(truncateToWidth(this.#theme.fg("warning", empty), width, ""), width)];
            while (lines.length < rows) lines.push(padToWidth("", width));
            return lines.slice(0, rows);
        }
        const flat = allRows.map(row => this.#nodeLine(row.node, row.id === this.#selectedRowId, row.connector, width));
        const selectedIndex = Math.max(0, allRows.findIndex(row => row.id === this.#selectedRowId));
        let start = selectedIndex - Math.floor(Math.max(0, rows - 1) / 2);
        start = Math.max(0, Math.min(start, Math.max(0, flat.length - rows)));
        if (selectedIndex >= start + rows) start = selectedIndex - rows + 1;
        const lines = flat.slice(start, start + rows);
        while (lines.length < rows) lines.push(padToWidth("", width));
        return lines.slice(0, rows);
    }

    #detailLines(width: number, height: number): string[] {
        const selectedRow = this.#rows().find(row => row.id === this.#selectedRowId);
        const model = detailPaneModel(selectedRow ? this.selected() : undefined, this.#deps.natureHandleWords);
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
            ...model.identityLines.map(line => this.#theme.fg("muted", line)),
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

    #viewport(allRows: readonly PaletteRow[], width: number, viewportRows: number): string[] {
        const rows = Math.max(1, viewportRows);
        const columns = splitPaletteColumns(width);
        if (columns.detailWidth === undefined) {
            const selected = this.selected();
            const identity = selected ? detailPaneModel(selected, this.#deps.natureHandleWords).identityLines : [];
            const detail = identity.slice(0, Math.min(4, Math.max(0, rows - 1))).map(line => padToWidth(this.#theme.fg("muted", line), width));
            const list = this.#listViewport(allRows, width, Math.max(1, rows - detail.length));
            return [...list, ...detail].map(line => truncateToWidth(line, width, ""));
        }
        const list = this.#listViewport(allRows, columns.listWidth, rows);
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
        const allRows = this.#rows();
        const help = paletteHelp(this.#keymap, ["moveUp", "moveDown", "collapse", "expand", "confirm", "stop", "refresh", "preview", "unlink", "history", "toggleTerminal", "cancel"]);
        const confirmHint = actionHint(this.#keymap, "confirm");
        const terminalPreviewMessage = `Live preview is available only for live agents. Press ${confirmHint} for history.`;
        const statusLines = !this.#acting && this.#status === terminalPreviewMessage
            ? ["Live preview is available only for live agents.", `Press ${confirmHint} for history.`]
            : [this.#acting ? "WORKING" : this.#status];
        const narrow = splitPaletteColumns(inner).detailWidth === undefined;
        const body: string[] = [
            ...(narrow ? [] : [truncateToWidth(` ${this.#theme.fg("muted", paletteHelp(this.#keymap, ["confirm", "preview", "unlink"]))}`, inner, ""), ""]),
            ...this.#viewport(allRows, inner, Math.max(2, rows - (narrow ? 3 : 5) - statusLines.length)),
            ...statusLines.map(line => truncateToWidth(` ${this.#theme.fg(this.#statusKind, line)}`, inner, "")),
            truncateToWidth(` ${this.#theme.fg("dim", help)}`, inner, ""),
        ];
        const lines = renderFramedLines({
            theme: this.#theme,
            width: w,
            title: formatPaletteBreadcrumb(["Command Palette", "Mesh Agents"]),
            body,
        });
        this.#cachedLines = lines.map(line => truncateToWidth(line, w, ""));
        this.#cachedWidth = w;
        return this.#cachedLines;
    }
}
