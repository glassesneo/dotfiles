import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { QuestionComponent, runTuiQuestionFlow } from "../extensions/question_tui.ts";
import type { QuestionItem, QuestionResultDetails } from "../extensions/question_core.ts";

const theme = {
    fg(_color: string, text: string) {
        return text;
    },
} as Theme;

const keys = {
    down: "\u001b[B",
    up: "\u001b[A",
    left: "\u001b[D",
    right: "\u001b[C",
    tab: "\t",
    enter: "\r",
    escape: "\u001b",
    space: " ",
    ctrlP: "\u0010",
    ctrlD: "\u0004",
    ctrlC: "\u0003",
};

const single: QuestionItem = {
    id: "single",
    prompt: "Choose one",
    kind: "single",
    options: [
        { value: "a", label: "Alpha", description: "First option" },
        { value: "b", label: "Beta" },
    ],
    notePlaceholder: "Add an optional constraint",
};

function harness(questions: readonly QuestionItem[], signal?: AbortSignal) {
    const results: QuestionResultDetails[] = [];
    let renders = 0;
    const tui = {
        terminal: { rows: 24, columns: 80 },
        requestRender() {
            renders += 1;
        },
    } as TUI;
    const component = new QuestionComponent({
        tui,
        theme,
        questions,
        signal,
        done: result => results.push(result),
    });
    component.focused = true;
    return { component, results, get renders() { return renders; } };
}

test("tabs show status, navigation wraps, drafts survive, and revised answers overwrite", () => {
    const questions: QuestionItem[] = [
        single,
        { id: "text", prompt: "Details", kind: "text" },
    ];
    const h = harness(questions);
    assert.match(h.component.render(80).join("\n"), />\[ \]Q1.*\[ \]Q2.*locked.*Confirm/);

    h.component.handleInput(keys.left);
    h.component.handleInput("draft");
    h.component.handleInput(keys.tab);
    h.component.handleInput(keys.right);
    h.component.handleInput(keys.right);
    assert.match(h.component.render(80).join("\n"), /draft/);
    h.component.handleInput(keys.tab);
    h.component.handleInput(keys.ctrlD);

    h.component.handleInput(keys.enter);
    assert.match(h.component.render(80).join("\n"), /ready.*Confirm/);
    h.component.handleInput(keys.left);
    h.component.handleInput(keys.tab);
    h.component.handleInput(keys.left);
    h.component.handleInput(keys.down);
    h.component.handleInput(keys.enter);
    h.component.handleInput(keys.enter);

    assert.deepEqual(h.results, [{
        status: "answered",
        answers: {
            single: { kind: "single", value: "b" },
            text: { kind: "text", value: "draft" },
        },
    }]);
    assert.ok(h.renders > 0);
});

test("note Tab saves multiline text while Escape discards only the current edit", () => {
    const h = harness([single]);
    h.component.handleInput(keys.down);
    h.component.handleInput(keys.tab);
    h.component.handleInput("line one");
    h.component.handleInput(keys.enter);
    h.component.handleInput("line two");
    h.component.handleInput(keys.tab);
    assert.match(h.component.render(80).join("\n"), /Beta \(note saved\)/);

    h.component.handleInput(keys.tab);
    h.component.handleInput(" discarded");
    h.component.handleInput(keys.escape);
    h.component.handleInput(keys.enter);
    h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.answers.single, {
        kind: "single",
        value: "b",
        note: "line one\nline two",
    });
});

test("multi toggles with Space, requires a selection, and keeps definition order", () => {
    const question: QuestionItem = {
        id: "multi",
        prompt: "Choose many",
        kind: "multi",
        options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
            { value: "c", label: "C" },
        ],
    };
    const h = harness([question]);
    h.component.handleInput(keys.enter);
    assert.match(h.component.render(80).join("\n"), /Select at least one/);
    h.component.handleInput(keys.down);
    h.component.handleInput(keys.down);
    h.component.handleInput(keys.space);
    h.component.handleInput(keys.ctrlP);
    h.component.handleInput(keys.ctrlP);
    h.component.handleInput(keys.tab);
    h.component.handleInput("note A");
    h.component.handleInput(keys.tab);
    h.component.handleInput(keys.enter);
    h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.answers.multi, {
        kind: "multi",
        values: [{ value: "a", note: "note A" }, { value: "c" }],
    });
});

test("text Tab changes mode, Enter inserts newlines, and blank Ctrl-D validates", () => {
    const h = harness([{ id: "text", prompt: "Details", kind: "text" }]);
    assert.equal(h.component.focused, true);
    h.component.handleInput(keys.ctrlD);
    assert.match(h.component.render(80).join("\n"), /non-blank/);
    h.component.handleInput("a");
    h.component.handleInput(keys.enter);
    h.component.handleInput("b");
    h.component.handleInput(keys.tab);
    assert.match(h.component.render(80).join("\n"), /draft saved/);
    h.component.handleInput(keys.tab);
    h.component.handleInput(keys.ctrlD);
    h.component.handleInput(keys.enter);
    assert.deepEqual(h.results[0]?.answers.text, { kind: "text", value: "a\nb" });
});

test("question and review cancellation report different current-question contexts", () => {
    const questionCancelled = harness([single]);
    questionCancelled.component.handleInput(keys.escape);
    assert.deepEqual(questionCancelled.results, [{
        status: "cancelled",
        answers: {},
        currentQuestionId: "single",
    }]);

    const reviewCancelled = harness([single]);
    reviewCancelled.component.handleInput(keys.enter);
    reviewCancelled.component.handleInput(keys.escape);
    assert.deepEqual(reviewCancelled.results, [{
        status: "cancelled",
        answers: { single: { kind: "single", value: "a" } },
    }]);
});

test("render output never exceeds narrow component widths", () => {
    const h = harness([{ ...single, prompt: "A deliberately long question that must wrap" }]);
    for (const width of [20, 8, 4, 1]) {
        for (const line of h.component.render(width)) {
            assert.ok(visibleWidth(line) <= width, `${JSON.stringify(line)} exceeded width ${width}`);
        }
    }
});

test("completion, abort, and disposal remove listeners and done runs once", () => {
    const controller = new AbortController();
    const completed = harness([single], controller.signal);
    assert.equal(getEventListeners(controller.signal, "abort").length, 1);
    completed.component.handleInput(keys.enter);
    completed.component.handleInput(keys.enter);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    controller.abort();
    assert.equal(completed.results.length, 1);

    const abortedController = new AbortController();
    const aborted = harness([single], abortedController.signal);
    abortedController.abort();
    assert.equal(aborted.results.length, 1);
    assert.equal(getEventListeners(abortedController.signal, "abort").length, 0);

    const disposedController = new AbortController();
    const disposed = harness([single], disposedController.signal);
    disposed.component.dispose();
    assert.equal(getEventListeners(disposedController.signal, "abort").length, 0);
});

test("TUI adapter uses one custom component through final confirmation", async () => {
    let calls = 0;
    const result = await runTuiQuestionFlow(
        {
            ui: {
                async custom(factory) {
                    calls += 1;
                    let resolved: QuestionResultDetails | undefined;
                    const component = await factory(
                        { terminal: { rows: 24, columns: 80 }, requestRender() {} } as TUI,
                        theme,
                        {} as never,
                        value => { resolved = value as QuestionResultDetails; },
                    );
                    component.handleInput?.(keys.enter);
                    component.handleInput?.(keys.enter);
                    component.dispose?.();
                    return resolved as never;
                },
            },
        },
        [single],
    );
    assert.equal(calls, 1);
    assert.equal(result.status, "answered");
});
