import assert from "node:assert/strict";
import test from "node:test";
import { paletteHelp, paletteKeyAction, resolvePaletteKeymap, validatePaletteKeymapConfig } from "../extensions/utilities/command_palette_keymap.ts";

test("palette defaults use local Ctrl-P and Ctrl-N navigation", () => {
    const map = resolvePaletteKeymap();
    assert.equal(paletteKeyAction("\u0010", map), "moveUp");
    assert.equal(paletteKeyAction("\u000e", map), "moveDown");
    assert.equal(paletteKeyAction("\u001b[A", map), undefined);
    assert.match(paletteHelp(map), /ctrl\+p up.*ctrl\+n down/);
});

test("palette keymap validates actions, keys, required bindings, and collisions", () => {
    assert.throws(() => validatePaletteKeymapConfig({ unknown: ["x"] }), /unknown action/);
    assert.throws(() => validatePaletteKeymapConfig({ open: ["not-a-key"] }), /invalid key/);
    assert.throws(() => resolvePaletteKeymap({ moveUp: [] }), /required action moveUp/);
    assert.throws(() => resolvePaletteKeymap({ moveUp: ["ctrl+n"] }), /conflicts between moveUp, moveDown/);
});
