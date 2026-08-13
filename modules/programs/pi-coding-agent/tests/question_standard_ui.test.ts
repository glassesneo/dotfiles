import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { runStandardQuestionFlow } from "../extensions_src/utilities/decision_standard_ui.ts";
import type { QuestionItem } from "../extensions_src/utilities/decision_core.ts";

type UI = Pick<ExtensionUIContext, "select" | "editor" | "notify">;

function scriptedUI(script: Array<string | undefined>) {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const next = () => script.shift();
    const ui: UI = {
        async select(...args) {
            calls.push({ method: "select", args });
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
    { id: "text", prompt: "Details?", kind: "text" },
    {
        id: "yesno",
        prompt: "Proceed?",
        kind: "single",
        options: [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
        ],
    },
];

void test("single-choice note policy supports required and disabled notes", async () => {
    const required = scriptedUI(["[ ] B", " ", "required note"]);
    assert.deepEqual(
        await runStandardQuestionFlow(
            { hasUI: true, ui: required.ui },
            [allKinds[0]!],
            undefined,
            { noteRequirement: (_item, option) => option?.value === "b" ? "required" : "none" },
        ),
        { status: "submitted", responses: { one: { kind: "single", value: "b", note: "required note" } } },
    );
    assert.equal(required.calls.filter(call => call.method === "notify").length, 1);

    const disabled = scriptedUI(["[ ] A — First"]);
    assert.deepEqual(
        await runStandardQuestionFlow(
            { hasUI: true, ui: disabled.ui },
            [allKinds[0]!],
            undefined,
            { noteRequirement: () => "none" },
        ),
        { status: "submitted", responses: { one: { kind: "single", value: "a" } } },
    );
    assert.equal(disabled.calls.filter(call => call.method === "editor").length, 0);
});

void test("noteRequired prompts immediately for a selected multi option", async () => {
    const question: QuestionItem = { id: "required", prompt: "Choose", kind: "multi", options: [{ value: "a", label: "A", noteRequired: true }, { value: "b", label: "B" }] };
    const mock = scriptedUI(["[ ] A", "because", "Done — confirm selections"]);
    assert.deepEqual(await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, [question]), {
        status: "submitted",
        responses: { required: { kind: "multi", values: [{ value: "a", note: "because" }] } },
    });
    assert.equal(mock.calls.filter(call => call.method === "editor").length, 1);
});

void test("write-in control creates an answered response in standard UI", async () => {
    const mock = scriptedUI(["Write another response…", "none fit"]);
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, [allKinds[0]!]),
        { status: "submitted", responses: { one: { kind: "write-in", value: "none fit" } } },
    );
});

void test("cancelling a write-in editor returns to the question without cancelling the flow", async () => {
    const mock = scriptedUI(["Write another response…", undefined, "[ ] A — First", "kept"]);
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, [allKinds[0]!]),
        { status: "submitted", responses: { one: { kind: "single", value: "a", note: "kept" } } },
    );
    assert.equal(mock.calls.filter(call => call.method === "select").length, 2);
});

void test("option-note editor cancellation returns to the choice dialog", async () => {
    const mock = scriptedUI(["[ ] A — First", undefined, "[ ] B", "kept"]);
    assert.deepEqual(await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, [allKinds[0]!]), {
        status: "submitted",
        responses: { one: { kind: "single", value: "b", note: "kept" } },
    });
    assert.equal(mock.calls.filter(call => call.method === "select").length, 2);
});

void test("multi note cancellation preserves notes completed earlier in the Done attempt", async () => {
    const question = allKinds[1]!;
    const mock = scriptedUI([
        "[ ] A", "[ ] B", "Done — confirm selections", "note A", undefined,
        "Done — confirm selections", "note B",
    ]);
    assert.deepEqual(await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, [question]), {
        status: "submitted",
        responses: { many: { kind: "multi", values: [{ value: "a", note: "note A" }, { value: "b", note: "note B" }] } },
    });
    assert.equal(mock.calls.filter(call => call.method === "editor").length, 3);
});

void test("review can delete existing single and multi write-ins", async () => {
    const singleDelete = scriptedUI([
        "Write another response…", "old", "Answer this question", "details",
        "Q1: One? — old", "Write another response…", "", "Submit responses",
    ]);
    assert.deepEqual(await runStandardQuestionFlow({ hasUI: true, ui: singleDelete.ui }, [allKinds[0]!, allKinds[2]!]), {
        status: "submitted",
        responses: { text: { kind: "text", value: "details" } },
    });

    const multiDelete = scriptedUI([
        "[ ] A", "Write another response…", "extra", "Done — confirm selections", "",
        "Answer this question", "details", "Q1: Many? — A, extra",
        "Write another response…", "", "Done — confirm selections", "", "Submit responses",
    ]);
    assert.deepEqual(await runStandardQuestionFlow({ hasUI: true, ui: multiDelete.ui }, [allKinds[1]!, allKinds[2]!]), {
        status: "submitted",
        responses: {
            many: { kind: "multi", values: [{ value: "a" }] },
            text: { kind: "text", value: "details" },
        },
    });
});

void test("review rehydrates and revises multi and text answers", async () => {
    const questions = allKinds.slice(1, 3);
    const mock = scriptedUI([
        "[ ] A",
        "[ ] B",
        "Done — confirm selections",
        "old A",
        "old B",
        "Answer this question",
        "old text",
        "Q1: Many? — A — note: old A, B — note: old B",
        "Done — confirm selections",
        "new A",
        "new B",
        "Q2: Details? — old text",
        "Answer this question",
        "new text",
        "Submit responses",
    ]);

    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, questions),
        {
            status: "submitted",
            responses: {
                many: { kind: "multi", values: [{ value: "a", note: "new A" }, { value: "b", note: "new B" }] },
                text: { kind: "text", value: "new text" },
            },
        },
    );
    assert.ok(mock.calls.some(call => call.method === "editor" && call.args[1] === "old text"));
});

void test("multi requires one selection before Done", async () => {
    const mock = scriptedUI([
        "Done — confirm selections",
        "[ ] B",
        "Done — confirm selections",
        "",
        "Submit responses",
    ]);
    const result = await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, [allKinds[1]]);
    assert.deepEqual(result, {
        status: "submitted",
        responses: { many: { kind: "multi", values: [{ value: "b" }] } },
    });
    assert.equal(mock.calls.filter(call => call.method === "notify").length, 1);
});

void test("initial and review cancellation retain the correct context", async () => {
    const initial = scriptedUI(["[ ] B", "", undefined]);
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: initial.ui }, allKinds.slice(0, 2)),
        {
            status: "cancelled",
            responses: { one: { kind: "single", value: "b" } },
            currentQuestionId: "many",
        },
    );

    const review = scriptedUI(["[ ] B", "", "Review responses now", "Cancel"]);
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: review.ui }, allKinds.slice(0, 2)),
        {
            status: "cancelled",
            responses: { one: { kind: "single", value: "b" } },
        },
    );
});

void test("text retries blanks and abort after editor discards its value", async () => {
    const blank = scriptedUI(["Answer this question", "  ", "answer", "Submit responses"]);
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: blank.ui }, [allKinds[2]]),
        { status: "submitted", responses: { text: { kind: "text", value: "answer" } } },
    );
    assert.equal(blank.calls.filter(call => call.method === "notify").length, 1);

    const controller = new AbortController();
    const ui: UI = {
        async select() { return "Answer this question"; },
        async editor() {
            controller.abort();
            return "must be discarded";
        },
        notify() {},
    };
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui }, [allKinds[2]], controller.signal),
        { status: "cancelled", responses: {}, currentQuestionId: "text" },
    );
});

void test("artifact policy hides the write-in control", async () => {
    const mock = scriptedUI(["[ ] Approve", "Submit responses"]);
    const question: QuestionItem = {
        id: "artifact-action",
        prompt: "Review",
        kind: "single",
        options: [
            { value: "approve", label: "Approve" },
            { value: "reject", label: "Reject" },
        ],
    };
    await runStandardQuestionFlow(
        { hasUI: true, ui: mock.ui },
        [question],
        undefined,
        { allowWriteIn: false, autoSubmitSingle: true },
    );
    const firstSelect = mock.calls.find(call => call.method === "select")?.args[1] as string[];
    assert.equal(firstSelect.length, question.options!.length + 1);
    assert.ok(question.options?.every(option => firstSelect.some(choice => choice.includes(option.label))));
});
