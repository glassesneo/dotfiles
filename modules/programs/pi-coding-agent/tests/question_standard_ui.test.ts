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
    {
        id: "text",
        prompt: "Details?",
        kind: "text",
        initialValue: "initial",
    },
    { id: "ok", prompt: "Proceed?", kind: "confirm" },
];

test("standard UI produces shared structured answers for all kinds", async () => {
    const mock = scriptedUI([
        "A — First",
        "single note",
        "[ ] C",
        "[ ] A",
        "Done — confirm selections",
        "note A",
        "note C",
        "line 1\nline 2",
        "No",
        "not now",
    ]);

    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, allKinds),
        {
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
        },
    );
    assert.equal(mock.remaining.length, 0);
    assert.equal(mock.calls.some(call => call.method === "confirm"), false);
    const editorCall = mock.calls.find(call => call.method === "editor");
    assert.deepEqual(editorCall?.args, ["Question 3/4: Details?", "initial"]);
});

test("multi requires one selection before Done", async () => {
    const mock = scriptedUI([
        "Done — confirm selections",
        "[ ] B",
        "Done — confirm selections",
        "",
    ]);
    const result = await runStandardQuestionFlow(
        { hasUI: true, ui: mock.ui },
        [allKinds[1]],
    );
    assert.deepEqual(result, {
        status: "answered",
        answers: { many: { kind: "multi", values: [{ value: "b" }] } },
    });
    assert.equal(mock.calls.filter(call => call.method === "notify").length, 1);
});

test("cancellation retains only completed preceding answers", async () => {
    const mock = scriptedUI(["B", "", undefined]);
    const result = await runStandardQuestionFlow(
        { hasUI: true, ui: mock.ui },
        allKinds.slice(0, 2),
    );
    assert.deepEqual(result, {
        status: "cancelled",
        answers: { one: { kind: "single", value: "b" } },
        currentQuestionId: "many",
    });
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
    const blank = scriptedUI(["  ", "answer"]);
    assert.deepEqual(
        await runStandardQuestionFlow(
            { hasUI: true, ui: blank.ui },
            [allKinds[2]],
        ),
        {
            status: "answered",
            answers: { text: { kind: "text", value: "answer" } },
        },
    );
    assert.equal(blank.calls.filter(call => call.method === "notify").length, 1);

    const controller = new AbortController();
    const calls: string[] = [];
    const ui: UI = {
        async select() {
            throw new Error("unused");
        },
        async input() {
            throw new Error("unused");
        },
        async editor() {
            calls.push("editor");
            controller.abort();
            return "must be discarded";
        },
        notify() {},
    };
    assert.deepEqual(
        await runStandardQuestionFlow(
            { hasUI: true, ui },
            [allKinds[2]],
            controller.signal,
        ),
        { status: "cancelled", answers: {}, currentQuestionId: "text" },
    );
    assert.deepEqual(calls, ["editor"]);
});
