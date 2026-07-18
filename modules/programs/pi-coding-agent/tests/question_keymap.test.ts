import assert from "node:assert/strict";
import test from "node:test";
import { detailedQuestionHelp, resolveQuestionKeymap, resolveUiAction, validateQuestionKeymapConfig } from "../extensions/utilities/decision_keymap.ts";

const manager = { getKeys(action: string) { return ({
    "tui.select.confirm": ["enter"], "tui.select.up": ["up"], "tui.select.down": ["down"],
    "tui.input.submit": ["enter"], "tui.input.newLine": ["shift+enter", "ctrl+j"],
} as Record<string, string[]>)[action] ?? []; } } as never;

test("all contexts resolve expected defaults without retired question keys", () => {
    const map = resolveQuestionKeymap(manager);
    assert.equal(resolveUiAction("\r", "question.text", map), "accept");
    assert.equal(resolveUiAction("\n", "question.text", map), "newline");
    assert.equal(resolveUiAction("\u001b[Z", "question.single", map), "previous-question");
    assert.equal(resolveUiAction("k", "question.single", map), "move-up");
    assert.equal(resolveUiAction("j", "question.multi", map), "move-down");
    assert.equal(resolveUiAction("k", "question.review", map), "move-up");
    assert.equal(resolveUiAction("j", "question.review", map), "move-down");
    assert.equal(resolveUiAction("\u0010", "question.single", map), undefined);
    assert.equal(resolveUiAction("\u0004", "question.text", map), undefined);
    assert.equal(resolveUiAction("\u0003", "question.review", map), "cancel");
});

test("overrides replace an action and generated help contains every key", () => {
    const map = resolveQuestionKeymap(manager, { "question.single": { "edit-note": ["alt+e", "ctrl+e"] } });
    const item = detailedQuestionHelp("question.single", map).find(entry => entry.action === "edit-note");
    assert.deepEqual(item?.keys, ["alt+e", "ctrl+e"]);
});

test("configuration rejects unknown data, conflicts, and required action removal", () => {
    assert.throws(() => validateQuestionKeymapConfig({ "question.unknown": {} }), /unknown context/);
    assert.throws(() => validateQuestionKeymapConfig({ "question.single": { unknown: ["x"] } }), /unknown action/);
    assert.throws(() => validateQuestionKeymapConfig({ "question.single": { accept: ["not-a-key"] } }), /invalid key/);
    assert.throws(() => resolveQuestionKeymap(manager, { "question.single": { accept: ["e"] } }, "/tmp/question-keybindings.json"), /conflicts.*accept, edit-note/);
    assert.throws(() => resolveQuestionKeymap(manager, { "question.text": { accept: [] } }), /required action missing/);
});
