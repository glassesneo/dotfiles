import assert from "node:assert/strict";
import test from "node:test";
import { resolvePaletteKeymap, validatePaletteKeymapConfig } from "../extensions_src/utilities/command_palette_keymap.ts";

void test("synthetic palette overrides are projected into the resolved keymap", () => {
    const resolved = resolvePaletteKeymap({ moveUp: ["f10"], refresh: ["ctrl+r"] });
    assert.deepEqual(resolved.moveUp, ["f10"]);
    assert.deepEqual(resolved.refresh, ["ctrl+r"]);
});

void test("palette keymap validates actions, keys, required bindings, and collisions", () => {
    assert.throws(() => validatePaletteKeymapConfig({ unknown: ["x"] }), /unknown action/);
    assert.throws(() => validatePaletteKeymapConfig({ open: ["not-a-key"] }), /invalid key/);
    assert.throws(() => resolvePaletteKeymap({ moveUp: [] }, "test", ["moveUp"]), /required action moveUp/);
    assert.throws(() => resolvePaletteKeymap({ moveUp: ["ctrl+n"] }), /conflicts between moveUp, moveDown/);
    assert.throws(() => resolvePaletteKeymap({ moveUp: ["ctrl+shift+n"], moveDown: ["shift+ctrl+n"] }), /conflicts between moveUp, moveDown/);
    assert.throws(() => resolvePaletteKeymap({ collapse: ["enter"] }), /conflicts between/);
});
