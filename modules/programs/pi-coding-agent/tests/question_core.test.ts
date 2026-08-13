import assert from "node:assert/strict";
import test from "node:test";
import Value from "typebox/value";
import {
    buildQuestionToolResult,
    decisionNoteRequirement,
    normalizeQuestionResponse,
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
    },
];

void test("schema accepts supported kinds and rejects retired fields", () => {
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
    for (const value of [
        { questions: [] },
        { questions: [{ id: "legacy", prompt: "Legacy", kind: "confirm" }] },
        { questions: [{ id: "legacy", prompt: "Legacy", kind: "text", initialValue: "old" }] },
        { questions: [{ id: "legacy", prompt: "Legacy", kind: "single", note: { mode: "answer" } }] },
        { questions: [{ id: "legacy", prompt: "Legacy", kind: "single", notePlaceholder: "old" }] },
    ]) {
        assert.equal(Value.Check(questionParameters, value), false);
    }
});

void test("schema characterizes required fields, closed objects, and option shapes", () => {
    const valid = {
        questions: [{
            id: "choice", prompt: "Choose", kind: "single",
            options: [{ value: "a", label: "A", description: "First", noteRequired: true }],
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
        { questions: [{ id: "choice", prompt: "Choose", kind: "single", options: [{ value: "a", label: "A", noteRequired: "yes" }] }] },
        { questions: [{ id: "choice", prompt: "Choose", kind: "single", note: { mode: "answer" } }] },
        { questions: valid.questions, extra: true },
    ];
    for (const value of invalid) assert.equal(Value.Check(questionParameters, value), false, JSON.stringify(value));

});

void test("runtime validation rejects duplicate and kind-specific violations", () => {
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
        [/initialValue is not supported/, [{ ...questions[1], initialValue: "x" } as never]],
        [/note is not supported/, [{ ...questions[0], note: { mode: "answer" } } as never]],
    ];

    for (const [pattern, items] of invalidCases) {
        assert.throws(() => validateQuestionParameters({ questions: items }), pattern);
    }
});

void test("noteRequired defaults to optional and requires notes when true", () => {
    const question = questions[0]!;
    assert.equal(decisionNoteRequirement(undefined, question, question.options?.[0]), "optional");
    assert.equal(decisionNoteRequirement(undefined, question, { value: "x", label: "X", noteRequired: true }), "required");
    assert.equal(decisionNoteRequirement({ noteRequirement: () => "none" }, question, { value: "x", label: "X", noteRequired: true }), "none");
});

void test("responses normalize notes and multi values in option definition order", () => {
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
            values: [{ value: "c", note: "third" }, { value: "a", note: "first" }],
        }),
        { kind: "multi", values: [{ value: "a", note: "first" }, { value: "c", note: "third" }] },
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
            kind: "write-in",
            value: "none fit",
        }),
        { kind: "write-in", value: "none fit" },
    );
});

void test("normalization rejects empty or inconsistent pending responses", () => {
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
                kind: "write-in",
                value: "  ",
            }),
        /non-blank text/,
    );
    assert.throws(
        () =>
            normalizeQuestionResponse(
                { ...questions[0], kind: "multi", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
                { kind: "multi", values: [] },
            ),
        /at least one selection or a write-in/,
    );
    assert.throws(
        () =>
            normalizeQuestionResponse(
                { ...questions[0], kind: "multi", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
                { kind: "multi", values: [{ value: "a" }, { value: "a", note: "duplicate" }] },
            ),
        /Duplicate selected value/,
    );
});

void test("progress supports movement, overwrite, cancellation contexts, and explicit submission", () => {
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

void test("progress counts write-ins as answered and preserves untouched questions", () => {
    const progress = new QuestionProgress(questions);
    progress.submit({ kind: "write-in", value: "need another path" });
    assert.equal(progress.isAnswered("approach"), true);
    assert.equal(progress.isResponded("approach"), true);
    assert.equal(progress.isUntouched("details"), true);
    assert.equal(progress.answeredCount, 1);
    assert.equal(progress.respondedCount, 1);
    assert.equal(progress.nextUntouched(), 1);
});

void test("result content and details carry the same recoverable JSON", () => {
    const result = buildQuestionToolResult(unavailableResult());
    assert.deepEqual(JSON.parse(result.content[0].text), result.details);
    assert.deepEqual(result.details, { status: "unavailable", responses: {} });
});

void test("progress safely preserves question IDs that are object prototype names", () => {
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
