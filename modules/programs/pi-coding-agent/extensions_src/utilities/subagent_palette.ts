import { copyToClipboard, type ExtensionContext, type ExtensionUIContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Input, truncateToWidth, wrapTextWithAnsi, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { paletteHelp, paletteKeyAction, type ResolvedPaletteKeymap } from "./command_palette_keymap.ts";
import { OriginRunDiscovery, stopSubagentRun, type ManagedSubagentRun } from "./subagent_management.ts";
import { probeTmux, type CommandExecutor } from "./subagent_tmux.ts";
import { launchReplayWindow } from "./subagent_replay.ts";
import { isTerminalState } from "./subagent_types.ts";

export interface SubagentPaletteDependencies {
    stateRoot: string;
    originSessionId: string;
    exec: CommandExecutor;
    env?: NodeJS.ProcessEnv;
    copy?: (text: string) => Promise<void>;
    setTimeout?: typeof globalThis.setTimeout;
    clearTimeout?: typeof globalThis.clearTimeout;
    now?: () => number;
    configPath?: string;
    node?: string;
    viewer?: string;
    cwd?: string;
}

type Status = { kind: "success" | "warning" | "error"; text: string; runId?: string };

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function age(run: ManagedSubagentRun, now: number): string {
    const start = Date.parse(run.snapshot.startedAt ?? run.snapshot.createdAt);
    const end = Date.parse(run.snapshot.finishedAt ?? "") || now;
    const seconds = Math.max(0, Math.floor((end - start) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60); return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function shortIds(runs: readonly ManagedSubagentRun[]): Map<string, string> {
    const result = new Map<string, string>();
    for (const run of runs) {
        let length = 8;
        while (length < run.snapshot.runId.length && runs.some(other => other !== run && other.snapshot.runId.slice(0, length) === run.snapshot.runId.slice(0, length))) length += 1;
        result.set(run.snapshot.runId, run.snapshot.runId.slice(0, length));
    }
    return result;
}
function filterRuns(runs: readonly ManagedSubagentRun[], query: string): ManagedSubagentRun[] {
    const terms = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
    return terms.length === 0 ? [...runs] : runs.filter(run => {
        const text = `${run.snapshot.purpose} ${run.snapshot.profile} ${run.snapshot.status} ${run.snapshot.runId}`.toLowerCase();
        return terms.every(term => text.includes(term));
    });
}
function formatUsage(run: ManagedSubagentRun): string {
    const usage = run.snapshot.result?.usage;
    return usage ? `${usage.totalTokens.toLocaleString()} tokens; cost $${usage.cost.total.toFixed(4)}` : "not available";
}
function previewLines(run: ManagedSubagentRun): string[] {
    const source = run.snapshot.result?.error
        ? `${run.snapshot.result.error.category}: ${run.snapshot.result.error.message}${run.snapshot.result.error.exitCode === undefined ? "" : ` (exit ${run.snapshot.result.error.exitCode})`}`
        : run.snapshot.result?.output ?? "No terminal output yet.";
    const bytes = Buffer.byteLength(source, "utf8");
    const bounded = Buffer.from(source, "utf8").subarray(0, 8192).toString("utf8");
    const lines = bounded.split(/\r?\n/u).slice(0, 12);
    if (bytes > 8192 || bounded.split(/\r?\n/u).length > 12) lines.push(`… preview truncated; full content remains at ${run.snapshot.paths.result}`);
    return lines;
}

export class SubagentPaletteComponent implements Component, Focusable {
    readonly #tui: Pick<TUI, "requestRender" | "terminal">;
    readonly #theme: Theme;
    readonly #ui: Pick<ExtensionUIContext, "confirm">;
    readonly #keymap: ResolvedPaletteKeymap;
    readonly #deps: SubagentPaletteDependencies;
    readonly #discovery: OriginRunDiscovery;
    readonly #input = new Input();
    readonly #done: (value: null) => void;
    #runs: ManagedSubagentRun[] = [];
    #selectedId?: string;
    #selectedIndex = 0;
    #selectionRevision = 0;
    #mode: "list" | "detail" = "list";
    #detailMissing = false;
    #detailScroll = 0;
    #status?: Status;
    #malformedCount = 0;
    #refreshing = false;
    #refreshQueued = false;
    #refreshQueuedManual = false;
    #disposed = false;
    #timer?: ReturnType<typeof globalThis.setTimeout>;
    #pending = new Set<string>();
    #focused = false;
    #cachedWidth?: number;
    #cachedLines?: string[];

    constructor(options: { tui: TUI; theme: Theme; ui: Pick<ExtensionUIContext, "confirm">; keymap: ResolvedPaletteKeymap; deps: SubagentPaletteDependencies; done: (value: null) => void }) {
        this.#tui = options.tui; this.#theme = options.theme; this.#ui = options.ui; this.#keymap = options.keymap; this.#deps = options.deps; this.#done = options.done;
        this.#discovery = new OriginRunDiscovery(options.deps);
    }
    get focused(): boolean { return this.#focused; }
    set focused(value: boolean) { this.#focused = value; this.#input.focused = value; }
    get query(): string { return this.#input.getValue(); }
    get mode(): "list" | "detail" { return this.#mode; }
    get selectedRunId(): string | undefined { return this.#selectedId; }
    invalidate(): void { this.#cachedWidth = undefined; this.#cachedLines = undefined; this.#input.invalidate(); }
    #render(): void { if (this.#disposed) return; this.invalidate(); this.#tui.requestRender(); }
    start(): void { void this.refresh(); }
    dispose(): void { this.#disposed = true; if (this.#timer !== undefined) (this.#deps.clearTimeout ?? clearTimeout)(this.#timer); this.#timer = undefined; this.#input.focused = false; }
    close(): void { if (this.#disposed) return; this.dispose(); this.#done(null); }
    #filtered(): ManagedSubagentRun[] { return filterRuns(this.#runs, this.query); }
    #selected(): ManagedSubagentRun | undefined { return this.#runs.find(run => run.snapshot.runId === this.#selectedId); }
    #normalizeSelection(previousIndex = this.#selectedIndex): void {
        const filtered = this.#filtered();
        const stable = filtered.findIndex(run => run.snapshot.runId === this.#selectedId);
        this.#selectedIndex = stable >= 0 ? stable : Math.min(previousIndex, Math.max(0, filtered.length - 1));
        this.#selectedId = filtered[this.#selectedIndex]?.snapshot.runId;
    }
    async refresh(manual = false): Promise<void> {
        if (this.#disposed) return;
        if (this.#refreshing) { this.#refreshQueued = true; this.#refreshQueuedManual ||= manual; return; }
        if (this.#timer !== undefined) (this.#deps.clearTimeout ?? clearTimeout)(this.#timer);
        this.#timer = undefined; this.#refreshing = true;
        const target = this.#selectedId; const previousIndex = this.#selectedIndex; const selectionRevision = this.#selectionRevision; const statusAtStart = this.#status;
        try {
            const refreshed = await this.#discovery.refresh();
            if (this.#disposed) return;
            const selectionChanged = this.#selectionRevision !== selectionRevision;
            const desiredId = selectionChanged ? this.#selectedId : target;
            const desiredIndex = selectionChanged ? this.#selectedIndex : previousIndex;
            this.#runs = refreshed.runs; this.#malformedCount = refreshed.malformedCount;
            this.#selectedId = desiredId; this.#normalizeSelection(desiredIndex);
            if (this.#mode === "detail" && desiredId && !this.#runs.some(run => run.snapshot.runId === desiredId)) { this.#selectedId = desiredId; this.#detailMissing = true; }
            else this.#detailMissing = false;
            if (manual && this.#status === statusAtStart) this.#status = { kind: "success", text: "Runs refreshed." };
        } catch (error) {
            if (!this.#disposed && this.#status === statusAtStart) this.#status = { kind: "error", text: `Refresh failed: ${message(error)}` };
        } finally {
            this.#refreshing = false;
            if (!this.#disposed) {
                this.#render();
                if (this.#refreshQueued) {
                    const queuedManual = this.#refreshQueuedManual; this.#refreshQueued = false; this.#refreshQueuedManual = false; void this.refresh(queuedManual);
                }
                else this.#timer = (this.#deps.setTimeout ?? setTimeout)(() => { this.#timer = undefined; void this.refresh(); }, 1000);
            }
        }
    }
    #move(delta: number): void {
        const filtered = this.#filtered(); if (filtered.length === 0) return;
        this.#selectedIndex = (this.#selectedIndex + delta + filtered.length) % filtered.length;
        this.#selectedId = filtered[this.#selectedIndex]?.snapshot.runId; this.#selectionRevision += 1; this.#status = undefined; this.#render();
    }
    async #act(action: "copy" | "stop" | "replay"): Promise<void> {
        const run = this.#selected();
        if (!run) { this.#status = { kind: "warning", text: "Run is no longer available." }; this.#render(); return; }
        const runId = run.snapshot.runId; const token = action;
        if (this.#pending.has(token)) return;
        if (action === "stop" && (run.snapshot.status === "stopping" || isTerminalState(run.snapshot.status))) {
            this.#status = { kind: "warning", text: `Stop disabled: run is ${run.snapshot.status}.`, runId }; this.#render(); return;
        }
        this.#pending.add(token); this.#status = { kind: "warning", text: `${action} in progress…`, runId }; this.#render();
        try {
            if (action === "copy") {
                await (this.#deps.copy ?? copyToClipboard)(runId);
                this.#status = { kind: "success", text: `Copied run ID ${runId}.`, runId };
            } else if (action === "stop") {
                const confirmed = await this.#ui.confirm(`Stop ${run.snapshot.purpose} (${runId.slice(0, 8)})?`, "The target run will stop. Immediate child runs will continue and are not stopped recursively.");
                if (!confirmed) this.#status = { kind: "warning", text: "Stop cancelled.", runId };
                else {
                    const stopped = await stopSubagentRun({ ...this.#deps, runId });
                    this.#selectedId = runId; await this.refresh();
                    this.#status = { kind: "success", text: `Stopped; ${stopped.continuingChildCount} immediate child run(s) continue.`, runId };
                }
            } else {
                const context = await probeTmux(this.#deps.exec, this.#deps.env ?? process.env);
                if (!context) throw new Error("Replay unavailable: current Pi process is not attached to a usable tmux client");
                if (!this.#deps.configPath || !this.#deps.node || !this.#deps.viewer) throw new Error("Replay viewer runtime is not configured");
                await launchReplayWindow(this.#deps.exec, context, { stateRoot: this.#deps.stateRoot, runId, cwd: this.#deps.cwd ?? process.cwd(), node: this.#deps.node, viewer: this.#deps.viewer, configPath: this.#deps.configPath });
                this.close(); return;
            }
        } catch (error) { this.#status = { kind: "error", text: `${action} failed: ${message(error)}`, runId }; }
        finally { this.#pending.delete(token); this.#render(); }
    }
    handleInput(data: string): void {
        if (this.#disposed) return;
        const action = paletteKeyAction(data, this.#keymap);
        if (action === "cancel") { if (this.#mode === "detail") { this.#mode = "list"; this.#detailMissing = false; this.#render(); } else this.close(); return; }
        if (action === "refresh") { void this.refresh(true); return; }
        if (action === "stop") { void this.#act("stop"); return; }
        if (action === "copyRunId") { void this.#act("copy"); return; }
        if (this.#mode === "detail") {
            if (action === "moveUp") { this.#detailScroll = Math.max(0, this.#detailScroll - 1); this.#render(); }
            else if (action === "moveDown") { this.#detailScroll += 1; this.#render(); }
            return;
        }
        if (action === "moveUp") { this.#move(-1); return; }
        if (action === "moveDown") { this.#move(1); return; }
        if (action === "confirm") { if (this.#selected()) void this.#act("replay"); return; }
        const previous = this.query; this.#input.handleInput(data);
        if (this.query !== previous) { this.#selectedIndex = 0; this.#selectedId = this.#filtered()[0]?.snapshot.runId; this.#selectionRevision += 1; this.#status = undefined; this.#render(); }
    }
    #listLines(width: number, rows: number): string[] {
        const filtered = this.#filtered(); const ids = shortIds(this.#runs); const blocks: string[][] = [];
        for (let index = 0; index < filtered.length; index += 1) {
            const run = filtered[index]!; const selected = index === this.#selectedIndex; const marker = selected ? "> " : "  ";
            const text = `${marker}${run.snapshot.purpose} — ${run.snapshot.profile} — ${run.snapshot.status} — ${ids.get(run.snapshot.runId)} — ${age(run, (this.#deps.now ?? Date.now)())}`;
            const styled = this.#theme.fg(selected ? "accent" : isTerminalState(run.snapshot.status) ? "muted" : "text", selected ? this.#theme.bold(text) : text);
            blocks.push(wrapTextWithAnsi(styled, width).map(line => selected ? this.#theme.bg("selectedBg", line) : line));
        }
        if (blocks.length === 0) blocks.push([this.#theme.fg("warning", this.query ? "No matching runs." : "No runs for this origin session.")]);
        const flat = blocks.flat();
        const selectedStart = blocks.slice(0, this.#selectedIndex).reduce((sum, block) => sum + block.length, 0);
        let start = Math.max(0, Math.min(selectedStart - Math.floor(rows / 2), Math.max(0, flat.length - rows)));
        const lines = flat.slice(start, start + rows); while (lines.length < rows) lines.push(""); return lines;
    }
    #detailLines(): string[] {
        const run = this.#selected();
        if (!run || this.#detailMissing) return ["Run is no longer available. Press Escape to return to the list."];
        const request = run.request; const snapshot = run.snapshot; const result = snapshot.result;
        return [
            `Run ID: ${snapshot.runId}`, `Purpose: ${snapshot.purpose}`, `Profile: ${snapshot.profile}`, `Status: ${snapshot.status}`,
            `Caller profile: ${request.callerProfile}`, `Target profile: ${request.targetProfile}`, `Depth: ${request.depth}`, `Parent run ID: ${request.parentRunId ?? "none"}`,
            `Created: ${snapshot.createdAt}`, `Started: ${snapshot.startedAt ?? "not started"}`, `Finished: ${snapshot.finishedAt ?? "not finished"}`, `Duration: ${age(run, (this.#deps.now ?? Date.now)())}`,
            `Tmux: ${snapshot.tmux ? `${snapshot.tmux.session}:${snapshot.tmux.windowName} (${snapshot.tmux.windowId}, ${snapshot.tmux.paneId})` : "not available"}`,
            `Outcome: ${result?.outcome ?? "pending"}`, `Turns: ${result?.turns ?? "not available"}`, `Usage: ${formatUsage(run)}`,
            "Output preview:", ...previewLines(run).map(line => `  ${line}`),
            `Run directory: ${snapshot.runDirectory}`, `Events: ${snapshot.paths.events}`, `Stderr: ${snapshot.paths.stderr}`, `Result: ${snapshot.paths.result}`,
        ];
    }
    render(width: number): string[] {
        const w = Math.max(1, width); if (this.#cachedLines && this.#cachedWidth === w) return this.#cachedLines;
        const totalRows = Math.max(12, Math.min(24, Math.floor(this.#tui.terminal.rows * 0.75)));
        const lines = [this.#theme.fg("border", "─".repeat(w)), truncateToWidth(` ${this.#theme.fg("accent", this.#theme.bold(this.#mode === "list" ? "Subagents" : "Subagent Detail"))}`, w, "")];
        if (this.#mode === "list") {
            lines.push(truncateToWidth(` ${this.#theme.fg("muted", "Search:")}`, w, ""));
            lines.push(truncateToWidth(`  ${this.#input.render(Math.max(1, w - 2))[0] ?? ""}`, w, "")); lines.push("");
            lines.push(...this.#listLines(w, Math.max(1, totalRows - 9)));
        } else {
            const detail = this.#detailLines().flatMap(line => wrapTextWithAnsi(line, w)); const viewport = Math.max(1, totalRows - 6);
            this.#detailScroll = Math.min(this.#detailScroll, Math.max(0, detail.length - viewport));
            lines.push(...detail.slice(this.#detailScroll, this.#detailScroll + viewport));
            while (lines.length < totalRows - 3) lines.push("");
        }
        const warning = this.#malformedCount > 0 ? `${this.#malformedCount} malformed/incomplete run(s); retrying. ` : "";
        const visibleStatus = this.#status?.runId && this.#status.runId !== this.#selectedId ? undefined : this.#status;
        const status = warning + (visibleStatus ? `${visibleStatus.kind === "error" ? "Error" : "Status"}: ${visibleStatus.text}` : this.#refreshing ? "Refreshing…" : `${this.#filtered().length} run(s)`);
        lines.push(truncateToWidth(` ${this.#theme.fg(visibleStatus?.kind ?? (warning ? "warning" : "dim"), status)}`, w, ""));
        const selected = this.#selected();
        const helpActions: Array<"moveUp" | "moveDown" | "confirm" | "cancel" | "refresh" | "stop" | "copyRunId"> = this.#mode === "detail"
            ? ["moveUp", "moveDown", "cancel", "refresh"]
            : ["moveUp", "moveDown", "confirm", "cancel", "refresh"];
        if (selected && selected.snapshot.status !== "stopping" && !isTerminalState(selected.snapshot.status)) helpActions.push("stop");
        if (selected) helpActions.push("copyRunId");
        lines.push(truncateToWidth(` ${this.#theme.fg("dim", paletteHelp(this.#keymap, helpActions))}`, w, ""));
        lines.push(this.#theme.fg("border", "─".repeat(w)));
        this.#cachedLines = lines.map(line => truncateToWidth(line, w, "")); this.#cachedWidth = w; return this.#cachedLines;
    }
}

export async function openSubagentPalette(ctx: ExtensionContext, keymap: ResolvedPaletteKeymap, deps: SubagentPaletteDependencies, onComponent?: (component: SubagentPaletteComponent) => void): Promise<void> {
    if (ctx.mode !== "tui") { ctx.ui.notify("Subagent management requires TUI mode", "warning"); return; }
    await ctx.ui.custom<null>((tui, theme, _bindings, done) => {
        const component = new SubagentPaletteComponent({ tui, theme, ui: ctx.ui, keymap, deps, done });
        onComponent?.(component); component.start(); return component;
    }, { overlay: true, overlayOptions: { anchor: "center", width: "70%", minWidth: 60, maxHeight: "80%", margin: 1 } });
}
