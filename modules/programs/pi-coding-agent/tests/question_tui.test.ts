import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import {
    QuestionComponent,
    runTuiQuestionFlow,
} from "../extensions/question_tui.ts";
import type {
    PendingQuestionAnswer,
    QuestionItem,
} from "../extensions/question_core.ts";

const theme = {
    fg(_color: string, text: string) {
        return text;
    },
} as Theme;

const keys = {
    down: "\u001b[B",
    up: "\u001b[A",
    tab: "\t",
    enter: "\r",
    escape: "\u001b",
    space: " ",
    ctrlP: "\u0010",
    ctrlD: "\u0004",
};

function harness(question: QuestionItem, signal?: AbortSignal) {
    const results: Array<PendingQuestionAnswer | null> = [];
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
        question,
        questionIndex: 0,
        questionTotal: 1,
        signal,
        done: result => results.push(result),
    });
    return { component, results, get renders() { return renders; } };
}

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

test("single supports movement, note save, note re-edit, and confirmation", () => {
    const h = harness(single);
    h.component.handleInput(keys.down);
    h.component.handleInput(keys.tab);
    assert.match(
        h.component.render(80).join("\n"),
        /Add an optional constraint/,
    );
    h.component.handleInput("n");
    h.component.handleInput("o");
    h.component.handleInput("t");
    h.component.handleInput("e");
    h.component.handleInput(keys.enter);
    assert.match(h.component.render(80).join("\n"), /Beta note saved/);
    h.component.handleInput(keys.tab);
    h.component.handleInput(keys.escape);
    assert.match(h.component.render(80).join("\n"), /Beta note saved/);
    h.component.handleInput(keys.enter);
    assert.deepEqual(h.results, [
        { kind: "single", value: "b", note: "note" },
    ]);
    assert.ok(h.renders > 0);
});

test("multi toggles with Space, requires a selection, and orders values", () => {
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
    const empty = harness(question);
    empty.component.handleInput(keys.enter);
    assert.deepEqual(empty.results, []);
    assert.match(empty.component.render(80).join("\n"), /Select at least one/);

    const h = harness(question);
    h.component.handleInput(keys.down);
    h.component.handleInput(keys.down);
    h.component.handleInput(keys.space);
    h.component.handleInput(keys.ctrlP);
    h.component.handleInput(keys.ctrlP);
    h.component.handleInput(keys.tab);
    h.component.handleInput("A");
    h.component.handleInput(keys.enter);
    h.component.handleInput(keys.enter);
    assert.deepEqual(h.results, [
        {
            kind: "multi",
            values: [{ value: "a", note: "A" }, { value: "c", note: undefined }],
        },
    ]);
});

test("confirm Y/N changes focus and keeps No distinct from cancellation", () => {
    const h = harness({ id: "ok", prompt: "Proceed?", kind: "confirm" });
    h.component.handleInput("n");
    h.component.handleInput(keys.enter);
    assert.deepEqual(h.results, [
        { kind: "confirm", value: false, note: undefined },
    ]);

    const cancelled = harness(single);
    cancelled.component.handleInput(keys.escape);
    cancelled.component.handleInput(keys.enter);
    assert.deepEqual(cancelled.results, [null]);
});

test("text preserves newlines, validates blanks, and submits with Ctrl-D", () => {
    const blank = harness({ id: "text", prompt: "Details", kind: "text" });
    blank.component.handleInput(keys.ctrlD);
    assert.deepEqual(blank.results, []);
    assert.match(blank.component.render(80).join("\n"), /non-blank/);

    const h = harness({ id: "text", prompt: "Details", kind: "text" });
    h.component.handleInput("a");
    h.component.handleInput(keys.enter);
    h.component.handleInput("b");
    h.component.handleInput(keys.ctrlD);
    assert.deepEqual(h.results, [{ kind: "text", value: "a\nb" }]);
});

test("render output never exceeds narrow component widths", () => {
    const h = harness({
        ...single,
        prompt: "A deliberately long question that must wrap in a narrow terminal",
    });
    for (const width of [20, 8, 4, 1]) {
        for (const line of h.component.render(width)) {
            assert.ok(
                visibleWidth(line) <= width,
                `${JSON.stringify(line)} exceeded width ${width}`,
            );
        }
    }
});

test("completion and abort remove the abort listener and done runs once", () => {
    const controller = new AbortController();
    const completed = harness(single, controller.signal);
    assert.equal(getEventListeners(controller.signal, "abort").length, 1);
    completed.component.handleInput(keys.enter);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    controller.abort();
    assert.equal(completed.results.length, 1);

    const abortedController = new AbortController();
    const aborted = harness(single, abortedController.signal);
    abortedController.abort();
    assert.deepEqual(aborted.results, [null]);
    assert.equal(getEventListeners(abortedController.signal, "abort").length, 0);
});

test("TUI adapter advances one custom screen at a time", async () => {
    const questions: QuestionItem[] = [
        single,
        { id: "text", prompt: "Details", kind: "text" },
    ];
    const scripted: PendingQuestionAnswer[] = [
        { kind: "single", value: "a" },
        { kind: "text", value: "answer" },
    ];
    let calls = 0;
    const result = await runTuiQuestionFlow(
        {
            ui: {
                async custom(factory) {
                    calls += 1;
                    let resolved: PendingQuestionAnswer | null | undefined;
                    const component = await factory(
                        {
                            terminal: { rows: 24, columns: 80 },
                            requestRender() {},
                        } as TUI,
                        theme,
                        {} as never,
                        value => {
                            resolved = value as PendingQuestionAnswer | null;
                        },
                    );
                    const next = scripted.shift();
                    assert.ok(next);
                    component.dispose?.();
                    resolved = next;
                    return resolved as never;
                },
            },
        },
        questions,
    );
    assert.equal(calls, 2);
    assert.deepEqual(result, {
        status: "answered",
        answers: {
            single: { kind: "single", value: "a" },
            text: { kind: "text", value: "answer" },
        },
    });
});
