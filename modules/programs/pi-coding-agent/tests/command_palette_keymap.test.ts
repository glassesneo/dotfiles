import assert from "node:assert/strict";
import test from "node:test";
import { loadPaletteKeymap, paletteActions, resolvePaletteKeymap, validatePaletteKeymapConfig } from "../extensions_src/utilities/command_palette_keymap.ts";
import { invalidKeyIds, validKeyIds } from "./key_grammar_cases.ts";

void test("generated palette keymap satisfies the action contract", () => {
    const resolved = loadPaletteKeymap().keymap;
    assert.equal(paletteActions.length, 11);
    assert.deepEqual(resolved.moveUp, ["ctrl+p"]);
    assert.deepEqual(resolved.moveDown, ["ctrl+n"]);
    assert.deepEqual(resolved.collapse, ["left"]);
    assert.deepEqual(resolved.expand, ["right"]);
    assert.deepEqual(resolved.refresh, []);
});

void test("palette key validation preserves the shared key ID grammar", () => {
    for (const key of validKeyIds) assert.doesNotThrow(() => validatePaletteKeymapConfig({ open: [key] }));
    for (const key of invalidKeyIds) assert.throws(() => validatePaletteKeymapConfig({ open: [key] }), /invalid key/);
});

void test("palette keymap validates actions, keys, required bindings, and collisions", () => {
    assert.throws(() => validatePaletteKeymapConfig({ unknown: ["x"] }), /unknown action/);
    assert.throws(() => validatePaletteKeymapConfig({ open: ["not-a-key"] }), /invalid key/);
    assert.throws(() => resolvePaletteKeymap({ moveUp: [] }, "test", ["moveUp"]), /required action moveUp/);
    assert.throws(() => resolvePaletteKeymap({ moveUp: ["ctrl+n"] }), /conflicts between moveUp, moveDown/);
    assert.throws(() => resolvePaletteKeymap({ moveUp: ["ctrl+shift+n"], moveDown: ["shift+ctrl+n"] }), /conflicts between moveUp, moveDown/);
    assert.throws(() => resolvePaletteKeymap({ collapse: ["enter"] }), /conflicts between/);
});
