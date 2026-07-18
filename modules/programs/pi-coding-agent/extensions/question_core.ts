import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

export const questionKinds = ["single", "multi", "text", "confirm"] as const;
export type QuestionKind = (typeof questionKinds)[number];
export const questionNoteModes = ["answer", "per-option"] as const;
export type QuestionNoteMode = (typeof questionNoteModes)[number];

export interface QuestionOption {
    value: string;
    label: string;
    description?: string;
}

export interface QuestionNoteConfig {
    mode: QuestionNoteMode;
    prompt?: string;
    placeholder?: string;
}

export interface QuestionItem {
    id: string;
    prompt: string;
    kind: QuestionKind;
    options?: QuestionOption[];
    initialValue?: string;
    note?: QuestionNoteConfig;
}

export interface QuestionParameters { questions: QuestionItem[]; }

export type QuestionAnswer =
    | { kind: "single"; value: string; note?: string }
    | { kind: "multi"; values: Array<{ value: string; note?: string }>; note?: string }
    | { kind: "text"; value: string }
    | { kind: "confirm"; value: boolean; note?: string };

export interface QuestionResultDetails {
    status: "answered" | "cancelled" | "unavailable";
    answers: Record<string, QuestionAnswer>;
    currentQuestionId?: string;
}

const questionOptionSchema = Type.Object({
    value: Type.String(),
    label: Type.String(),
    description: Type.Optional(Type.String()),
}, { additionalProperties: false });

const questionNoteSchema = Type.Object({
    mode: StringEnum(questionNoteModes),
    prompt: Type.Optional(Type.String()),
    placeholder: Type.Optional(Type.String()),
}, { additionalProperties: false });

const questionItemSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    kind: StringEnum(questionKinds),
    options: Type.Optional(Type.Array(questionOptionSchema)),
    initialValue: Type.Optional(Type.String()),
    note: Type.Optional(questionNoteSchema),
}, { additionalProperties: false });

export const questionParameters = Type.Object({
    questions: Type.Array(questionItemSchema, { minItems: 1 }),
}, { additionalProperties: false });
export type InferredQuestionParameters = Static<typeof questionParameters>;
export type PendingQuestionAnswer = QuestionAnswer;
export interface QuestionToolResult {
    content: Array<{ type: "text"; text: string }>;
    details: QuestionResultDetails;
}

export function optionDisplayText(option: QuestionOption): string {
    return option.description === undefined ? option.label : `${option.label} — ${option.description}`;
}

function requireNonBlank(value: string, message: string): void {
    if (value.trim().length === 0) throw new Error(message);
}
function requireUnique(values: readonly string[], message: (value: string) => string): void {
    const seen = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) throw new Error(message(value));
        seen.add(value);
    }
}

export function noteMode(question: QuestionItem): QuestionNoteMode | undefined {
    if (question.kind === "text") return undefined;
    return question.note?.mode ?? "answer";
}

export function validateQuestionParameters(params: QuestionParameters): void {
    if (params.questions.length === 0) throw new Error("questions must contain at least one question");
    requireUnique(params.questions.map(question => question.id), id => `Question id must be unique: ${id}`);
    for (const question of params.questions) {
        if (Object.prototype.hasOwnProperty.call(question, "notePlaceholder")) {
            throw new Error(`notePlaceholder is not supported: ${question.id}`);
        }
        requireNonBlank(question.id, "Question id must not be blank");
        requireNonBlank(question.prompt, `Question prompt must not be blank: ${question.id}`);
        const optionQuestion = question.kind === "single" || question.kind === "multi";
        if (optionQuestion) {
            if (question.options === undefined || question.options.length < 2) {
                throw new Error(`${question.kind} question ${question.id} requires at least two options`);
            }
            for (const option of question.options) {
                requireNonBlank(option.value, `Option value must not be blank in question ${question.id}`);
                requireNonBlank(option.label, `Option label must not be blank in question ${question.id}`);
            }
            requireUnique(question.options.map(option => option.value), value => `Option value must be unique in question ${question.id}: ${value}`);
            requireUnique(question.options.map(optionDisplayText), display => `Option display text must be unique in question ${question.id}: ${display}`);
        } else if (question.options !== undefined) {
            throw new Error(`${question.kind} question ${question.id} does not accept options`);
        }
        if (question.initialValue !== undefined && question.kind !== "text") {
            throw new Error(`initialValue is only valid for text questions: ${question.id}`);
        }
        if (question.note !== undefined && question.kind === "text") {
            throw new Error(`note is not valid for text questions: ${question.id}`);
        }
        if (question.note?.mode === "per-option" && question.kind === "confirm") {
            throw new Error(`per-option note mode is not valid for confirm questions: ${question.id}`);
        }
    }
}

function normalizeNote(note: string | undefined): string | undefined {
    return note === undefined || note.trim().length === 0 ? undefined : note;
}
function optionValues(question: QuestionItem): Set<string> {
    return new Set((question.options ?? []).map(option => option.value));
}

export function normalizeQuestionAnswer(question: QuestionItem, pending: PendingQuestionAnswer): QuestionAnswer {
    if (pending.kind !== question.kind) {
        throw new Error(`Answer kind ${pending.kind} does not match question ${question.id} (${question.kind})`);
    }
    switch (pending.kind) {
        case "single": {
            if (!optionValues(question).has(pending.value)) throw new Error(`Unknown option value for question ${question.id}: ${pending.value}`);
            const note = normalizeNote(pending.note);
            return note === undefined ? { kind: "single", value: pending.value } : { kind: "single", value: pending.value, note };
        }
        case "multi": {
            if (pending.values.length === 0) throw new Error(`multi question ${question.id} requires at least one selection`);
            const allowed = optionValues(question);
            const byValue = new Map<string, string | undefined>();
            for (const selected of pending.values) {
                if (!allowed.has(selected.value)) throw new Error(`Unknown option value for question ${question.id}: ${selected.value}`);
                if (byValue.has(selected.value)) throw new Error(`Duplicate selected value for question ${question.id}: ${selected.value}`);
                byValue.set(selected.value, normalizeNote(selected.note));
            }
            const values = (question.options ?? []).filter(option => byValue.has(option.value)).map(option => {
                const note = noteMode(question) === "per-option" ? byValue.get(option.value) : undefined;
                return note === undefined ? { value: option.value } : { value: option.value, note };
            });
            const note = noteMode(question) === "answer" ? normalizeNote(pending.note) : undefined;
            return note === undefined ? { kind: "multi", values } : { kind: "multi", values, note };
        }
        case "text":
            requireNonBlank(pending.value, `text question ${question.id} requires a non-blank answer`);
            return { kind: "text", value: pending.value };
        case "confirm": {
            const note = normalizeNote(pending.note);
            return note === undefined ? { kind: "confirm", value: pending.value } : { kind: "confirm", value: pending.value, note };
        }
    }
}

export class QuestionProgress {
    readonly #questions: readonly QuestionItem[];
    readonly #answers = new Map<string, QuestionAnswer>();
    #index = 0;
    constructor(questions: readonly QuestionItem[]) {
        if (questions.length === 0) throw new Error("QuestionProgress requires at least one question");
        this.#questions = questions;
    }
    get index(): number { return this.#index; }
    get total(): number { return this.#questions.length; }
    get current(): QuestionItem { return this.#questions[this.#index]!; }
    get lastAnsweredIndex(): number {
        for (let index = this.#questions.length - 1; index >= 0; index -= 1) if (this.isAnswered(this.#questions[index]!)) return index;
        return this.#index;
    }
    questionAt(index: number): QuestionItem {
        const question = this.#questions[index];
        if (question === undefined) throw new Error(`Question index out of range: ${index}`);
        return question;
    }
    moveTo(index: number): void { this.questionAt(index); this.#index = index; }
    move(delta: number): void { this.#index = (this.#index + delta % this.total + this.total) % this.total; }
    answerFor(questionOrId: QuestionItem | string): QuestionAnswer | undefined {
        return this.#answers.get(typeof questionOrId === "string" ? questionOrId : questionOrId.id);
    }
    isAnswered(questionOrId: QuestionItem | string): boolean { return this.answerFor(questionOrId) !== undefined; }
    get answeredCount(): number { return this.#answers.size; }
    get unansweredCount(): number { return this.total - this.answeredCount; }
    get allAnswered(): boolean { return this.unansweredCount === 0; }
    nextUnanswered(after = this.#index): number | undefined {
        for (let offset = 1; offset <= this.total; offset += 1) {
            const index = (after + offset) % this.total;
            if (!this.isAnswered(this.#questions[index]!)) return index;
        }
        return undefined;
    }
    submit(pending: PendingQuestionAnswer): QuestionAnswer {
        const answer = normalizeQuestionAnswer(this.current, pending);
        this.#answers.set(this.current.id, answer);
        return answer;
    }
    answered(): QuestionResultDetails {
        if (!this.allAnswered) throw new Error("Cannot build a complete answered result before all questions complete");
        return this.submitted();
    }
    submitted(): QuestionResultDetails {
        return { status: "answered", answers: Object.fromEntries(this.#answers) };
    }
    cancelled(includeCurrentQuestion = true): QuestionResultDetails {
        const base = { status: "cancelled" as const, answers: Object.fromEntries(this.#answers) };
        return includeCurrentQuestion ? { ...base, currentQuestionId: this.current.id } : base;
    }
}

export function unavailableResult(): QuestionResultDetails { return { status: "unavailable", answers: {} }; }
export function buildQuestionToolResult(details: QuestionResultDetails): QuestionToolResult {
    return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
}
