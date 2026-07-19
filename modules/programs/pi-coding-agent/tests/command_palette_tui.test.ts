import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { resolvePaletteKeymap } from "../extensions_src/utilities/command_palette_keymap.ts";
import { paletteTargetRows, PaletteListComponent, runPaletteList } from "../extensions_src/utilities/command_palette_tui.ts";

const theme = { fg(_color: string, text: string) { return text; }, bg(_color: string, text: string) { return text; }, bold(text: string) { return text; } } as Theme;
const keys = { up: "\u0010", down: "\u000e", enter: "\r", escape: "\u001b", ctrlC: "\u0003" };
function harness() {
    const results: Array<string | null> = []; let renders = 0;
    const component = new PaletteListComponent({ tui: { terminal: { rows: 24, columns: 80 }, requestRender() { renders += 1; } } as TUI, theme, title: "Palette", keymap: resolvePaletteKeymap(), items: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma" }], done: value => results.push(value) });
    component.focused = true;
    return { component, results, get renders() { return renders; } };
}

test("Ctrl-N and Ctrl-P wrap selection without changing search", () => {
    const h = harness(); h.component.handleInput("a"); const query = h.component.query;
    h.component.handleInput(keys.up); assert.equal(h.component.selectedIndex, 2); assert.equal(h.component.query, query);
    h.component.handleInput(keys.down); assert.equal(h.component.selectedIndex, 0); assert.equal(h.component.query, query);
});

test("confirm and both cancellation keys are consumed by the palette", () => {
    const selected = harness(); selected.component.handleInput(keys.down); selected.component.handleInput(keys.enter); assert.deepEqual(selected.results, ["b"]);
    const escaped = harness(); escaped.component.handleInput(keys.escape); assert.deepEqual(escaped.results, [null]);
    const cancelled = harness(); cancelled.component.handleInput(keys.ctrlC); assert.deepEqual(cancelled.results, [null]);
});

test("search focus, textual marker, help, disabled state, and narrow rendering are visible", () => {
    const h = harness(); assert.equal(h.component.focused, true); const rendered = h.component.render(80).join("\n");
    assert.match(rendered, /> Alpha/); assert.match(rendered, /ctrl\+p up.*ctrl\+n down/);
    for (const width of [20, 8, 1]) for (const line of h.component.render(width)) assert.ok(visibleWidth(line) <= width);
});

test("filtering and status changes preserve overlay height and input position", () => {
    const h = harness();
    const initial = h.component.render(80);
    assert.equal(initial.length, paletteTargetRows(24, true));
    assert.match(initial[2] ?? "", /Search/);
    assert.notEqual(initial[3], undefined);
    h.component.handleInput("zz");
    const empty = h.component.render(80);
    assert.equal(empty.length, initial.length);
    assert.match(empty[2] ?? "", /Search/);
    assert.notEqual(empty[3], undefined);
    assert.match(empty.join("\n"), /No matches/);
    h.component.setStatus("warning", "Keep the viewport stable");
    assert.equal(h.component.render(80).length, initial.length);
});

test("palette height stays compact on standard and tall terminals", () => {
    assert.equal(paletteTargetRows(24, true), 15);
    assert.equal(paletteTargetRows(50, true), 18);
    assert.equal(paletteTargetRows(24, false), 15);
});

test("palette lists open as centered overlays", async () => {
    let customOptions: { overlay?: boolean; overlayOptions?: { anchor?: string; maxHeight?: string } } | undefined;
    const result = await runPaletteList({ async custom(factory: any, options: any) {
        customOptions = options;
        let value: string | null | undefined;
        const component = await factory({ terminal: { rows: 24, columns: 80 }, requestRender() {} } as TUI, theme, {} as never, (next: string | null) => { value = next; });
        component.handleInput?.(keys.ctrlC);
        return value as never;
    } } as never, { title: "Palette", keymap: resolvePaletteKeymap(), items: [{ value: "a", label: "Alpha" }] });
    assert.equal(result, null);
    assert.equal(customOptions?.overlay, true);
    assert.equal(customOptions?.overlayOptions?.anchor, "center");
    assert.equal(customOptions?.overlayOptions?.maxHeight, "70%");
});
