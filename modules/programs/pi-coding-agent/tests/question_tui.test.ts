import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { QuestionComponent, runTuiQuestionFlow } from "../extensions/question_tui.ts";
import type { QuestionItem, QuestionResultDetails } from "../extensions/question_core.ts";

const theme = { fg(_color: string, text: string) { return text; } } as Theme;
const manager = { getKeys(action: string) { return ({
    "tui.select.confirm": ["enter"], "tui.select.up": ["up"], "tui.select.down": ["down"],
    "tui.input.submit": ["enter"], "tui.input.newLine": ["shift+enter", "ctrl+j"],
} as Record<string, string[]>)[action] ?? []; } } as never;
const keys = { down: "\u001b[B", up: "\u001b[A", tab: "\t", shiftTab: "\u001b[Z", enter: "\r", escape: "\u001b", space: " ", ctrlJ: "\n", ctrlC: "\u0003" };
const single: QuestionItem = { id: "single", prompt: "Choose one", kind: "single", options: [{ value: "a", label: "Alpha", description: "First option" }, { value: "b", label: "Beta" }] };

function harness(questions: readonly QuestionItem[], signal?: AbortSignal) {
    const results: QuestionResultDetails[] = []; let renders = 0;
    const tui = { terminal: { rows: 24, columns: 80 }, requestRender() { renders += 1; } } as TUI;
    const component = new QuestionComponent({ tui, theme, keybindings: manager, questions, signal, done: result => { results.push(result); } });
    component.focused = true;
    return { component, results, get renders() { return renders; } };
}

test("Tab navigation preserves text drafts and Shift-Tab moves backward", () => {
    const h = harness([{ id: "text", prompt: "Details", kind: "text" }, single]);
    h.component.handleInput("draft"); h.component.handleInput(keys.tab); h.component.handleInput(keys.shiftTab);
    assert.match(h.component.render(80).join("\n"), /draft/);
    assert.match(h.component.render(80).join("\n"), /\[1 ●\].*\[2 ○\].*Review/);
});

test("Enter confirms text while Ctrl-J inserts a newline", () => {
    const h = harness([{ id: "text", prompt: "Details", kind: "text" }]);
    h.component.handleInput(keys.enter);
    assert.match(h.component.render(80).join("\n"), /non-whitespace/);
    h.component.handleInput("a"); h.component.handleInput(keys.ctrlJ); h.component.handleInput("b"); h.component.handleInput(keys.enter); h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.answers.text, { kind: "text", value: "a\nb" });
});

test("e edits an answer note without changing the focused answer", () => {
    const h = harness([single]);
    h.component.handleInput(keys.down); h.component.handleInput("e"); h.component.handleInput("why"); h.component.handleInput(keys.enter);
    assert.match(h.component.render(80).join("\n"), /Note: why/);
    h.component.handleInput(keys.enter); h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.answers.single, { kind: "single", value: "b", note: "why" });
});

test("Esc discards the current note edit and confirm y/n commit immediately", () => {
    const confirm: QuestionItem = { id: "ok", prompt: "Proceed?", kind: "confirm" };
    const h = harness([confirm]);
    h.component.handleInput("e"); h.component.handleInput("discard me"); h.component.handleInput(keys.escape);
    h.component.handleInput("n"); h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.answers.ok, { kind: "confirm", value: false });
});

test("multi uses Space and stores per-option notes only in selected values", () => {
    const question: QuestionItem = { id: "multi", prompt: "Many", kind: "multi", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], note: { mode: "per-option" } };
    const h = harness([question]);
    h.component.handleInput(keys.enter); assert.match(h.component.render(80).join("\n"), /Select at least one/);
    h.component.handleInput(keys.space); h.component.handleInput("e"); h.component.handleInput("note A\nmore detail"); h.component.handleInput(keys.enter);
    assert.match(h.component.render(80).join("\n"), /A — Note: note A/);
    assert.doesNotMatch(h.component.render(80).join("\n"), /more detail/);
    h.component.handleInput(keys.down); h.component.handleInput(keys.space); h.component.handleInput(keys.enter); h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.answers.multi, { kind: "multi", values: [{ value: "a", note: "note A\nmore detail" }, { value: "b" }] });
});

test("j and k move selection like Down and Up", () => {
    const down = harness([single]);
    down.component.handleInput("j"); down.component.handleInput(keys.enter); down.component.handleInput(keys.enter);
    assert.deepEqual(down.results[0]?.answers.single, { kind: "single", value: "b" });

    const up = harness([single]);
    up.component.handleInput("j"); up.component.handleInput("k"); up.component.handleInput(keys.enter); up.component.handleInput(keys.enter);
    assert.deepEqual(up.results[0]?.answers.single, { kind: "single", value: "a" });
});

test("last-question Tab opens review and submits unanswered questions", () => {
    const h = harness([single, { id: "text", prompt: "Details", kind: "text" }]);
    h.component.handleInput(keys.tab); h.component.handleInput("draft"); h.component.handleInput(keys.tab);
    const review = h.component.render(80).join("\n");
    assert.match(review, /0 answered, 2 unanswered/);
    assert.match(review, /Q1 ○ Unanswered: Choose one/);
    assert.match(review, /Q2 ○ Unanswered: Details/);
    h.component.handleInput(keys.down); h.component.handleInput(keys.down); h.component.handleInput(keys.enter);
    assert.match(h.component.render(80).join("\n"), /draft/);
    h.component.handleInput(keys.escape); h.component.handleInput(keys.up); h.component.handleInput(keys.up); h.component.handleInput(keys.enter);
    assert.deepEqual(h.results, [{ status: "answered", answers: {} }]);
});

test("review reopens an answer and returns to review after confirmation", () => {
    const h = harness([single]);
    h.component.handleInput(keys.enter); // answer Alpha
    h.component.handleInput(keys.down); // question row
    h.component.handleInput(keys.enter); // edit
    h.component.handleInput(keys.down); h.component.handleInput(keys.enter); // answer Beta, return to Submit because all are answered
    h.component.handleInput(keys.enter); // Submit
    assert.deepEqual(h.results[0]?.answers.single, { kind: "single", value: "b" });
});

test("review j/k navigation and hybrid return focus follow answer state", () => {
    const questions: QuestionItem[] = [
        { ...single, id: "one", prompt: "One" },
        { ...single, id: "two", prompt: "Two" },
        { ...single, id: "three", prompt: "Three" },
    ];
    const h = harness(questions);
    h.component.handleInput(keys.enter); // Q1 answered, now Q2
    h.component.handleInput(keys.tab); h.component.handleInput(keys.tab); // Skip Q2/Q3 to Review
    h.component.handleInput("j"); h.component.handleInput("j"); // Q2 row
    h.component.handleInput(keys.enter); h.component.handleInput(keys.enter); // Newly answer Q2
    assert.match(h.component.render(80).join("\n"), /> Q3 ○ Unanswered: Three/); // Next unanswered
    h.component.handleInput(keys.enter); h.component.handleInput(keys.enter); // Answer Q3; all answered
    assert.match(h.component.render(80).join("\n"), /> Submit answers/);
    h.component.handleInput(keys.enter);
    assert.equal(Object.keys(h.results[0]?.answers ?? {}).length, 3);

    const revision = harness(questions.slice(0, 2));
    revision.component.handleInput(keys.enter); revision.component.handleInput(keys.tab); // Q1 answered, Q2 skipped
    revision.component.handleInput("j"); revision.component.handleInput(keys.enter); // Edit answered Q1
    revision.component.handleInput(keys.down); revision.component.handleInput(keys.enter);
    assert.match(revision.component.render(80).join("\n"), /> Q1 ✓ Answered: One/); // Preserve row
    revision.component.handleInput(keys.enter); revision.component.handleInput(keys.escape);
    assert.match(revision.component.render(80).join("\n"), /> Q1 ✓ Answered: One/); // Esc also preserves row
});

test("Esc backs out without cancelling; Ctrl-C cancels the entire call", () => {
    const h = harness([single]);
    h.component.handleInput(keys.escape); assert.equal(h.results.length, 0); assert.match(h.component.render(80).join("\n"), /Ctrl-C/);
    h.component.handleInput(keys.ctrlC);
    assert.deepEqual(h.results, [{ status: "cancelled", answers: {}, currentQuestionId: "single" }]);
});

test("render output never exceeds narrow widths", () => {
    const h = harness([{ ...single, prompt: "A deliberately long question that must wrap" }]);
    for (const width of [20, 8, 4, 1]) for (const line of h.component.render(width)) assert.ok(visibleWidth(line) <= width);
});

test("completion, abort, and disposal remove listeners and finish once", () => {
    const controller = new AbortController(); const h = harness([single], controller.signal);
    assert.equal(getEventListeners(controller.signal, "abort").length, 1);
    h.component.handleInput(keys.enter); h.component.handleInput(keys.enter);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0); controller.abort(); assert.equal(h.results.length, 1);
    const other = new AbortController(); const disposed = harness([single], other.signal); disposed.component.dispose(); assert.equal(getEventListeners(other.signal, "abort").length, 0);
});

test("TUI adapter injects the app keybinding manager", async () => {
    const result = await runTuiQuestionFlow({ ui: { async custom(factory) {
        let resolved: QuestionResultDetails | undefined;
        const component = await factory({ terminal: { rows: 24, columns: 80 }, requestRender() {} } as TUI, theme, manager, value => { resolved = value as QuestionResultDetails; });
        component.handleInput?.(keys.enter); component.handleInput?.(keys.enter); return resolved as never;
    } } }, [single]);
    assert.equal(result.status, "answered");
});
