import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { runStandardQuestionFlow } from "../extensions_src/utilities/decision_standard_ui.ts";
import { SYNTHETIC_UNANSWERED_LABEL } from "../extensions_src/utilities/decision_core.ts";
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
    { id: "text", prompt: "Details?", kind: "text", initialValue: "initial" },
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

void test("standard UI answers all kinds, reviews, and explicitly submits", async () => {
    const mock = scriptedUI([
        "[ ] A — First",
        "single note",
        "[ ] C",
        "[ ] A",
        "Done — confirm selections",
        "whole answer",
        "Answer this question",
        "line 1\nline 2",
        "[ ] No",
        "not now",
        "Submit responses",
    ]);

    assert.deepEqual(await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, allKinds), {
        status: "submitted",
        responses: {
            one: { kind: "single", value: "a", note: "single note" },
            many: { kind: "multi", values: ["a", "c"], note: "whole answer" },
            text: { kind: "text", value: "line 1\nline 2" },
            yesno: { kind: "single", value: "no", note: "not now" },
        },
    });
    assert.equal(mock.remaining.length, 0);
    const textEditor = mock.calls.find(call => call.method === "editor" && call.args[0] === "Question 3/4: Details?");
    assert.deepEqual(textEditor?.args, ["Question 3/4: Details?", "initial"]);
    assert.ok(mock.calls.some(call => call.method === "select" && call.args[0] === "Review responses (choose a question to revise)"));
});

void test("a single answered question submits without opening review", async () => {
    const mock = scriptedUI(["[ ] A — First", "single note"]);
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, [allKinds[0]]),
        {
            status: "submitted",
            responses: { one: { kind: "single", value: "a", note: "single note" } },
        },
    );
    assert.equal(mock.remaining.length, 0);
    const choices = mock.calls.find(call => call.method === "select")?.args[1] as string[];
    assert.ok(choices.includes("Submit without responding"));
    assert.ok(!choices.includes("Review responses now"));
    assert.ok(!mock.calls.some(call => call.args[0] === "Review responses (choose a question to revise)"));
});

void test("a single untouched question submits without opening review", async () => {
    const mock = scriptedUI(["Submit without responding"]);
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, [allKinds[0]]),
        { status: "submitted", responses: {} },
    );
    assert.ok(!mock.calls.some(call => call.args[0] === "Review responses (choose a question to revise)"));
});

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

void test("synthetic row creates unanswered response in standard UI", async () => {
    const mock = scriptedUI([`[ ] ${SYNTHETIC_UNANSWERED_LABEL}`, "none fit", "Submit responses"]);
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, [allKinds[0]!]),
        { status: "submitted", responses: { one: { kind: "unanswered", note: "none fit" } } },
    );
});

void test("cancelling a synthetic note returns to the question without cancelling the flow", async () => {
    const synthetic = `[ ] ${SYNTHETIC_UNANSWERED_LABEL}`;
    const mock = scriptedUI([synthetic, undefined, "[ ] A — First", "kept"]);
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, [allKinds[0]!]),
        { status: "submitted", responses: { one: { kind: "single", value: "a", note: "kept" } } },
    );
    assert.equal(mock.calls.filter(call => call.method === "select").length, 2);
});

void test("multi disambiguates a regular option from the synthetic label", async () => {
    const question: QuestionItem = {
        id: "collision",
        prompt: "Choose",
        kind: "multi",
        options: [
            { value: "regular", label: SYNTHETIC_UNANSWERED_LABEL },
            { value: "other", label: "Other" },
        ],
    };
    const realLabel = `[ ] ${SYNTHETIC_UNANSWERED_LABEL}`;
    const mock = scriptedUI([realLabel, "Done — confirm selections", ""]);
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, [question]),
        { status: "submitted", responses: { collision: { kind: "multi", values: ["regular"] } } },
    );
    const choices = mock.calls.find(call => call.method === "select")?.args[1] as string[];
    assert.ok(choices.includes(realLabel));
    assert.ok(choices.includes(`${realLabel} (2)`));
});

void test("review rehydrates and revises multi and text answers", async () => {
    const questions = allKinds.slice(1, 3);
    const mock = scriptedUI([
        "[ ] A",
        "[ ] B",
        "Done — confirm selections",
        "old answer",
        "Answer this question",
        "old text",
        "Q1: Many? — A, B — note: old answer",
        "Done — confirm selections",
        "new answer",
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
                many: { kind: "multi", values: ["a", "b"], note: "new answer" },
                text: { kind: "text", value: "new text" },
            },
        },
    );
    assert.ok(mock.calls.some(call =>
        call.method === "select" && Array.isArray(call.args[1]) &&
        (call.args[1] as string[]).includes("[x] A"),
    ));
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
        responses: { many: { kind: "multi", values: ["b"] } },
    });
    assert.equal(mock.calls.filter(call => call.method === "notify").length, 1);
});

void test("review can submit all questions untouched", async () => {
    const mock = scriptedUI(["Review responses now", "Submit responses"]);
    assert.deepEqual(await runStandardQuestionFlow({ hasUI: true, ui: mock.ui }, allKinds), {
        status: "submitted",
        responses: {},
    });
    const review = mock.calls.find(call => call.method === "select" && call.args[0] === "Review responses (choose a question to revise)");
    const reviewLabels = review?.args[1];
    assert.ok(Array.isArray(reviewLabels));
    assert.ok(reviewLabels.every(label => label.includes("Untouched") || label === "Submit responses" || label === "Cancel"));
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

void test("non-interactive mode never invokes UI", async () => {
    const mock = scriptedUI([]);
    assert.deepEqual(
        await runStandardQuestionFlow({ hasUI: false, ui: mock.ui }, allKinds),
        { status: "unavailable", responses: {} },
    );
    assert.deepEqual(mock.calls, []);
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

void test("artifact policy hides synthetic unanswered row", async () => {
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
        { allowUnansweredNote: false, autoSubmitSingle: true },
    );
    const firstSelect = mock.calls.find(call => call.method === "select")?.args[1] as string[];
    assert.ok(!firstSelect.some(label => label.includes(SYNTHETIC_UNANSWERED_LABEL)));
});
