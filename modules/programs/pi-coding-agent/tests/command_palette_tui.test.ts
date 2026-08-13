import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { resolvePaletteKeymap } from "../extensions_src/utilities/command_palette_keymap.ts";
import { PaletteListComponent } from "../extensions_src/utilities/command_palette_tui.ts";

const theme = {
    fg(_color: string, text: string) { return text; },
    bg(_color: string, text: string) { return text; },
    bold(text: string) { return text; },
} as Theme;
const keys = { up: "\u0010", down: "\u000e", enter: "\r", escape: "\u001b", ctrlC: "\u0003", left: "\u001b[D", right: "\u001b[C" };
const testKeymapConfig = {
    open: ["ctrl+shift+p"], moveUp: ["ctrl+p"], moveDown: ["ctrl+n"], collapse: ["left"], expand: ["right"],
    confirm: ["enter"], cancel: ["escape", "ctrl+c"], refresh: ["ctrl+r"], stop: ["ctrl+s"],
};
const testKeymap = () => resolvePaletteKeymap(testKeymapConfig);
function harness() {
    const results: Array<string | null> = []; let renders = 0;
    const component = new PaletteListComponent({ tui: { terminal: { rows: 24, columns: 80 }, requestRender() { renders += 1; } } as TUI, theme, title: "Palette", keymap: testKeymap(), items: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma" }], done: value => results.push(value) });
    component.focused = true;
    return { component, results, get renders() { return renders; } };
}

void test("configured navigation keys wrap selection without changing search", () => {
    const h = harness(); h.component.handleInput("a"); const query = h.component.query;
    h.component.handleInput(keys.up); assert.equal(h.component.selectedIndex, 2); assert.equal(h.component.query, query);
    h.component.handleInput(keys.down); assert.equal(h.component.selectedIndex, 0); assert.equal(h.component.query, query);
});

void test("confirm and both cancellation keys are consumed by the palette", () => {
    const selected = harness(); selected.component.handleInput(keys.down); selected.component.handleInput(keys.enter); assert.deepEqual(selected.results, ["b"]);
    const escaped = harness(); escaped.component.handleInput(keys.escape); assert.deepEqual(escaped.results, [null]);
    const cancelled = harness(); cancelled.component.handleInput(keys.ctrlC); assert.deepEqual(cancelled.results, [null]);
});


void test("busy state suppresses duplicate confirm, defers Escape, and closes once after settlement", () => {
    let confirms = 0; const results: Array<string | null> = [];
    const component = new PaletteListComponent({
        tui: { terminal: { rows: 24, columns: 80 }, requestRender() {} } as TUI,
        theme,
        title: "Palette",
        keymap: testKeymap(),
        items: [{ value: "a", label: "Alpha" }],
        done(value) { results.push(value); },
        onConfirm: async () => { confirms += 1; },
    });
    component.setBusy(true);
    component.handleInput(keys.enter);
    component.handleInput(keys.escape);
    assert.equal(confirms, 0); assert.deepEqual(results, []);
    component.setBusy(false);
    component.handleInput(keys.escape);
    assert.deepEqual(results, [null]);
});
