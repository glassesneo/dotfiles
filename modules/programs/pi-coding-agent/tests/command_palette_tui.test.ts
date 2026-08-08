import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { resolvePaletteKeymap } from "../extensions_src/utilities/command_palette_keymap.ts";
import { formatPaletteBreadcrumb, paletteTargetRows, PaletteListComponent, renderFramedLines } from "../extensions_src/utilities/command_palette_tui.ts";

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

void test("palette projects items and configured navigation help without overflowing", () => {
    const h = harness(); assert.equal(h.component.focused, true);
    for (const width of [80, 60, 20, 8, 1]) {
        const lines = h.component.render(width);
        for (const line of lines) assert.ok(visibleWidth(line) <= width, `width ${width}: ${line}`);
    }
    const rendered = h.component.render(80).join("\n");
    assert.match(rendered, /Alpha/);
    assert.match(rendered, /Ctrl\+P/);
    assert.match(rendered, /Ctrl\+N/);
});

void test("filtering and status changes preserve overlay height and input position", () => {
    const h = harness();
    const initial = h.component.render(80);
    assert.equal(initial.length, paletteTargetRows(24, true));
    assert.match(initial.join("\n"), /Search/);
    h.component.handleInput("zz");
    const empty = h.component.render(80);
    assert.equal(empty.length, initial.length);
    assert.match(empty.join("\n"), /Search/);
    assert.match(empty.join("\n"), /No matches/);
    h.component.setStatus("warning", "Keep the viewport stable");
    assert.equal(h.component.render(80).length, initial.length);
});

void test("palette height stays compact on standard and tall terminals", () => {
    assert.equal(paletteTargetRows(24, true), 15);
    assert.equal(paletteTargetRows(50, true), 18);
    assert.equal(paletteTargetRows(24, false), 15);
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
    assert.match(component.render(80).join("\n"), /WORKING/);
    component.setBusy(false);
    component.handleInput(keys.escape);
    assert.deepEqual(results, [null]);
});

void test("theme invalidate regenerates framed colors from the current theme", () => {
    const roles: string[] = [];
    const spyTheme = {
        fg(color: string, text: string) { roles.push(`fg:${color}`); return text; },
        bg(color: string, text: string) { roles.push(`bg:${color}`); return text; },
        bold(text: string) { return text; },
    } as Theme;
    const framed = renderFramedLines({ theme: spyTheme, width: 40, title: "Command Palette", body: [" body"] });
    assert.ok(framed.join("\n").includes("Command Palette"));
    assert.ok(roles.includes("fg:border"));
    assert.ok(roles.includes("fg:accent"));
    const breadcrumb = formatPaletteBreadcrumb(["Synthetic root", "Synthetic child"]);
    assert.match(breadcrumb, /Synthetic root/);
    assert.match(breadcrumb, /Synthetic child/);
});
