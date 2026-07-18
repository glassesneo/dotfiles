import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { runStandardQuestionFlow } from "../extensions/question_standard_ui.ts";
import type { QuestionItem } from "../extensions/question_core.ts";

type UI = Pick<ExtensionUIContext, "select" | "input" | "editor" | "notify">;

function scriptedUI(script: Array<string | undefined>) {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const next = () => script.shift();
    const ui: UI = {
        async select(...args) {
            calls.push({ method: "select", args });
            return next();
        },
        async input(...args) {
            calls.push({ method: "input", args });
            return next();
        },
        async editor(...args) {
            calls.push({ method: "editor", args });
            return next();
        },
        notify(...args) {
            calls.push({ method: "notify", args });
        },
    };
    return { ui, calls, remaining: script };
}

const allKinds: QuestionItem[] = [
    {
        id: "one",
        prompt: "One?",
        kind: "single",
        options: [
            { value: "a", label: "A", description: "First" },
            { value: "b", label: "B" },
        ],
        notePlaceholder: "Why?",
    },
    {
        id: "many",
        prompt: "Many?",
        kind: "multi",
        options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
            { value: "c", label: "C" },
        ],
    },
    { id: "text", prompt: "Details?", kind: "text", initialValue: "initial" },
    { id: "ok", prompt: "Proceed?", kind: "confirm" },
];

test("standard UI answers all kinds, reviews, and explicitly submits", async () => {
    const mock = scriptedUI([
        "[ ] A — First",
        "single note",
        "[ ] C",
        "[ ] A",
        "Done — confirm selections",
        "note A",
        "note C",
        "line 1\nline 2",
        "[ ] No",
        "not now",
        "Submit answers",
    ]);

    assert.deepEqual(await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, allKinds), {
        status: "answered",
        answers: {
            one: { kind: "single", value: "a", note: "single note" },
            many: {
                kind: "multi",
                values: [
                    { value: "a", note: "note A" },
                    { value: "c", note: "note C" },
                ],
            },
            text: { kind: "text", value: "line 1\nline 2" },
            ok: { kind: "confirm", value: false, note: "not now" },
        },
    });
    assert.equal(mock.remaining.length, 0);
    const textEditor = mock.calls.find(call => call.method === "editor" && call.args[0] === "Question 3/4: Details?");
    assert.deepEqual(textEditor?.args, ["Question 3/4: Details?", "initial"]);
    assert.ok(mock.calls.some(call => call.method === "select" && call.args[0] === "Review answers (choose a question to revise)"));
});

test("review can reopen an answer with current values and overwrite it", async () => {
    const mock = scriptedUI([
        "[ ] A — First",
        "old note",
        "Q1: One? — A — note: old note",
        "[ ] B",
        "new\nnote",
        "Submit answers",
    ]);
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, [allKinds[0]]),
        {
            status: "answered",
            answers: { one: { kind: "single", value: "b", note: "new\nnote" } },
        },
    );
    const revision = mock.calls.find(call =>
        call.method === "select" && String(call.args[0]).startsWith("Question") &&
        Array.isArray(call.args[1]) && (call.args[1] as string[]).includes("[current] A — First"),
    );
    assert.ok(revision);
    const revisedNote = mock.calls.filter(call => call.method === "editor").at(-1);
    assert.equal(revisedNote?.args[1], "old note");
});

test("review rehydrates and revises multi, text, and confirm answers", async () => {
    const questions = allKinds.slice(1);
    const mock = scriptedUI([
        "[ ] A",
        "Done — confirm selections",
        "old A",
        "old text",
        "[ ] Yes",
        "old yes",
        "Q1: Many? — A (note: old A)",
        "[ ] B",
        "Done — confirm selections",
        "new A",
        "new B",
        "Q2: Details? — old text",
        "new text",
        "Q3: Proceed? — Yes — note: old yes",
        "[ ] No",
        "new no",
        "Submit answers",
    ]);

    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, questions),
        {
            status: "answered",
            answers: {
                many: {
                    kind: "multi",
                    values: [
                        { value: "a", note: "new A" },
                        { value: "b", note: "new B" },
                    ],
                },
                text: { kind: "text", value: "new text" },
                ok: { kind: "confirm", value: false, note: "new no" },
            },
        },
    );
    assert.ok(mock.calls.some(call =>
        call.method === "select" && Array.isArray(call.args[1]) &&
        (call.args[1] as string[]).includes("[x] A"),
    ));
    assert.ok(mock.calls.some(call => call.method === "editor" && call.args[1] === "old text"));
    assert.ok(mock.calls.some(call =>
        call.method === "select" && Array.isArray(call.args[1]) &&
        (call.args[1] as string[]).includes("[current] Yes"),
    ));
});

test("multi requires one selection before Done", async () => {
    const mock = scriptedUI([
        "Done — confirm selections",
        "[ ] B",
        "Done — confirm selections",
        "",
        "Submit answers",
    ]);
    const result = await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, [allKinds[1]]);
    assert.deepEqual(result, {
        status: "answered",
        answers: { many: { kind: "multi", values: [{ value: "b" }] } },
    });
    assert.equal(mock.calls.filter(call => call.method === "notify").length, 1);
});

test("initial and review cancellation retain the correct context", async () => {
    const initial = scriptedUI(["[ ] B", "", undefined]);
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: initial.ui }, allKinds.slice(0, 2)),
        {
            status: "cancelled",
            answers: { one: { kind: "single", value: "b" } },
            currentQuestionId: "many",
        },
    );

    const review = scriptedUI(["[ ] B", "", "Cancel"]);
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: review.ui }, [allKinds[0]]),
        {
            status: "cancelled",
            answers: { one: { kind: "single", value: "b" } },
        },
    );
});

test("non-interactive mode never invokes UI", async () => {
    const mock = scriptedUI([]);
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: false, ui: mock.ui }, allKinds),
        { status: "unavailable", answers: {} },
    );
    assert.deepEqual(mock.calls, []);
});

test("text retries blanks and abort after editor discards its value", async () => {
    const blank = scriptedUI(["  ", "answer", "Submit answers"]);
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: blank.ui }, [allKinds[2]]),
        { status: "answered", answers: { text: { kind: "text", value: "answer" } } },
    );
    assert.equal(blank.calls.filter(call => call.method === "notify").length, 1);

    const controller = new AbortController();
    const ui: UI = {
        async select() { throw new Error("unused"); },
        async input() { throw new Error("unused"); },
        async editor() {
            controller.abort();
            return "must be discarded";
        },
        notify() {},
    };
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui }, [allKinds[2]], controller.signal),
        { status: "cancelled", answers: {}, currentQuestionId: "text" },
    );
});
