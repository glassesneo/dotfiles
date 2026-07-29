import assert from "node:assert/strict";
import test from "node:test";
import { paletteHelp, paletteKeyAction, resolvePaletteKeymap, validatePaletteKeymapConfig } from "../extensions_src/utilities/command_palette_keymap.ts";
import { invalidKeyIds, validKeyIds } from "./key_grammar_cases.ts";

void test("palette defaults use local Ctrl-P and Ctrl-N navigation with Left/Right tree actions", () => {
    const map = resolvePaletteKeymap();
    assert.equal(paletteKeyAction("\u0010", map), "moveUp");
    assert.equal(paletteKeyAction("\u000e", map), "moveDown");
    assert.equal(paletteKeyAction("\u001b[D", map), "collapse");
    assert.equal(paletteKeyAction("\u001b[C", map), "expand");
    assert.equal(paletteKeyAction("\u001b[A", map), undefined);
    assert.match(paletteHelp(map), /ctrl\+p up.*ctrl\+n down/);
});

void test("palette key validation preserves the shared key ID grammar", () => {
    for (const key of validKeyIds) assert.doesNotThrow(() => validatePaletteKeymapConfig({ open: [key] }));
    for (const key of invalidKeyIds) assert.throws(() => validatePaletteKeymapConfig({ open: [key] }), /invalid key/);
});

void test("palette keymap validates actions, keys, required bindings, and collisions", () => {
    assert.throws(() => validatePaletteKeymapConfig({ unknown: ["x"] }), /unknown action/);
    assert.throws(() => validatePaletteKeymapConfig({ open: ["not-a-key"] }), /invalid key/);
    assert.throws(() => resolvePaletteKeymap({ moveUp: [] }), /required action moveUp/);
    assert.throws(() => resolvePaletteKeymap({ moveUp: ["ctrl+n"] }), /conflicts between moveUp, moveDown/);
    assert.throws(() => resolvePaletteKeymap({ moveUp: ["ctrl+shift+n"], moveDown: ["shift+ctrl+n"] }), /conflicts between moveUp, moveDown/);
    assert.throws(() => resolvePaletteKeymap({ collapse: ["enter"] }), /conflicts between/);
});
