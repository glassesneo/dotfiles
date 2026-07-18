import assert from "node:assert/strict";
import test from "node:test";
import Value from "typebox/value";
import {
    buildQuestionToolResult,
    normalizeQuestionAnswer,
    optionDisplayText,
    QuestionProgress,
    questionParameters,
    unavailableResult,
    validateQuestionParameters,
    type QuestionItem,
} from "../extensions/question_core.ts";

const questions: QuestionItem[] = [
    {
        id: "approach",
        prompt: "Choose an approach",
        kind: "single",
        options: [
            { value: "safe", label: "Safe", description: "Small change" },
            { value: "fast", label: "Fast", description: "Broad change" },
        ],
        note: { mode: "answer", placeholder: "Optional condition" },
    },
    {
        id: "details",
        prompt: "Describe the requirement",
        kind: "text",
        initialValue: "line one\n",
    },
];

test("schema accepts all four kinds and multiple questions", () => {
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
                { id: "proceed", prompt: "Proceed?", kind: "confirm" },
            ],
        }),
        true,
    );
    assert.equal(Value.Check(questionParameters, { questions: [] }), false);
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
        [/note is not valid/, [{ ...questions[1], note: { mode: "answer" } }]],
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

test("answers normalize notes and multi values in option definition order", () => {
    const multi: QuestionItem = {
        id: "targets",
        prompt: "Targets",
        kind: "multi",
        options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
            { value: "c", label: "C" },
        ],
        note: { mode: "per-option" },
    };

    assert.deepEqual(
        normalizeQuestionAnswer(multi, {
            kind: "multi",
            values: [
                { value: "c", note: "line 1\nline 2" },
                { value: "a", note: "  " },
            ],
        }),
        {
            kind: "multi",
            values: [{ value: "a" }, { value: "c", note: "line 1\nline 2" }],
        },
    );
    assert.deepEqual(
        normalizeQuestionAnswer({
            id: "default-note", prompt: "Targets", kind: "multi",
            options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
        }, { kind: "multi", values: [{ value: "a", note: "ignored" }], note: "answer note" }),
        { kind: "multi", values: [{ value: "a" }], note: "answer note" },
    );
    assert.deepEqual(
        normalizeQuestionAnswer(questions[0], {
            kind: "single",
            value: "safe",
            note: "\ncondition\n",
        }),
        { kind: "single", value: "safe", note: "\ncondition\n" },
    );
    assert.deepEqual(
        normalizeQuestionAnswer(
            { id: "ok", prompt: "OK?", kind: "confirm" },
            { kind: "confirm", value: false, note: "not yet" },
        ),
        { kind: "confirm", value: false, note: "not yet" },
    );
    assert.deepEqual(
        normalizeQuestionAnswer(questions[1], {
            kind: "text",
            value: "first\nsecond",
        }),
        { kind: "text", value: "first\nsecond" },
    );
});

test("normalization rejects empty or inconsistent pending answers", () => {
    assert.throws(
        () =>
            normalizeQuestionAnswer(questions[0], {
                kind: "single",
                value: "missing",
            }),
        /Unknown option/,
    );
    assert.throws(
        () =>
            normalizeQuestionAnswer(questions[1], {
                kind: "text",
                value: " \n ",
            }),
        /non-blank/,
    );
});

test("progress supports movement, overwrite, cancellation contexts, and explicit submission", () => {
    const progress = new QuestionProgress(questions);
    assert.equal(progress.index, 0);
    assert.equal(progress.answeredCount, 0);
    assert.equal(progress.unansweredCount, 2);
    assert.throws(() => progress.answered(), /before all questions complete/);
    assert.deepEqual(progress.submitted(), { status: "answered", answers: {} });

    progress.submit({ kind: "single", value: "safe" });
    assert.equal(progress.answeredCount, 1);
    assert.equal(progress.unansweredCount, 1);
    assert.equal(progress.index, 0);
    progress.move(1);
    assert.equal(progress.index, 1);
    assert.deepEqual(progress.cancelled(), {
        status: "cancelled",
        answers: { approach: { kind: "single", value: "safe" } },
        currentQuestionId: "details",
    });

    progress.submit({ kind: "text", value: "line one\nline two" });
    assert.equal(progress.allAnswered, true);
    progress.move(1);
    assert.equal(progress.index, 0);
    progress.submit({ kind: "single", value: "fast", note: "revised" });
    assert.deepEqual(progress.cancelled(false), {
        status: "cancelled",
        answers: {
            approach: { kind: "single", value: "fast", note: "revised" },
            details: { kind: "text", value: "line one\nline two" },
        },
    });
    assert.deepEqual(progress.answered(), {
        status: "answered",
        answers: {
            approach: { kind: "single", value: "fast", note: "revised" },
            details: { kind: "text", value: "line one\nline two" },
        },
    });
    assert.throws(() => progress.moveTo(2), /out of range/);
});

test("result content and details carry the same recoverable JSON", () => {
    const result = buildQuestionToolResult(unavailableResult());
    assert.deepEqual(JSON.parse(result.content[0].text), result.details);
    assert.deepEqual(result.details, { status: "unavailable", answers: {} });
});

test("progress safely preserves question IDs that are object prototype names", () => {
    const progress = new QuestionProgress([
        { id: "__proto__", prompt: "Details", kind: "text" },
    ]);
    progress.submit({ kind: "text", value: "answer" });
    const details = progress.answered();
    assert.deepEqual(details, {
        status: "answered",
        answers: Object.fromEntries([
            ["__proto__", { kind: "text", value: "answer" }],
        ]),
    });
    assert.equal(
        Object.prototype.hasOwnProperty.call(details.answers, "__proto__"),
        true,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(details)), details);
});
