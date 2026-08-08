import type { Theme } from "@earendil-works/pi-coding-agent";
import { Input, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { filterPaletteItems, type PaletteListItem } from "./command_palette_core.ts";
import { paletteHelp, paletteKeyAction, type ResolvedPaletteKeymap } from "./command_palette_keymap.ts";

export function paletteTargetRows(terminalRows: number, searchable: boolean): number {
    const fixedRows = searchable ? 8 : 6;
    return Math.max(fixedRows + 1, Math.min(18, Math.floor(terminalRows * 0.65)));
}

export function formatPaletteBreadcrumb(parts: readonly string[]): string {
    return parts.filter(part => part.trim().length > 0).join(" › ");
}

function appendWrapped(lines: string[], width: number, text: string, prefix = ""): void {
    const prefixWidth = visibleWidth(prefix);
    if (prefixWidth >= width) { lines.push(...wrapTextWithAnsi(`${prefix}${text}`, width)); return; }
    const wrapped = wrapTextWithAnsi(text, Math.max(1, width - prefixWidth));
    wrapped.forEach((line, index) => lines.push(`${index === 0 ? prefix : " ".repeat(prefixWidth)}${line}`));
}

/** Draw a four-sided ANSI-safe frame around body lines. Title sits in the top border. */
export function renderFramedLines(options: {
    theme: Theme;
    width: number;
    title: string;
    body: readonly string[];
}): string[] {
    const w = Math.max(1, options.width);
    const inner = Math.max(1, w - 2);
    const titleText = truncateToWidth(` ${options.title} `, Math.max(1, inner - 2), "");
    const titleWidth = visibleWidth(titleText);
    const leftRule = 1;
    const rightRule = Math.max(0, inner - leftRule - titleWidth);
    const top = truncateToWidth(
        options.theme.fg("border", `┌${"─".repeat(leftRule)}`) + options.theme.fg("accent", options.theme.bold(titleText)) + options.theme.fg("border", `${"─".repeat(rightRule)}┐`),
        w,
        "",
    );
    const bottom = options.theme.fg("border", truncateToWidth(`└${"─".repeat(inner)}┘`, w, ""));
    const framed = options.body.map(line => {
        const content = truncateToWidth(line, inner, "");
        const pad = Math.max(0, inner - visibleWidth(content));
        return truncateToWidth(`${options.theme.fg("border", "│")}${content}${" ".repeat(pad)}${options.theme.fg("border", "│")}`, w, "");
    });
    return [top, ...framed, bottom];
}

export class PaletteListComponent<T> implements Component, Focusable {
    readonly #tui: Pick<TUI, "requestRender" | "terminal">;
    readonly #theme: Theme;
    readonly #title: string;
    readonly #keymap: ResolvedPaletteKeymap;
    readonly #input = new Input();
    readonly #searchable: boolean;
    readonly #done: (value: T | null) => void;
    readonly #onConfirm?: (item: PaletteListItem<T>, component: PaletteListComponent<T>) => void | Promise<void>;
    #items: PaletteListItem<T>[];
    #selected = 0;
    #status?: { kind: "success" | "error" | "warning"; text: string };
    #focused = false;
    #finished = false;
    #busy = false;
    #cancelRequested = false;
    #cachedWidth?: number;
    #cachedLines?: string[];

    constructor(options: {
        tui: TUI;
        theme: Theme;
        title: string;
        items: readonly PaletteListItem<T>[];
        keymap: ResolvedPaletteKeymap;
        searchable?: boolean;
        done: (value: T | null) => void;
        onConfirm?: (item: PaletteListItem<T>, component: PaletteListComponent<T>) => void | Promise<void>;
    }) {
        this.#tui = options.tui; this.#theme = options.theme; this.#title = options.title; this.#items = [...options.items];
        this.#keymap = options.keymap; this.#searchable = options.searchable ?? true; this.#done = options.done; this.#onConfirm = options.onConfirm;
    }
    get focused(): boolean { return this.#focused; }
    set focused(value: boolean) { this.#focused = value; this.#input.focused = value && this.#searchable; }
    get query(): string { return this.#input.getValue(); }
    get selectedIndex(): number { return this.#selected; }
    get busy(): boolean { return this.#busy; }
    get filteredItems(): PaletteListItem<T>[] { return this.#searchable ? filterPaletteItems(this.#items, this.query) : [...this.#items]; }
    setItems(items: readonly PaletteListItem<T>[]): void { this.#items = [...items]; this.#normalizeSelection(); this.refresh(); }
    selectValue(value: T): boolean {
        const index = this.filteredItems.findIndex(item => Object.is(item.value, value));
        if (index < 0) return false;
        this.#selected = index;
        this.refresh();
        return true;
    }
    setStatus(kind: "success" | "error" | "warning", text: string): void { if (this.#finished) return; this.#status = { kind, text }; this.refresh(); }
    clearStatus(): void { if (this.#finished) return; this.#status = undefined; this.refresh(); }
    setBusy(value: boolean): void { if (this.#finished) return; this.#busy = value; this.refresh(); if (!value && this.#cancelRequested) this.close(null); }
    requestClose(): boolean { if (this.#busy) { this.#cancelRequested = true; return false; } return true; }
    close(value: T | null = null): void { if (this.#finished) return; this.#finished = true; this.#input.focused = false; this.#done(value); }
    dispose(): void { if (this.#finished) return; this.#finished = true; this.#busy = false; this.#input.focused = false; this.invalidate(); }
    invalidate(): void { this.#cachedWidth = undefined; this.#cachedLines = undefined; this.#input.invalidate(); }
    refresh(): void { this.invalidate(); this.#tui.requestRender(); }
    #normalizeSelection(): void { const count = this.filteredItems.length; this.#selected = count === 0 ? 0 : Math.min(this.#selected, count - 1); }
    #move(delta: number): void { const count = this.filteredItems.length; if (count === 0) return; this.#selected = (this.#selected + delta + count) % count; this.refresh(); }
    #confirm(): void {
        if (this.#busy) return;
        const item = this.filteredItems[this.#selected]; if (!item) { this.setStatus("warning", "No matching item."); return; }
        if (item.disabledReason) { this.setStatus("warning", item.disabledReason); return; }
        if (this.#onConfirm) void Promise.resolve(this.#onConfirm(item, this)).catch(error => this.setStatus("error", error instanceof Error ? error.message : String(error)));
        else this.close(item.value);
    }
    handleInput(data: string): void {
        if (this.#finished) return;
        const action = paletteKeyAction(data, this.#keymap);
        if (action === "cancel") { if (this.#busy) { this.#cancelRequested = true; return; } this.close(null); return; }
        if (this.#busy) return;
        if (action === "moveUp") { this.#move(-1); return; }
        if (action === "moveDown") { this.#move(1); return; }
        if (action === "confirm") { this.#confirm(); return; }
        if (!this.#searchable) return;
        const previous = this.query; this.#input.handleInput(data);
        if (this.query !== previous) { this.#selected = 0; this.#status = undefined; this.refresh(); }
    }
    #itemLines(item: PaletteListItem<T>, index: number, width: number): string[] {
        const lines: string[] = [];
        const selected = index === this.#selected; const marker = selected ? "> " : "  ";
        const state = item.state ? ` [${item.state}]` : ""; const disabled = item.disabledReason ? ` — Disabled: ${item.disabledReason}` : "";
        const text = `${item.label}${state}${disabled}`;
        const color = item.disabledReason ? "warning" : selected ? "accent" : item.state?.toLowerCase().includes("current") || item.state?.toLowerCase().includes("active") ? "success" : "text";
        const styled = this.#theme.fg(color, selected ? this.#theme.bold(text) : text);
        appendWrapped(lines, width, styled, marker);
        if (item.description) appendWrapped(lines, width, this.#theme.fg("muted", item.description), "    ");
        return selected ? lines.map(line => this.#theme.bg("selectedBg", line)) : lines;
    }
    #viewportLines(items: readonly PaletteListItem<T>[], width: number, viewportRows: number): string[] {
        if (items.length === 0) {
            const lines = [truncateToWidth(this.#theme.fg("warning", " No matches."), width, "")];
            while (lines.length < viewportRows) lines.push("");
            return lines.slice(0, viewportRows);
        }
        const blocks = items.map((item, index) => this.#itemLines(item, index, width));
        const offsets: number[] = []; const flat: string[] = [];
        for (const block of blocks) { offsets.push(flat.length); flat.push(...block); }
        const selectedStart = offsets[this.#selected] ?? 0;
        const selectedLength = blocks[this.#selected]?.length ?? 1;
        const selectedEnd = selectedStart + selectedLength - 1;
        let start = selectedStart - Math.floor(Math.max(0, viewportRows - Math.min(selectedLength, viewportRows)) / 2);
        start = Math.max(0, Math.min(start, Math.max(0, flat.length - viewportRows)));
        if (selectedLength <= viewportRows && selectedEnd >= start + viewportRows) start = selectedEnd - viewportRows + 1;
        const lines = flat.slice(start, start + viewportRows);
        while (lines.length < viewportRows) lines.push("");
        return lines;
    }
    render(width: number): string[] {
        const w = Math.max(1, width); if (this.#cachedLines && this.#cachedWidth === w) return this.#cachedLines;
        const targetRows = paletteTargetRows(this.#tui.terminal.rows, this.#searchable);
        const fixedRows = this.#searchable ? 8 : 6;
        const viewportRows = Math.max(1, targetRows - fixedRows);
        const inner = Math.max(1, w - 2);
        const items = this.filteredItems;
        const body: string[] = [];
        if (this.#searchable) {
            body.push(truncateToWidth(` ${this.#theme.fg("muted", "Search:")}`, inner, ""));
            const input = this.#input.render(Math.max(1, inner - 2))[0] ?? "";
            body.push(truncateToWidth(inner > 2 ? `  ${input}` : input, inner, ""));
        }
        body.push("");
        body.push(...this.#viewportLines(items, inner, viewportRows));
        const position = items.length === 0 ? "0 matches" : `${this.#selected + 1}/${items.length}`;
        const statusText = this.#busy ? "WORKING" : this.#status ? `${this.#status.kind === "error" ? "Error" : "Status"}: ${this.#status.text}` : position;
        const statusRole = this.#busy ? "warning" : this.#status?.kind ?? "dim";
        body.push(truncateToWidth(` ${this.#theme.fg(statusRole, statusText)}`, inner, ""));
        body.push(truncateToWidth(` ${this.#theme.fg("dim", paletteHelp(this.#keymap))}`, inner, ""));
        while (body.length < targetRows - 2) body.push("");
        const lines = renderFramedLines({ theme: this.#theme, width: w, title: this.#title, body: body.slice(0, Math.max(1, targetRows - 2)) });
        this.#cachedLines = lines.map(line => truncateToWidth(line, w, "")); this.#cachedWidth = w; return this.#cachedLines;
    }
}
