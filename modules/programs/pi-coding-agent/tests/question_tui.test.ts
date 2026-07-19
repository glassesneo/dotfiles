import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { QuestionComponent, runTuiQuestionFlow } from "../extensions_src/utilities/decision_tui.ts";
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
const single: QuestionItem = { id: "single", prompt: "Choose one", kind: "single", options: [{ value: "a", label: "Alpha", description: "First option" }, { value: "b", label: "Beta" }] };

function harness(questions: readonly QuestionItem[], signal?: AbortSignal, policy?: DecisionFlowPolicy, renderedTheme: Theme = theme) {
    const results: QuestionResultDetails[] = []; let renders = 0;
    const tui = { terminal: { rows: 24, columns: 80 }, requestRender() { renders += 1; } } as TUI;
    const component = new QuestionComponent({ tui, theme: renderedTheme, keybindings: manager, questions, policy, signal, done: result => { results.push(result); } });
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

test("single uses radio markers and Space selects a draft without confirming", () => {
    const h = harness([single]);
    assert.match(h.component.render(80).join("\n"), /> \( \) Alpha/);
    h.component.handleInput(keys.space);
    assert.equal(h.results.length, 0);
    assert.match(h.component.render(80).join("\n"), /> \(●\) Alpha/);
    h.component.handleInput(keys.down); h.component.handleInput(keys.space);
    const selected = h.component.render(80).join("\n");
    assert.match(selected, /  \( \) Alpha/);
    assert.match(selected, /> \(●\) Beta/);
    h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.answers.single, { kind: "single", value: "b" });
});

test("single Space draft survives navigation but remains unanswered", () => {
    const h = harness([single, { ...single, id: "other", prompt: "Other" }]);
    h.component.handleInput(keys.space); h.component.handleInput(keys.tab); h.component.handleInput(keys.shiftTab);
    assert.match(h.component.render(80).join("\n"), /> \(●\) Alpha/);
    h.component.handleInput(keys.tab); h.component.handleInput(keys.tab);
    assert.match(h.component.render(80).join("\n"), /0 answered, 2 unanswered/);
});

test("saving per-option notes selects their single or multi target without confirming", () => {
    const singleNote: QuestionItem = { ...single, note: { mode: "per-option" } };
    const one = harness([singleNote]);
    one.component.handleInput(keys.down); one.component.handleInput("e"); one.component.handleInput("why B"); one.component.handleInput(keys.enter);
    assert.equal(one.results.length, 0);
    assert.match(one.component.render(80).join("\n"), /> \(●\) Beta — Note: why B/);
    one.component.handleInput(keys.enter);
    assert.deepEqual(one.results[0]?.answers.single, { kind: "single", value: "b", note: "why B" });

    const review = harness([singleNote, { ...single, id: "other", prompt: "Other" }]);
    review.component.handleInput(keys.down); review.component.handleInput("e"); review.component.handleInput("review note"); review.component.handleInput(keys.enter); review.component.handleInput(keys.enter);
    review.component.handleInput(keys.tab); review.component.handleInput(keys.down); review.component.handleInput(keys.enter);
    assert.match(review.component.render(80).join("\n"), /> \(●\) Beta — Note: review note/);

    const multi: QuestionItem = { id: "multi", prompt: "Many", kind: "multi", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], note: { mode: "per-option" } };
    const many = harness([multi]);
    many.component.handleInput("e"); many.component.handleInput("note A"); many.component.handleInput(keys.enter);
    assert.equal(many.results.length, 0);
    assert.match(many.component.render(80).join("\n"), /> \[x\] A — Note: note A/);
});

test("discarded and blank per-option notes do not select a new target", () => {
    const question: QuestionItem = { ...single, note: { mode: "per-option" } };
    const discarded = harness([question]);
    discarded.component.handleInput("e"); discarded.component.handleInput("discard"); discarded.component.handleInput(keys.escape);
    assert.match(discarded.component.render(80).join("\n"), /> \( \) Alpha/);
    assert.doesNotMatch(discarded.component.render(80).join("\n"), /discard/);

    const blank = harness([question]);
    blank.component.handleInput("e"); blank.component.handleInput("   "); blank.component.handleInput(keys.enter);
    assert.match(blank.component.render(80).join("\n"), /> \( \) Alpha/);

    const required = harness([question], undefined, { noteRequirement: () => "required" });
    required.component.handleInput("e"); required.component.handleInput("   "); required.component.handleInput(keys.enter);
    assert.match(required.component.render(80).join("\n"), /Error: Note must contain non-whitespace text/);
    assert.doesNotMatch(required.component.render(80).join("\n"), /\(●\)/);
});

test("Esc discards the current note edit and confirm y/n commit immediately", () => {
    const confirm: QuestionItem = { id: "ok", prompt: "Proceed?", kind: "confirm" };
    const h = harness([confirm]);
    const initial = h.component.render(80).join("\n");
    assert.match(initial, /> \( \) Yes/);
    assert.match(initial, /  \( \) No/);
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

test("a single question omits review and submits directly", () => {
    const answered = harness([single]);
    assert.doesNotMatch(answered.component.render(80).join("\n"), /\[Review/);
    answered.component.handleInput(keys.down);
    answered.component.handleInput(keys.enter);
    assert.deepEqual(answered.results, [{
        status: "answered",
        answers: { single: { kind: "single", value: "b" } },
    }]);

    const unanswered = harness([single]);
    unanswered.component.handleInput(keys.tab);
    assert.deepEqual(unanswered.results, [{ status: "answered", answers: {} }]);
});

test("required and disabled option notes follow decision policy", () => {
    const required = harness([single], undefined, {
        noteRequirement: (_item, option) => option?.value === "b" ? "required" : "none",
    });
    required.component.handleInput(keys.down);
    required.component.handleInput(keys.enter);
    assert.match(required.component.render(80).join("\n"), /Required note/);
    required.component.handleInput("why");
    required.component.handleInput(keys.enter);
    assert.deepEqual(required.results[0]?.answers.single, { kind: "single", value: "b", note: "why" });

    const disabled = harness([single], undefined, {
        noteRequirement: () => "none",
    });
    disabled.component.handleInput("e");
    assert.doesNotMatch(disabled.component.render(80).join("\n"), /Optional note for/);
    disabled.component.handleInput(keys.enter);
    assert.deepEqual(disabled.results[0]?.answers.single, { kind: "single", value: "a" });
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

test("render applies semantic theme roles and refreshes themed output after invalidation", () => {
    const calls = { fg: new Set<string>(), bg: new Set<string>(), bold: 0 };
    let version = 31;
    const recordingTheme = {
        fg(color: string, text: string) { calls.fg.add(color); return `\u001b[${version}m${text}\u001b[39m`; },
        bg(color: string, text: string) { calls.bg.add(color); return `\u001b[4${version === 31 ? 1 : 4}m${text}\u001b[49m`; },
        bold(text: string) { calls.bold += 1; return `\u001b[1m${text}\u001b[22m`; },
    } as Theme;
    const h = harness([single, { ...single, id: "other", prompt: "Other" }], undefined, undefined, recordingTheme);
    h.component.handleInput(keys.space);
    h.component.render(80);
    h.component.handleInput(keys.tab); h.component.handleInput(keys.tab);
    h.component.render(80);
    h.component.handleInput(keys.down); h.component.handleInput(keys.enter); h.component.handleInput(keys.enter);
    const before = h.component.render(80).join("\n");
    version = 34;
    assert.equal(h.component.render(80).join("\n"), before);
    h.component.invalidate();
    const after = h.component.render(80).join("\n");
    assert.notEqual(before, after);
    assert.ok(["accent", "text", "muted", "dim", "success", "warning", "border"].every(token => calls.fg.has(token)));
    assert.ok(calls.bg.has("selectedBg"));
    assert.ok(calls.bold > 0);

    const editor = harness([{ id: "text", prompt: "Details", kind: "text" }], undefined, undefined, recordingTheme);
    editor.component.render(80);
    editor.component.handleInput(keys.enter);
    editor.component.render(80);
    assert.ok(calls.fg.has("borderAccent"));
    assert.ok(calls.fg.has("error"));
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
