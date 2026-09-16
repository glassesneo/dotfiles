import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, stripTerminalSequences, truncateToWidth, wrapTextWithAnsi, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { paletteHelp, paletteKeyAction, type ResolvedPaletteKeymap } from "./command_palette_keymap.ts";
import { formatPaletteBreadcrumb, renderFramedLines } from "./command_palette_tui.ts";
import {
    HISTORY_FULL_PATH_HINT,
    listChildHistory,
    readChildHistoryBody,
    type ChildHistoryBodyRef,
    type ChildHistoryItem,
    type ChildHistoryList,
} from "./orchestration_history_read.ts";
import { displayIdentityForSnapshot, formatPartyLabel } from "./orchestration_identity.ts";
import type { AgentSnapshot } from "./orchestration_types.ts";

export interface ChildHistoryViewDependencies {
    stateRoot: string;
    meshId: string;
    natureHandleWords: readonly string[];
    listHistory?: typeof listChildHistory;
    readBody?: typeof readChildHistoryBody;
    openBody: (item: ChildHistoryItem) => Promise<void>;
}

function pad(text: string, width: number): string {
    return truncateToWidth(text, width, "");
}

function safeHistoryText(value: string): string {
    return stripTerminalSequences(value.replace(/\r\n|\r/gu, "\n"));
}

function overlayRows(terminalRows: number): number {
    const available = Math.max(1, terminalRows);
    // Stay below the host's 80% overlay cap even on short terminals.
    return Math.max(1, Math.min(22, Math.floor(available * 0.7)));
}

function historyHeaderLines(item: ChildHistoryItem, inner: number): string[] {
    const meta = [
        `${item.from.label} → ${item.to.label}`,
        item.kind,
        item.taskState,
        item.deliveryState,
        item.at,
    ].filter((part): part is string => Boolean(part)).join(" · ");
    const lines = wrapTextWithAnsi(safeHistoryText(meta), inner);
    if (item.purpose) lines.push(...wrapTextWithAnsi(safeHistoryText(item.purpose), inner));
    return lines;
}

export class ChildHistoryListComponent implements Component, Focusable {
    readonly #tui: TUI;
    readonly #theme: Theme;
    readonly #keymap: ResolvedPaletteKeymap;
    readonly #snapshot: AgentSnapshot;
    readonly #deps: ChildHistoryViewDependencies;
    readonly #done: (disposition?: "back" | "close-all") => void;
    #focused = false;
    #disposed = false;
    #opening = false;
    #status = "Loading…";
    #statusKind: "success" | "error" | "warning" | "dim" = "dim";
    #list: ChildHistoryList = { items: [], unavailableCount: 0, loadFailed: false };
    #selectedIndex = 0;
    #loadGeneration = 0;
    #cachedWidth?: number;
    #cachedRows?: number;
    #cachedLines?: string[];

    constructor(options: {
        tui: TUI;
        theme: Theme;
        keymap: ResolvedPaletteKeymap;
        snapshot: AgentSnapshot;
        deps: ChildHistoryViewDependencies;
        done: (disposition?: "back" | "close-all") => void;
    }) {
        this.#tui = options.tui;
        this.#theme = options.theme;
        this.#keymap = options.keymap;
        this.#snapshot = options.snapshot;
        this.#deps = options.deps;
        this.#done = options.done;
    }

    get focused() { return this.#focused; }
    set focused(value: boolean) { this.#focused = value; }
    get selectedIndex() { return this.#selectedIndex; }
    get items() { return this.#list.items; }
    get status() { return this.#status; }
    get opening() { return this.#opening; }
    selected(): ChildHistoryItem | undefined { return this.#list.items[this.#selectedIndex]; }
    invalidate() { this.#cachedWidth = undefined; this.#cachedRows = undefined; this.#cachedLines = undefined; }
    dispose() { this.#disposed = true; this.#opening = false; this.#loadGeneration += 1; this.#focused = false; }
    requestClose(): boolean { return !this.#opening; }

    start(): void { void this.#load(); }

    async #load(): Promise<void> {
        const generation = ++this.#loadGeneration;
        this.#statusKind = "dim";
        this.#status = "Loading…";
        this.invalidate();
        this.#tui.requestRender();
        try {
            const list = await (this.#deps.listHistory ?? listChildHistory)(this.#deps.stateRoot, this.#deps.meshId, this.#snapshot.agent.agentId, this.#deps.natureHandleWords);
            if (this.#disposed || generation !== this.#loadGeneration) return;
            this.#list = list;
            if (this.#selectedIndex >= list.items.length) this.#selectedIndex = Math.max(0, list.items.length - 1);
            if (list.loadFailed) {
                this.#statusKind = "error";
                this.#status = "History could not be loaded.";
            } else if (list.items.length === 0 && list.unavailableCount === 0) {
                this.#statusKind = "dim";
                this.#status = "No history for this child.";
            } else if (list.unavailableCount > 0) {
                this.#statusKind = "warning";
                this.#status = `${list.unavailableCount} record(s) unavailable`;
            } else {
                this.#statusKind = "dim";
                this.#status = `${list.items.length} record(s)`;
            }
        } catch (error) {
            if (this.#disposed || generation !== this.#loadGeneration) return;
            this.#list = { items: [], unavailableCount: 0, loadFailed: true };
            this.#statusKind = "error";
            this.#status = `History could not be loaded: ${error instanceof Error ? error.message : String(error)}`;
        }
        this.invalidate();
        this.#tui.requestRender();
    }

    #move(delta: number): void {
        if (this.#list.items.length === 0) return;
        this.#selectedIndex = Math.max(0, Math.min(this.#list.items.length - 1, this.#selectedIndex + delta));
        this.invalidate();
        this.#tui.requestRender();
    }

    async #confirm(): Promise<void> {
        const item = this.selected();
        if (!item || this.#opening || this.#disposed) return;
        const selected = this.#selectedIndex;
        const generation = this.#loadGeneration;
        this.#opening = true;
        try {
            await this.#deps.openBody(item);
        } catch (error) {
            if (this.#disposed || generation !== this.#loadGeneration) return;
            this.#statusKind = "error";
            this.#status = `Body could not be opened: ${error instanceof Error ? error.message : String(error)}`;
            this.invalidate();
            this.#tui.requestRender();
        } finally {
            this.#opening = false;
        }
        if (this.#disposed || generation !== this.#loadGeneration) return;
        this.#selectedIndex = Math.min(selected, Math.max(0, this.#list.items.length - 1));
        this.invalidate();
        this.#tui.requestRender();
    }

    handleInput(data: string): void {
        if (this.#disposed) return;
        const action = paletteKeyAction(data, this.#keymap);
        if (action === "cancel") { this.#done("back"); return; }
        if (this.#opening) return;
        if (action === "moveUp") this.#move(-1);
        else if (action === "moveDown") this.#move(1);
        else if (action === "confirm") void this.#confirm();
    }

    #itemLine(item: ChildHistoryItem, selected: boolean, width: number): string {
        const parts = [
            `${item.from.label} → ${item.to.label}`,
            item.kind,
            item.taskState,
            item.deliveryState,
            item.at,
            item.purpose,
        ].filter((part): part is string => Boolean(part));
        const preview = safeHistoryText(item.truncated ? `${item.preview}\n${HISTORY_FULL_PATH_HINT}` : item.preview);
        const text = `${parts.join(" · ")}\n${preview}`;
        const line = truncateToWidth(text.replaceAll("\n", " · "), width, "");
        const padded = pad(line, width);
        return selected ? this.#theme.bg("selectedBg", padded) : padded;
    }

    render(width: number): string[] {
        const w = Math.max(1, width);
        const rows = overlayRows(this.#tui.terminal.rows);
        if (this.#cachedLines && this.#cachedWidth === w && this.#cachedRows === rows) return this.#cachedLines;
        const inner = Math.max(1, w - 2);
        const identity = displayIdentityForSnapshot(this.#snapshot, this.#deps.natureHandleWords);
        const heading = formatPartyLabel(identity, identity.handle);
        const help = paletteHelp(this.#keymap, ["moveUp", "moveDown", "confirm", "cancel"]);
        const innerBudget = Math.max(1, rows - 2);
        const bodyRows = Math.max(1, innerBudget - 3);
        const items = this.#list.items;
        const start = Math.max(0, Math.min(this.#selectedIndex - Math.floor((bodyRows - 1) / 2), Math.max(0, items.length - bodyRows)));
        const visible = items.slice(start, start + bodyRows).map((item, index) => this.#itemLine(item, start + index === this.#selectedIndex, inner));
        while (visible.length < bodyRows) visible.push(pad("", inner));
        const body = [
            truncateToWidth(` ${this.#theme.fg("muted", heading)}`, inner, ""),
            ...visible.map(line => truncateToWidth(line, inner, "")),
            truncateToWidth(` ${this.#theme.fg(this.#statusKind, this.#status)}`, inner, ""),
            truncateToWidth(` ${this.#theme.fg("dim", help)}`, inner, ""),
        ].slice(0, innerBudget);
        const lines = renderFramedLines({
            theme: this.#theme,
            width: w,
            title: formatPaletteBreadcrumb(["Mesh Agents", "Child history"]),
            body,
        }).map(line => truncateToWidth(line, w, "")).slice(0, rows);
        this.#cachedLines = lines;
        this.#cachedWidth = w;
        this.#cachedRows = rows;
        return lines;
    }
}

export class ChildHistoryBodyComponent implements Component, Focusable {
    readonly #tui: TUI;
    readonly #theme: Theme;
    readonly #keymap: ResolvedPaletteKeymap;
    readonly #item: ChildHistoryItem;
    readonly #deps: Omit<ChildHistoryViewDependencies, "openBody">;
    readonly #done: (disposition?: "back" | "close-all") => void;
    #focused = false;
    #disposed = false;
    #status = "Loading…";
    #statusKind: "success" | "error" | "warning" | "dim" = "dim";
    #body = "";
    #scroll = 0;
    #loadGeneration = 0;
    #cachedWidth?: number;
    #cachedRows?: number;
    #cachedLines?: string[];
    #wrapped: string[] = [];
    #viewport = 1;

    constructor(options: {
        tui: TUI;
        theme: Theme;
        keymap: ResolvedPaletteKeymap;
        item: ChildHistoryItem;
        deps: Omit<ChildHistoryViewDependencies, "openBody">;
        done: (disposition?: "back" | "close-all") => void;
    }) {
        this.#tui = options.tui;
        this.#theme = options.theme;
        this.#keymap = options.keymap;
        this.#item = options.item;
        this.#deps = options.deps;
        this.#done = options.done;
    }

    get focused() { return this.#focused; }
    set focused(value: boolean) { this.#focused = value; }
    get scrollOffset() { return this.#scroll; }
    get body() { return this.#body; }
    get status() { return this.#status; }
    get wrappedLineCount() { return this.#wrapped.length; }
    invalidate() { this.#cachedWidth = undefined; this.#cachedRows = undefined; this.#cachedLines = undefined; }
    dispose() { this.#disposed = true; this.#loadGeneration += 1; this.#focused = false; }
    requestClose(): boolean { return true; }

    start(): void { void this.#load(); }

    async #load(): Promise<void> {
        const generation = ++this.#loadGeneration;
        const ref: ChildHistoryBodyRef = this.#item.bodyRef;
        this.#status = "Loading…";
        this.#statusKind = "dim";
        this.invalidate();
        this.#tui.requestRender();
        try {
            const body = await (this.#deps.readBody ?? readChildHistoryBody)(this.#deps.stateRoot, this.#deps.meshId, ref);
            if (this.#disposed || generation !== this.#loadGeneration) return;
            this.#body = body;
            this.#statusKind = "dim";
            this.#status = this.#item.kind;
        } catch (error) {
            if (this.#disposed || generation !== this.#loadGeneration) return;
            this.#body = "";
            this.#statusKind = "error";
            this.#status = `Body could not be loaded: ${error instanceof Error ? error.message : String(error)}`;
        }
        this.invalidate();
        this.#tui.requestRender();
    }

    #scrollBy(delta: number, viewport: number): void {
        const max = Math.max(0, this.#wrapped.length - viewport);
        this.#scroll = Math.max(0, Math.min(max, this.#scroll + delta));
        this.invalidate();
        this.#tui.requestRender();
    }

    #overlayRows(): number {
        return overlayRows(this.#tui.terminal.rows);
    }

    canReachEnd(): boolean {
        const viewport = this.#viewport;
        return this.#scroll + viewport >= this.#wrapped.length || this.#wrapped.length <= viewport;
    }

    handleInput(data: string): void {
        if (this.#disposed) return;
        const action = paletteKeyAction(data, this.#keymap);
        const viewport = this.#viewport;
        if (action === "cancel") { this.#done("back"); return; }
        if (action === "moveUp" || matchesKey(data, Key.up)) this.#scrollBy(-1, viewport);
        else if (action === "moveDown" || matchesKey(data, Key.down)) this.#scrollBy(1, viewport);
        else if (matchesKey(data, Key.pageUp)) this.#scrollBy(-viewport, viewport);
        else if (matchesKey(data, Key.pageDown)) this.#scrollBy(viewport, viewport);
        else if (matchesKey(data, Key.home)) this.#scrollBy(-this.#wrapped.length, viewport);
        else if (matchesKey(data, Key.end)) this.#scrollBy(this.#wrapped.length, viewport);
    }

    render(width: number): string[] {
        const w = Math.max(1, width);
        const rows = this.#overlayRows();
        if (this.#cachedLines && this.#cachedWidth === w && this.#cachedRows === rows) return this.#cachedLines;
        const inner = Math.max(1, w - 2);
        const innerBudget = Math.max(1, rows - 2);
        const viewport = Math.max(1, innerBudget - 2);
        this.#viewport = viewport;
        const header = historyHeaderLines(this.#item, inner);
        const bodyLines = wrapTextWithAnsi(safeHistoryText(this.#body), inner);
        this.#wrapped = header.length ? [...header, ...bodyLines] : bodyLines;
        const help = `${paletteHelp(this.#keymap, ["moveUp", "moveDown", "cancel"])} • PgUp/PgDn page`;
        const maxScroll = Math.max(0, this.#wrapped.length - viewport);
        if (this.#scroll > maxScroll) this.#scroll = maxScroll;
        const window = this.#wrapped.slice(this.#scroll, this.#scroll + viewport);
        while (window.length < viewport) window.push("");
        const body = [
            ...window.map((line, index) => {
                const source = this.#scroll + index;
                const styled = source < header.length ? ` ${this.#theme.fg("muted", line)}` : line;
                return truncateToWidth(styled, inner, "");
            }),
            truncateToWidth(` ${this.#theme.fg(this.#statusKind, this.#status)}`, inner, ""),
            truncateToWidth(` ${this.#theme.fg("dim", help)}`, inner, ""),
        ].slice(0, innerBudget);
        const lines = renderFramedLines({
            theme: this.#theme,
            width: w,
            title: formatPaletteBreadcrumb(["Mesh Agents", "Child history", "Body"]),
            body,
        }).map(line => truncateToWidth(line, w, "")).slice(0, rows);
        this.#cachedLines = lines;
        this.#cachedWidth = w;
        this.#cachedRows = rows;
        return lines;
    }
}
