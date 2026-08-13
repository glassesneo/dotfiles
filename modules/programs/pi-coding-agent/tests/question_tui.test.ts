import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { DecisionComponent, runTuiDecisionFlow } from "../extensions_src/utilities/decision_tui.ts";
import type { DecisionFlowPolicy, QuestionItem, QuestionResultDetails } from "../extensions_src/utilities/decision_core.ts";

const theme = {
    fg(_color: string, text: string) { return text; },
    bg(_color: string, text: string) { return text; },
    bold(text: string) { return text; },
} as Theme;
const manager = { getKeys(action: string) { return ({
    "tui.select.confirm": ["enter"], "tui.select.up": ["up"], "tui.select.down": ["down"],
    "tui.input.submit": ["enter"], "tui.input.newLine": ["shift+enter", "ctrl+j"],
} as Record<string, string[]>)[action] ?? []; } } as never;
const keys = { down: "\u001b[B", up: "\u001b[A", tab: "\t", shiftTab: "\u001b[Z", enter: "\r", escape: "\u001b", space: " ", ctrlJ: "\n", ctrlC: "\u0003" };
const testKeymapConfig = {
    "question.common": { "next-question": ["tab"], "previous-question": ["shift+tab"], back: ["escape"], cancel: ["ctrl+c"] },
    "question.single": { "move-up": ["up", "k"], "move-down": ["down", "j"], toggle: ["space"], "select-and-note": ["e"], "write-in": ["w"] },
    "question.multi": { "move-up": ["up", "k"], "move-down": ["down", "j"], toggle: ["space"], "select-and-note": ["e"], "write-in": ["w"] },
    "question.review": { "move-up": ["up", "k"], "move-down": ["down", "j"] },
    "question.text": { newline: ["ctrl+j"] },
    "question.note": { newline: ["ctrl+j"], clear: ["ctrl+c"], cancel: [] },
    "question.write-in": { newline: ["ctrl+j"], clear: ["ctrl+c"], cancel: [] },
};
const single: QuestionItem = { id: "single", prompt: "Choose one", kind: "single", options: [{ value: "a", label: "Alpha", description: "First option" }, { value: "b", label: "Beta" }] };

function harness(questions: readonly QuestionItem[], signal?: AbortSignal, policy?: DecisionFlowPolicy, renderedTheme: Theme = theme) {
    const results: QuestionResultDetails[] = [];
    const tui = { terminal: { rows: 24, columns: 80 }, requestRender() {} } as TUI;
    const component = new DecisionComponent({ tui, theme: renderedTheme, keybindings: manager, keymapConfig: testKeymapConfig, questions, policy, signal, done: result => { results.push(result); } });
    component.focused = true;
    return { component, results };
}

void test("Tab navigation preserves text drafts and Shift-Tab moves backward", () => {
    const h = harness([{ id: "text", prompt: "Details", kind: "text" }, single]);
    h.component.handleInput("draft"); h.component.handleInput(keys.tab); h.component.handleInput(keys.shiftTab);
    assert.match(h.component.render(80).join("\n"), /draft/);
});

void test("Enter confirms text while Ctrl-J inserts a newline", () => {
    const h = harness([{ id: "text", prompt: "Details", kind: "text" }]);
    h.component.handleInput(keys.enter);
    assert.equal(h.results.length, 0);
    h.component.handleInput("a"); h.component.handleInput(keys.ctrlJ); h.component.handleInput("b"); h.component.handleInput(keys.enter); h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.responses.text, { kind: "text", value: "a\nb" });
});

void test("the configured select-and-note key commits a single response after save", () => {
    const h = harness([single]);
    h.component.handleInput(keys.down); h.component.handleInput("e"); h.component.handleInput("why"); h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.responses.single, { kind: "single", value: "b", note: "why" });
});

void test("single Space draft commits on Tab navigation", () => {
    const h = harness([single, { ...single, id: "other", prompt: "Other" }]);
    h.component.handleInput(keys.space); h.component.handleInput(keys.tab); h.component.handleInput(keys.shiftTab);
    h.component.handleInput(keys.tab); h.component.handleInput(keys.tab);
    assert.equal(h.results.length, 0);
});

void test("write-in action creates an answered single response", () => {
    const h = harness([single]);
    h.component.handleInput("w");
    h.component.handleInput("none fit");
    h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.responses.single, { kind: "write-in", value: "none fit" });
});

void test("write-in cancel preserves the complete existing draft", () => {
    const h = harness([single]);
    h.component.handleInput(keys.space);
    h.component.handleInput("w");
    h.component.handleInput("discard");
    h.component.handleInput(keys.escape);
    h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.responses.single, { kind: "single", value: "a" });
});

void test("editing an unselected regular option selects it and advances", () => {
    const h = harness([single, { ...single, id: "other", prompt: "Other" }]);
    h.component.handleInput("e");
    h.component.handleInput("because Alpha");
    h.component.handleInput(keys.enter);
    h.component.handleInput(keys.tab);
    h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.responses.single, { kind: "single", value: "a", note: "because Alpha" });
});

void test("cancelled note edits restore state while blank optional notes select", () => {
    const cancelled = harness([single]);
    cancelled.component.handleInput("e");
    cancelled.component.handleInput("discard");
    cancelled.component.handleInput(keys.escape);
    cancelled.component.handleInput(keys.enter);
    assert.deepEqual(cancelled.results[0]?.responses.single, { kind: "single", value: "a" });

    const blank = harness([single]);
    blank.component.handleInput("e");
    blank.component.handleInput("   ");
    blank.component.handleInput(keys.enter);
    assert.deepEqual(blank.results[0]?.responses.single, { kind: "single", value: "a" });
});

void test("required and blank notes follow decision policy", () => {
    const required = harness([single], undefined, {
        noteRequirement: (_item, option) => option?.value === "b" ? "required" : "none",
    });
    required.component.handleInput(keys.down);
    required.component.handleInput(keys.enter);
    assert.equal(required.results.length, 0);
    required.component.handleInput("why");
    required.component.handleInput(keys.enter);
    assert.deepEqual(required.results[0]?.responses.single, { kind: "single", value: "b", note: "why" });

    const disabled = harness([single], undefined, {
        noteRequirement: () => "none",
    });
    disabled.component.handleInput("e");
    disabled.component.handleInput(keys.enter);
    assert.deepEqual(disabled.results[0]?.responses.single, { kind: "single", value: "a" });
});

void test("public noteRequired drives contextual accept and generated semantic hints", () => {
    const question: QuestionItem = { id: "required", prompt: "Choose", kind: "single", options: [{ value: "a", label: "A", noteRequired: true }, { value: "b", label: "B" }] };
    const h = harness([question]);
    h.component.handleInput(keys.enter);
    h.component.handleInput("   ");
    h.component.handleInput(keys.enter);
    assert.equal(h.results.length, 0);
    h.component.handleInput(keys.ctrlC);
    h.component.handleInput("why");
    h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.responses.required, { kind: "single", value: "a", note: "why" });
});

void test("multi contextual accept selects a required-note option before commit", () => {
    const question: QuestionItem = { id: "multi-required", prompt: "Many", kind: "multi", options: [{ value: "a", label: "A", noteRequired: true }, { value: "b", label: "B" }] };
    const h = harness([question]);
    h.component.handleInput(keys.enter);
    h.component.handleInput("why");
    h.component.handleInput(keys.enter);
    assert.equal(h.results.length, 0);
    h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.responses["multi-required"], { kind: "multi", values: [{ value: "a", note: "why" }] });
});

void test("multi write-in preserves selections, supports deletion, and Ctrl-C clears", () => {
    const question: QuestionItem = { id: "multi-write", prompt: "Many", kind: "multi", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] };
    const h = harness([question]);
    h.component.handleInput(keys.space);
    h.component.handleInput("w");
    h.component.handleInput("extra");
    h.component.handleInput(keys.ctrlC);
    h.component.handleInput("replacement");
    h.component.handleInput(keys.enter);
    h.component.handleInput("w");
    h.component.handleInput(keys.ctrlC);
    h.component.handleInput(keys.enter);
    h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.responses["multi-write"], { kind: "multi", values: [{ value: "a" }] });
});

void test("multi uses Space and stores notes on selected options", () => {
    const question: QuestionItem = { id: "multi", prompt: "Many", kind: "multi", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] };
    const h = harness([question]);
    h.component.handleInput(keys.enter); assert.equal(h.results.length, 0);
    h.component.handleInput(keys.space);
    h.component.handleInput("e");
    h.component.handleInput("note A\nmore detail");
    h.component.handleInput(keys.enter);
    h.component.handleInput(keys.down); h.component.handleInput(keys.space); h.component.handleInput(keys.enter); h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.responses.multi, { kind: "multi", values: [{ value: "a", note: "note A\nmore detail" }, { value: "b" }] });
});

void test("multi clears a deselected option note before later re-selection", () => {
    const question: QuestionItem = { id: "multi", prompt: "Many", kind: "multi", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] };
    const h = harness([question]);
    h.component.handleInput(keys.space);
    h.component.handleInput("e");
    h.component.handleInput("note A");
    h.component.handleInput(keys.enter);
    h.component.handleInput(keys.space);
    h.component.handleInput(keys.down);
    h.component.handleInput(keys.up);
    h.component.handleInput(keys.space);
    h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.responses.multi, { kind: "multi", values: [{ value: "a" }] });
});

void test("configured alternate navigation keys move selection like Down and Up", () => {
    const down = harness([single]);
    down.component.handleInput("j"); down.component.handleInput(keys.enter); down.component.handleInput(keys.enter);
    assert.deepEqual(down.results[0]?.responses.single, { kind: "single", value: "b" });

    const up = harness([single]);
    up.component.handleInput("j"); up.component.handleInput("k"); up.component.handleInput(keys.enter); up.component.handleInput(keys.enter);
    assert.deepEqual(up.results[0]?.responses.single, { kind: "single", value: "a" });
});

void test("last-question Tab opens review and submits untouched questions", () => {
    const h = harness([single, { id: "text", prompt: "Details", kind: "text" }]);
    h.component.handleInput(keys.tab); h.component.handleInput("draft"); h.component.handleInput(keys.tab);
    const review = h.component.render(80).join("\n");
    assert.match(review, /Choose one/);
    assert.match(review, /Details/);
    h.component.handleInput(keys.down); h.component.handleInput(keys.down); h.component.handleInput(keys.enter);
    assert.match(h.component.render(80).join("\n"), /draft/);
    h.component.handleInput(keys.escape); h.component.handleInput(keys.up); h.component.handleInput(keys.up); h.component.handleInput(keys.enter);
    assert.deepEqual(h.results, [{ status: "submitted", responses: { text: { kind: "text", value: "draft" } } }]);
});

void test("review j/k navigation and hybrid return focus follow response state", () => {
    const questions: QuestionItem[] = [
        { ...single, id: "one", prompt: "One" },
        { ...single, id: "two", prompt: "Two" },
        { ...single, id: "three", prompt: "Three" },
    ];
    const h = harness(questions);
    h.component.handleInput(keys.enter);
    h.component.handleInput(keys.tab); h.component.handleInput(keys.tab);
    h.component.handleInput("j"); h.component.handleInput("j");
    h.component.handleInput(keys.enter); h.component.handleInput(keys.enter);
    assert.match(h.component.render(80).join("\n"), /Three/);
    h.component.handleInput(keys.enter); h.component.handleInput(keys.enter);
    assert.equal(h.results.length, 0);
    h.component.handleInput(keys.enter);
    assert.equal(Object.keys(h.results[0]?.responses ?? {}).length, 3);

    const revision = harness(questions.slice(0, 2));
    revision.component.handleInput(keys.enter); revision.component.handleInput(keys.tab);
    revision.component.handleInput("j"); revision.component.handleInput(keys.enter);
    revision.component.handleInput(keys.down); revision.component.handleInput(keys.enter);
    assert.match(revision.component.render(80).join("\n"), /One/);
    revision.component.handleInput(keys.enter); revision.component.handleInput(keys.escape);
    assert.match(revision.component.render(80).join("\n"), /One/);
});

void test("Esc backs out without cancelling; Ctrl-C cancels the entire call", () => {
    const h = harness([single]);
    h.component.handleInput(keys.escape); assert.equal(h.results.length, 0);
    h.component.handleInput(keys.ctrlC);
    assert.deepEqual(h.results, [{ status: "cancelled", responses: {}, currentQuestionId: "single" }]);
});

void test("artifact policy ignores the write-in action", () => {
    const approval: QuestionItem = {
        id: "artifact-action",
        prompt: "Review",
        kind: "single",
        options: [
            { value: "approve", label: "Approve" },
            { value: "reject", label: "Reject" },
        ],
    };
    const h = harness([approval], undefined, {
        allowWriteIn: false,
        noteRequirement: (_item, option) => option?.value === "reject" ? "none" : "optional",
    });
    h.component.handleInput(keys.down);
    h.component.handleInput("w");
    h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.responses[approval.id], { kind: "single", value: "reject" });
});

void test("render output never exceeds narrow widths", () => {
    const h = harness([{ ...single, prompt: "A deliberately long question that must wrap" }]);
    for (const width of [20, 8, 4, 1]) for (const line of h.component.render(width)) assert.ok(visibleWidth(line) <= width);

    const multi = harness([{ id: "narrow-multi", prompt: "Many choices", kind: "multi", options: [{ value: "a", label: "A long option" }, { value: "b", label: "B long option" }] }]);
    multi.component.handleInput(keys.down);
    multi.component.handleInput(keys.down);
    for (const width of [20, 8, 4, 1]) for (const line of multi.component.render(width)) assert.ok(visibleWidth(line) <= width);
});

void test("completion, abort, and disposal remove listeners and finish once", () => {
    const controller = new AbortController(); const h = harness([single], controller.signal);
    assert.equal(getEventListeners(controller.signal, "abort").length, 1);
    h.component.handleInput(keys.enter); h.component.handleInput(keys.enter);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0); controller.abort(); assert.equal(h.results.length, 1);
    const other = new AbortController(); const disposed = harness([single], other.signal); disposed.component.dispose(); assert.equal(getEventListeners(other.signal, "abort").length, 0);
});

void test("TUI adapter injects the app keybinding manager", async () => {
    const result = await runTuiDecisionFlow({ ui: { async custom(factory) {
        let resolved: QuestionResultDetails | undefined;
        const component = await factory({ terminal: { rows: 24, columns: 80 }, requestRender() {} } as TUI, theme, manager, value => { resolved = value as QuestionResultDetails; });
        component.handleInput?.(keys.enter); component.handleInput?.(keys.enter); return resolved as never;
    } } }, [single]);
    assert.equal(result.status, "submitted");
});
