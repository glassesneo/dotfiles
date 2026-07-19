import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { Input, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { filterPaletteItems, type PaletteListItem } from "./command_palette_core.ts";
import { paletteHelp, paletteKeyAction, type ResolvedPaletteKeymap } from "./command_palette_keymap.ts";

export function paletteTargetRows(terminalRows: number, searchable: boolean): number {
    const fixedRows = searchable ? 8 : 6;
    return Math.max(fixedRows + 1, Math.min(18, Math.floor(terminalRows * 0.65)));
}

function appendWrapped(lines: string[], width: number, text: string, prefix = ""): void {
    const prefixWidth = visibleWidth(prefix);
    if (prefixWidth >= width) { lines.push(...wrapTextWithAnsi(`${prefix}${text}`, width)); return; }
    const wrapped = wrapTextWithAnsi(text, Math.max(1, width - prefixWidth));
    wrapped.forEach((line, index) => lines.push(`${index === 0 ? prefix : " ".repeat(prefixWidth)}${line}`));
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
    #cachedWidth?: number;
    #cachedLines?: string[];

    constructor(options: { tui: TUI; theme: Theme; title: string; items: readonly PaletteListItem<T>[]; keymap: ResolvedPaletteKeymap; searchable?: boolean; done: (value: T | null) => void; onConfirm?: (item: PaletteListItem<T>, component: PaletteListComponent<T>) => void | Promise<void>; }) {
        this.#tui = options.tui; this.#theme = options.theme; this.#title = options.title; this.#items = [...options.items];
        this.#keymap = options.keymap; this.#searchable = options.searchable ?? true; this.#done = options.done; this.#onConfirm = options.onConfirm;
    }
    get focused(): boolean { return this.#focused; }
    set focused(value: boolean) { this.#focused = value; this.#input.focused = value && this.#searchable; }
    get query(): string { return this.#input.getValue(); }
    get selectedIndex(): number { return this.#selected; }
    get filteredItems(): PaletteListItem<T>[] { return this.#searchable ? filterPaletteItems(this.#items, this.query) : [...this.#items]; }
    setItems(items: readonly PaletteListItem<T>[]): void { this.#items = [...items]; this.#normalizeSelection(); this.refresh(); }
    setStatus(kind: "success" | "error" | "warning", text: string): void { this.#status = { kind, text }; this.refresh(); }
    close(value: T | null = null): void { if (this.#finished) return; this.#finished = true; this.#input.focused = false; this.#done(value); }
    invalidate(): void { this.#cachedWidth = undefined; this.#cachedLines = undefined; this.#input.invalidate(); }
    refresh(): void { this.invalidate(); this.#tui.requestRender(); }
    #normalizeSelection(): void { const count = this.filteredItems.length; this.#selected = count === 0 ? 0 : Math.min(this.#selected, count - 1); }
    #move(delta: number): void { const count = this.filteredItems.length; if (count === 0) return; this.#selected = (this.#selected + delta + count) % count; this.refresh(); }
    #confirm(): void {
        const item = this.filteredItems[this.#selected]; if (!item) { this.setStatus("warning", "No matching item."); return; }
        if (item.disabledReason) { this.setStatus("warning", item.disabledReason); return; }
        if (this.#onConfirm) void Promise.resolve(this.#onConfirm(item, this)).catch(error => this.setStatus("error", error instanceof Error ? error.message : String(error)));
        else this.close(item.value);
    }
    handleInput(data: string): void {
        if (this.#finished) return;
        const action = paletteKeyAction(data, this.#keymap);
        if (action === "cancel") { this.close(null); return; }
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
        const items = this.filteredItems;
        const lines: string[] = [this.#theme.fg("border", "─".repeat(w))];
        lines.push(truncateToWidth(` ${this.#theme.fg("accent", this.#theme.bold(this.#title))}`, w, ""));
        if (this.#searchable) {
            lines.push(truncateToWidth(` ${this.#theme.fg("muted", "Search:")}`, w, ""));
            const input = this.#input.render(Math.max(1, w - 2))[0] ?? "";
            lines.push(truncateToWidth(w > 2 ? `  ${input}` : input, w, ""));
        }
        lines.push("");
        lines.push(...this.#viewportLines(items, w, viewportRows));
        const position = items.length === 0 ? "0 matches" : `${this.#selected + 1}/${items.length}`;
        const status = this.#status ? `${this.#status.kind === "error" ? "Error" : "Status"}: ${this.#status.text}` : position;
        lines.push(truncateToWidth(` ${this.#theme.fg(this.#status?.kind ?? "dim", status)}`, w, ""));
        lines.push(truncateToWidth(` ${this.#theme.fg("dim", paletteHelp(this.#keymap))}`, w, ""));
        lines.push(this.#theme.fg("border", "─".repeat(w)));
        this.#cachedLines = lines.map(line => truncateToWidth(line, w, "")); this.#cachedWidth = w; return this.#cachedLines;
    }
}

export async function runPaletteList<T>(ui: Pick<ExtensionUIContext, "custom">, options: { title: string; items: readonly PaletteListItem<T>[]; keymap: ResolvedPaletteKeymap; searchable?: boolean; onConfirm?: (item: PaletteListItem<T>, component: PaletteListComponent<T>) => void | Promise<void>; }): Promise<T | null> {
    return ui.custom<T | null>(
        (tui, theme, _keybindings, done) => new PaletteListComponent({ tui, theme, done, ...options }),
        {
            overlay: true,
            overlayOptions: {
                anchor: "center",
                width: "35%",
                minWidth: 60,
                maxHeight: "70%",
                margin: 1,
            },
        },
    );
}
