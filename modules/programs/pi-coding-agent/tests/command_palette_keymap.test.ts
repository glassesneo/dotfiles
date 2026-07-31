import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolvePaletteKeymap, validatePaletteKeymapConfig } from "../extensions_src/utilities/command_palette_keymap.ts";
import { invalidKeyIds, validKeyIds } from "./key_grammar_cases.ts";

void test("deployed palette keymap satisfies the action grammar", () => {
    const config = JSON.parse(readFileSync(new URL("../extensions_src/utilities/command-palette-keybindings.json", import.meta.url), "utf8"));
    assert.doesNotThrow(() => resolvePaletteKeymap(config));
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
