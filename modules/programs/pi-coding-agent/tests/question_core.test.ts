import assert from "node:assert/strict";
import test from "node:test";
import Value from "typebox/value";
import {
    buildQuestionToolResult,
    formatQuestionResponse,
    normalizeQuestionResponse,
    optionDisplayText,
    QuestionProgress,
    questionParameters,
    unavailableResult,
    validateQuestionParameters,
    type QuestionItem,
} from "../extensions_src/utilities/decision_core.ts";

const questions: QuestionItem[] = [
    {
        id: "approach",
        prompt: "Choose an approach",
        kind: "single",
        options: [
            { value: "safe", label: "Safe", description: "Small change" },
            { value: "fast", label: "Fast", description: "Broad change" },
        ],
    },
    {
        id: "details",
        prompt: "Describe the requirement",
        kind: "text",
        initialValue: "line one\n",
    },
];

test("schema accepts three kinds and multiple questions", () => {
    assert.equal(
        Value.Check(questionParameters, {
            questions: [
                questions[0],
                {
                    id: "targets",
                    prompt: "Choose targets",
                    kind: "multi",
                    options: [
                        { value: "a", label: "A" },
                        { value: "b", label: "B" },
                    ],
                },
                questions[1],
            ],
        }),
        true,
    );
    assert.equal(Value.Check(questionParameters, { questions: [] }), false);
    assert.equal(Value.Check(questionParameters, {
        questions: [{ id: "legacy", prompt: "Legacy", kind: "confirm" }],
    }), false);
    assert.equal(Value.Check(questionParameters, {
        questions: [{ id: "legacy", prompt: "Legacy", kind: "single", note: { mode: "answer" } }],
    }), false);
    assert.equal(Value.Check(questionParameters, {
        questions: [{ id: "legacy", prompt: "Legacy", kind: "confirm", notePlaceholder: "old" }],
    }), false);
    assert.equal(
        Value.Check(questionParameters, {
            questions: [{ id: "x", prompt: "x", kind: "unknown" }],
        }),
        false,
    );
});

test("schema characterizes required fields, closed objects, and option shapes", () => {
    const valid = {
        questions: [{
            id: "choice", prompt: "Choose", kind: "single",
            options: [{ value: "a", label: "A", description: "First" }],
        }],
    };
    assert.equal(Value.Check(questionParameters, valid), true);

    const invalid: unknown[] = [
        {},
        { questions: [{ prompt: "Choose", kind: "single" }] },
        { questions: [{ id: "choice", kind: "single" }] },
        { questions: [{ id: "choice", prompt: "Choose" }] },
        { questions: [{ id: "choice", prompt: "Choose", kind: "single", extra: true }] },
        { questions: [{ id: "choice", prompt: "Choose", kind: "single", options: [{ label: "A" }] }] },
        { questions: [{ id: "choice", prompt: "Choose", kind: "single", options: [{ value: "a" }] }] },
        { questions: [{ id: "choice", prompt: "Choose", kind: "single", options: [{ value: "a", label: "A", extra: true }] }] },
        { questions: [{ id: "choice", prompt: "Choose", kind: "single", note: { mode: "answer" } }] },
        { questions: valid.questions, extra: true },
    ];
    for (const value of invalid) assert.equal(Value.Check(questionParameters, value), false, JSON.stringify(value));

    assert.equal(Value.Check(questionParameters, {
        questions: [{ id: "choice", prompt: "Choose", kind: "single", options: [] }],
    }), true);
});

test("runtime validation rejects duplicate and kind-specific violations", () => {
    assert.doesNotThrow(() => validateQuestionParameters({ questions }));

    const invalidCases: Array<[RegExp, QuestionItem[]]> = [
        [/id must be unique/, [questions[0], { ...questions[1], id: "approach" }]],
        [/id must not be blank/, [{ ...questions[0], id: "  " }]],
        [/prompt must not be blank/, [{ ...questions[0], prompt: "\n" }]],
        [
            /at least two options/,
            [{ ...questions[0], options: [{ value: "one", label: "One" }] }],
        ],
        [
            /Option value must be unique/,
            [
                {
                    ...questions[0],
                    options: [
                        { value: "same", label: "A" },
                        { value: "same", label: "B" },
                    ],
                },
            ],
        ],
        [
            /display text must be unique/,
            [
                {
                    ...questions[0],
                    options: [
                        { value: "a", label: "Same", description: "Desc" },
                        { value: "b", label: "Same", description: "Desc" },
                    ],
                },
            ],
        ],
        [/does not accept options/, [{ ...questions[1], options: questions[0].options }]],
        [/initialValue is only valid/, [{ ...questions[0], initialValue: "x" }]],
        [/note is not supported/, [{ ...questions[0], note: { mode: "answer" } } as never]],
    ];

    for (const [pattern, items] of invalidCases) {
        assert.throws(() => validateQuestionParameters({ questions: items }), pattern);
    }
});

test("display text includes descriptions for stable reverse lookup", () => {
    assert.equal(
        optionDisplayText({ value: "safe", label: "Safe", description: "Small" }),
        "Safe — Small",
    );
    assert.equal(optionDisplayText({ value: "safe", label: "Safe" }), "Safe");
});

test("response formatting shares labels while preserving presentation policies", () => {
    const multi: QuestionItem = {
        id: "targets",
        prompt: "Targets",
        kind: "multi",
        options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
        ],
    };
    const response = {
        kind: "multi" as const,
        values: ["a", "b"],
        note: "overall\nnote",
    };

    assert.equal(
        formatQuestionResponse(multi, response),
        "A, B — note: overall\nnote",
    );
    assert.equal(
        formatQuestionResponse(multi, response, {
            formatText: value => value.replace(/\n/g, " ⏎ "),
            formatResponseNote: value => ` — note: ${value.replace(/\n/g, " ⏎ ")}`,
        }),
        "A, B — note: overall ⏎ note",
    );
    assert.equal(
        formatQuestionResponse(questions[0], { kind: "unanswered", note: "try another way" }),
        "Unanswered — note: try another way",
    );
});

test("responses normalize notes and multi values in option definition order", () => {
    const multi: QuestionItem = {
        id: "targets",
        prompt: "Targets",
        kind: "multi",
        options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
            { value: "c", label: "C" },
        ],
    };

    assert.deepEqual(
        normalizeQuestionResponse(multi, {
            kind: "multi",
            values: ["c", "a"],
            note: "overall",
        }),
        { kind: "multi", values: ["a", "c"], note: "overall" },
    );
    assert.deepEqual(
        normalizeQuestionResponse(questions[0], {
            kind: "single",
            value: "safe",
            note: "\ncondition\n",
        }),
        { kind: "single", value: "safe", note: "\ncondition\n" },
    );
    assert.deepEqual(
        normalizeQuestionResponse(questions[1], {
            kind: "text",
            value: "first\nsecond",
        }),
        { kind: "text", value: "first\nsecond" },
    );
    assert.deepEqual(
        normalizeQuestionResponse(questions[0], {
            kind: "unanswered",
            note: "none fit",
        }),
        { kind: "unanswered", note: "none fit" },
    );
});

test("normalization rejects empty or inconsistent pending responses", () => {
    assert.throws(
        () =>
            normalizeQuestionResponse(questions[0], {
                kind: "single",
                value: "missing",
            }),
        /Unknown option/,
    );
    assert.throws(
        () =>
            normalizeQuestionResponse(questions[1], {
                kind: "text",
                value: " \n ",
            }),
        /non-blank/,
    );
    assert.throws(
        () =>
            normalizeQuestionResponse(questions[0], {
                kind: "unanswered",
                note: "  ",
            }),
        /non-blank note/,
    );
});

test("progress supports movement, overwrite, cancellation contexts, and explicit submission", () => {
    const progress = new QuestionProgress(questions);
    assert.equal(progress.index, 0);
    assert.equal(progress.answeredCount, 0);
    assert.equal(progress.untouchedCount, 2);
    assert.deepEqual(progress.submitted(), { status: "submitted", responses: {} });

    progress.submit({ kind: "single", value: "safe" });
    assert.equal(progress.answeredCount, 1);
    assert.equal(progress.untouchedCount, 1);
    assert.equal(progress.index, 0);
    progress.move(1);
    assert.equal(progress.index, 1);
    assert.deepEqual(progress.cancelled(), {
        status: "cancelled",
        responses: { approach: { kind: "single", value: "safe" } },
        currentQuestionId: "details",
    });

    progress.submit({ kind: "text", value: "line one\nline two" });
    assert.equal(progress.allAnswered, true);
    progress.move(1);
    assert.equal(progress.index, 0);
    progress.submit({ kind: "single", value: "fast", note: "revised" });
    assert.deepEqual(progress.cancelled(false), {
        status: "cancelled",
        responses: {
            approach: { kind: "single", value: "fast", note: "revised" },
            details: { kind: "text", value: "line one\nline two" },
        },
    });
    assert.deepEqual(progress.submitted(), {
        status: "submitted",
        responses: {
            approach: { kind: "single", value: "fast", note: "revised" },
            details: { kind: "text", value: "line one\nline two" },
        },
    });
    assert.throws(() => progress.moveTo(2), /out of range/);
});

test("progress distinguishes answered, unanswered-with-note, and untouched", () => {
    const progress = new QuestionProgress(questions);
    progress.submit({ kind: "unanswered", note: "need more context" });
    assert.equal(progress.isAnswered("approach"), false);
    assert.equal(progress.isUnansweredWithNote("approach"), true);
    assert.equal(progress.isResponded("approach"), true);
    assert.equal(progress.isUntouched("details"), true);
    assert.equal(progress.answeredCount, 0);
    assert.equal(progress.unansweredWithNoteCount, 1);
    assert.equal(progress.respondedCount, 1);
    assert.equal(progress.nextUntouched(), 1);
});

test("result content and details carry the same recoverable JSON", () => {
    const result = buildQuestionToolResult(unavailableResult());
    assert.deepEqual(JSON.parse(result.content[0].text), result.details);
    assert.deepEqual(result.details, { status: "unavailable", responses: {} });
});

test("progress safely preserves question IDs that are object prototype names", () => {
    const progress = new QuestionProgress([
        { id: "__proto__", prompt: "Details", kind: "text" },
    ]);
    progress.submit({ kind: "text", value: "answer" });
    const details = progress.submitted();
    assert.deepEqual(details, {
        status: "submitted",
        responses: Object.fromEntries([
            ["__proto__", { kind: "text", value: "answer" }],
        ]),
    });
    assert.equal(
        Object.prototype.hasOwnProperty.call(details.responses, "__proto__"),
        true,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(details)), details);
});
