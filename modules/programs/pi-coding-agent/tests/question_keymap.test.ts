import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { detailedQuestionHelp, resolveQuestionKeymap, validateQuestionKeymapConfig } from "../extensions_src/utilities/decision_keymap.ts";
import { invalidKeyIds, validKeyIds } from "./key_grammar_cases.ts";

const manager = { getKeys(action: string) { return ({
    "tui.select.confirm": ["enter"], "tui.select.up": ["up"], "tui.select.down": ["down"],
    "tui.input.submit": ["enter"], "tui.input.newLine": ["shift+enter", "ctrl+j"],
} as Record<string, string[]>)[action] ?? []; } } as never;

void test("deployed question keymap satisfies the context and action grammar", () => {
    const config = JSON.parse(readFileSync(new URL("../extensions_src/utilities/question-keybindings.json", import.meta.url), "utf8"));
    assert.doesNotThrow(() => resolveQuestionKeymap(manager, config));
});

void test("overrides replace an action and generated help contains every key", () => {
    const map = resolveQuestionKeymap(manager, { "question.single": { "edit-note": ["alt+e", "ctrl+e"] } });
    const item = detailedQuestionHelp("question.single", map).find(entry => entry.action === "edit-note");
    assert.deepEqual(item?.keys, ["alt+e", "ctrl+e"]);
});

void test("question key validation preserves the shared key ID grammar", () => {
    for (const key of validKeyIds) assert.doesNotThrow(() => validateQuestionKeymapConfig({ "question.single": { accept: [key] } }));
    for (const key of invalidKeyIds) assert.throws(() => validateQuestionKeymapConfig({ "question.single": { accept: [key] } }), /invalid key/);
});

void test("configuration rejects unknown data, conflicts, and required action removal", () => {
    assert.throws(() => validateQuestionKeymapConfig({ "question.unknown": {} }), /unknown context/);
    assert.throws(() => validateQuestionKeymapConfig({ "question.single": { unknown: ["x"] } }), /unknown action/);
    assert.throws(() => validateQuestionKeymapConfig({ "question.single": { accept: ["not-a-key"] } }), /invalid key/);
    assert.throws(() => resolveQuestionKeymap(manager, { "question.single": { accept: ["e"] } }, "/tmp/question-keybindings.json"), /conflicts.*accept, edit-note/);
    assert.throws(() => resolveQuestionKeymap(manager, {
        "question.common": { cancel: ["ctrl+shift+x"] },
        "question.single": { accept: ["shift+ctrl+x"] },
    }), /conflicts.*cancel, accept/);
    assert.throws(() => resolveQuestionKeymap(manager, { "question.text": { accept: [] } }), /required action missing/);
});
