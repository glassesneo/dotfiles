import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

export const questionKinds = ["single", "multi", "text", "confirm"] as const;
export type QuestionKind = (typeof questionKinds)[number];

export interface QuestionOption {
    value: string;
    label: string;
    description?: string;
}

export interface QuestionItem {
    id: string;
    prompt: string;
    kind: QuestionKind;
    options?: QuestionOption[];
    initialValue?: string;
    notePlaceholder?: string;
}

export interface QuestionParameters {
    questions: QuestionItem[];
}

export type QuestionAnswer =
    | { kind: "single"; value: string; note?: string }
    | { kind: "multi"; values: Array<{ value: string; note?: string }> }
    | { kind: "text"; value: string }
    | { kind: "confirm"; value: boolean; note?: string };

export interface QuestionResultDetails {
    status: "answered" | "cancelled" | "unavailable";
    answers: Record<string, QuestionAnswer>;
    currentQuestionId?: string;
}

const questionOptionSchema = Type.Object(
    {
        value: Type.String(),
        label: Type.String(),
        description: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
);

const questionItemSchema = Type.Object(
    {
        id: Type.String({ minLength: 1 }),
        prompt: Type.String({ minLength: 1 }),
        kind: StringEnum(questionKinds),
        options: Type.Optional(Type.Array(questionOptionSchema)),
        initialValue: Type.Optional(Type.String()),
        notePlaceholder: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
);

export const questionParameters = Type.Object(
    {
        questions: Type.Array(questionItemSchema, { minItems: 1 }),
    },
    { additionalProperties: false },
);

export type InferredQuestionParameters = Static<typeof questionParameters>;

export type PendingQuestionAnswer =
    | { kind: "single"; value: string; note?: string }
    | { kind: "multi"; values: Array<{ value: string; note?: string }> }
    | { kind: "text"; value: string }
    | { kind: "confirm"; value: boolean; note?: string };

export interface QuestionToolResult {
    content: Array<{ type: "text"; text: string }>;
    details: QuestionResultDetails;
}

export function optionDisplayText(option: QuestionOption): string {
    return option.description === undefined
        ? option.label
        : `${option.label} — ${option.description}`;
}

function requireNonBlank(value: string, message: string): void {
    if (value.trim().length === 0) {
        throw new Error(message);
    }
}

function requireUnique(
    values: readonly string[],
    message: (value: string) => string,
): void {
    const seen = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) {
            throw new Error(message(value));
        }
        seen.add(value);
    }
}

export function validateQuestionParameters(
    params: QuestionParameters,
): void {
    if (params.questions.length === 0) {
        throw new Error("questions must contain at least one question");
    }

    requireUnique(
        params.questions.map(question => question.id),
        id => `Question id must be unique: ${id}`,
    );

    for (const question of params.questions) {
        requireNonBlank(question.id, "Question id must not be blank");
        requireNonBlank(
            question.prompt,
            `Question prompt must not be blank: ${question.id}`,
        );

        const isOptionQuestion =
            question.kind === "single" || question.kind === "multi";
        const isSelectionQuestion = isOptionQuestion || question.kind === "confirm";

        if (isOptionQuestion) {
            if (question.options === undefined || question.options.length < 2) {
                throw new Error(
                    `${question.kind} question ${question.id} requires at least two options`,
                );
            }

            for (const option of question.options) {
                requireNonBlank(
                    option.value,
                    `Option value must not be blank in question ${question.id}`,
                );
                requireNonBlank(
                    option.label,
                    `Option label must not be blank in question ${question.id}`,
                );
            }

            requireUnique(
                question.options.map(option => option.value),
                value =>
                    `Option value must be unique in question ${question.id}: ${value}`,
            );
            requireUnique(
                question.options.map(optionDisplayText),
                display =>
                    `Option display text must be unique in question ${question.id}: ${display}`,
            );
        } else if (question.options !== undefined) {
            throw new Error(
                `${question.kind} question ${question.id} does not accept options`,
            );
        }

        if (question.initialValue !== undefined && question.kind !== "text") {
            throw new Error(
                `initialValue is only valid for text questions: ${question.id}`,
            );
        }
        if (question.notePlaceholder !== undefined && !isSelectionQuestion) {
            throw new Error(
                `notePlaceholder is only valid for selection questions: ${question.id}`,
            );
        }
    }
}

function normalizeNote(note: string | undefined): string | undefined {
    return note === undefined || note.trim().length === 0 ? undefined : note;
}

function optionValues(question: QuestionItem): Set<string> {
    return new Set((question.options ?? []).map(option => option.value));
}

export function normalizeQuestionAnswer(
    question: QuestionItem,
    pending: PendingQuestionAnswer,
): QuestionAnswer {
    if (pending.kind !== question.kind) {
        throw new Error(
            `Answer kind ${pending.kind} does not match question ${question.id} (${question.kind})`,
        );
    }

    switch (pending.kind) {
        case "single": {
            if (!optionValues(question).has(pending.value)) {
                throw new Error(
                    `Unknown option value for question ${question.id}: ${pending.value}`,
                );
            }
            const note = normalizeNote(pending.note);
            return note === undefined
                ? { kind: "single", value: pending.value }
                : { kind: "single", value: pending.value, note };
        }
        case "multi": {
            if (pending.values.length === 0) {
                throw new Error(
                    `multi question ${question.id} requires at least one selection`,
                );
            }
            const byValue = new Map<string, string | undefined>();
            const allowed = optionValues(question);
            for (const selected of pending.values) {
                if (!allowed.has(selected.value)) {
                    throw new Error(
                        `Unknown option value for question ${question.id}: ${selected.value}`,
                    );
                }
                if (byValue.has(selected.value)) {
                    throw new Error(
                        `Duplicate selected value for question ${question.id}: ${selected.value}`,
                    );
                }
                byValue.set(selected.value, normalizeNote(selected.note));
            }

            const values = (question.options ?? [])
                .filter(option => byValue.has(option.value))
                .map(option => {
                    const note = byValue.get(option.value);
                    return note === undefined
                        ? { value: option.value }
                        : { value: option.value, note };
                });
            return { kind: "multi", values };
        }
        case "text":
            requireNonBlank(
                pending.value,
                `text question ${question.id} requires a non-blank answer`,
            );
            return { kind: "text", value: pending.value };
        case "confirm": {
            const note = normalizeNote(pending.note);
            return note === undefined
                ? { kind: "confirm", value: pending.value }
                : { kind: "confirm", value: pending.value, note };
        }
    }
}

export class QuestionProgress {
    readonly #questions: readonly QuestionItem[];
    readonly #answers = new Map<string, QuestionAnswer>();
    #index = 0;

    constructor(questions: readonly QuestionItem[]) {
        if (questions.length === 0) {
            throw new Error("QuestionProgress requires at least one question");
        }
        this.#questions = questions;
    }

    get index(): number {
        return this.#index;
    }

    get total(): number {
        return this.#questions.length;
    }

    get current(): QuestionItem | undefined {
        return this.#questions[this.#index];
    }

    submit(pending: PendingQuestionAnswer): QuestionResultDetails | undefined {
        const question = this.current;
        if (question === undefined) {
            throw new Error("All questions have already been answered");
        }

        const answer = normalizeQuestionAnswer(question, pending);
        this.#answers.set(question.id, answer);
        this.#index += 1;

        return this.current === undefined ? this.answered() : undefined;
    }

    answered(): QuestionResultDetails {
        if (this.current !== undefined) {
            throw new Error("Cannot build an answered result before all questions complete");
        }
        return {
            status: "answered",
            answers: Object.fromEntries(this.#answers),
        };
    }

    cancelled(): QuestionResultDetails {
        const currentQuestionId = this.current?.id;
        const answers = Object.fromEntries(this.#answers);
        return currentQuestionId === undefined
            ? { status: "cancelled", answers }
            : {
                  status: "cancelled",
                  answers,
                  currentQuestionId,
              };
    }
}

export function unavailableResult(): QuestionResultDetails {
    return { status: "unavailable", answers: {} };
}

export function buildQuestionToolResult(
    details: QuestionResultDetails,
): QuestionToolResult {
    return {
        content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
        details,
    };
}
