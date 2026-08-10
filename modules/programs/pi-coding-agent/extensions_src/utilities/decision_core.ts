import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

export const questionKinds = ["single", "multi", "text"] as const;
export type QuestionKind = (typeof questionKinds)[number];

export interface QuestionOption {
    value: string;
    label: string;
    description?: string;
    noteRequired?: boolean;
}

export interface QuestionItem {
    id: string;
    prompt: string;
    kind: QuestionKind;
    options?: QuestionOption[];
}

export interface QuestionParameters { questions: QuestionItem[]; }

export type QuestionResponse =
    | { kind: "single"; value: string; note?: string }
    | { kind: "multi"; values: Array<{ value: string; note?: string }>; writeIn?: string }
    | { kind: "text"; value: string }
    | { kind: "write-in"; value: string };

export interface QuestionResultDetails {
    status: "submitted" | "cancelled" | "unavailable";
    responses: Record<string, QuestionResponse>;
    currentQuestionId?: string;
}

const questionOptionSchema = Type.Object({
    value: Type.String(),
    label: Type.String(),
    description: Type.Optional(Type.String()),
    noteRequired: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const questionItemSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    kind: StringEnum(questionKinds),
    options: Type.Optional(Type.Array(questionOptionSchema)),
}, { additionalProperties: false });

export const questionParameters = Type.Object({
    questions: Type.Array(questionItemSchema, { minItems: 1 }),
}, { additionalProperties: false });
export type InferredQuestionParameters = Static<typeof questionParameters>;
export type PendingQuestionResponse = QuestionResponse;
export interface QuestionToolResult {
    content: Array<{ type: "text"; text: string }>;
    details: QuestionResultDetails;
}

// The artifact approval flow shares the decision UI without becoming a question tool.
export type DecisionItem = QuestionItem;
export type DecisionResultDetails = QuestionResultDetails;

export type DecisionNoteRequirement = "none" | "optional" | "required";
export interface DecisionNotePresentation {
    prompt?: string;
    placeholder?: string;
}
export interface DecisionFlowPolicy {
    autoSubmitSingle?: boolean;
    allowWriteIn?: boolean;
    noteRequirement?: (
        item: QuestionItem,
        option?: QuestionOption,
    ) => DecisionNoteRequirement;
    notePresentation?: (
        item: QuestionItem,
        context: "response" | "write-in",
    ) => DecisionNotePresentation;
}

export function shouldAllowWriteIn(
    policy: DecisionFlowPolicy | undefined,
): boolean {
    return policy?.allowWriteIn ?? true;
}

export function decisionNoteRequirement(
    policy: DecisionFlowPolicy | undefined,
    item: QuestionItem,
    option?: QuestionOption,
): DecisionNoteRequirement {
    return policy?.noteRequirement?.(item, option) ?? (option?.noteRequired === true ? "required" : "optional");
}

export function shouldAutoSubmitSingle(
    policy: DecisionFlowPolicy | undefined,
): boolean {
    return policy?.autoSubmitSingle ?? true;
}

export function notePresentation(
    policy: DecisionFlowPolicy | undefined,
    item: QuestionItem,
    context: "response" | "write-in",
): DecisionNotePresentation {
    return policy?.notePresentation?.(item, context) ?? {};
}

export function optionDisplayText(option: QuestionOption): string {
    return option.description === undefined ? option.label : `${option.label} — ${option.description}`;
}

export interface QuestionResponseFormatPolicy {
    formatText?: (value: string) => string;
    formatResponseNote?: (value: string) => string;
}

export function formatQuestionResponse(
    question: QuestionItem,
    response: QuestionResponse,
    policy: QuestionResponseFormatPolicy = {},
): string {
    const formatText = policy.formatText ?? (value => value);
    const formatResponseNote = policy.formatResponseNote ?? (value => ` — note: ${value}`);
    const noteSuffix = (note: string | undefined): string =>
        note === undefined ? "" : formatResponseNote(note);
    const optionLabel = (value: string): string =>
        question.options?.find(option => option.value === value)?.label ?? value;

    if (response.kind === "text" || response.kind === "write-in") return formatText(response.value);
    if (response.kind === "single") {
        return `${optionLabel(response.value)}${noteSuffix(response.note)}`;
    }
    return [
        ...response.values.map(selected => `${optionLabel(selected.value)}${noteSuffix(selected.note)}`),
        ...(response.writeIn === undefined ? [] : [formatText(response.writeIn)]),
    ].join(", ");
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

export function validateQuestionParameters(params: QuestionParameters): void {
    if (params.questions.length === 0) throw new Error("questions must contain at least one question");
    requireUnique(params.questions.map(question => question.id), id => `Question id must be unique: ${id}`);
    for (const question of params.questions) {
        if (Object.prototype.hasOwnProperty.call(question, "notePlaceholder")) {
            throw new Error(`notePlaceholder is not supported: ${question.id}`);
        }
        if (Object.prototype.hasOwnProperty.call(question, "note")) {
            throw new Error(`note is not supported: ${question.id}`);
        }
        if (Object.prototype.hasOwnProperty.call(question, "initialValue")) {
            throw new Error(`initialValue is not supported: ${question.id}`);
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
    }
}

function normalizeNote(note: string | undefined): string | undefined {
    return note === undefined || note.trim().length === 0 ? undefined : note;
}
function optionValues(question: QuestionItem): Set<string> {
    return new Set((question.options ?? []).map(option => option.value));
}

export function normalizeQuestionResponse(question: QuestionItem, pending: PendingQuestionResponse): QuestionResponse {
    if (pending.kind === "write-in") {
        if (question.kind !== "single") throw new Error(`write-in response does not match question ${question.id} (${question.kind})`);
        requireNonBlank(pending.value, `write-in response for question ${question.id} requires non-blank text`);
        return { kind: "write-in", value: pending.value.trim() === pending.value ? pending.value : pending.value.trim() };
    }
    if (pending.kind !== question.kind) {
        throw new Error(`Response kind ${pending.kind} does not match question ${question.id} (${question.kind})`);
    }
    switch (pending.kind) {
        case "single": {
            if (!optionValues(question).has(pending.value)) throw new Error(`Unknown option value for question ${question.id}: ${pending.value}`);
            const note = normalizeNote(pending.note);
            return note === undefined ? { kind: "single", value: pending.value } : { kind: "single", value: pending.value, note };
        }
        case "multi": {
            const writeIn = normalizeNote(pending.writeIn);
            if (pending.values.length === 0 && writeIn === undefined) throw new Error(`multi question ${question.id} requires at least one selection or a write-in`);
            const allowed = optionValues(question);
            const selected = new Map<string, string | undefined>();
            for (const item of pending.values) {
                if (!allowed.has(item.value)) throw new Error(`Unknown option value for question ${question.id}: ${item.value}`);
                if (selected.has(item.value)) throw new Error(`Duplicate selected value for question ${question.id}: ${item.value}`);
                selected.set(item.value, normalizeNote(item.note));
            }
            const values = (question.options ?? [])
                .filter(option => selected.has(option.value))
                .map(option => {
                    const note = selected.get(option.value);
                    return note === undefined ? { value: option.value } : { value: option.value, note };
                });
            return writeIn === undefined ? { kind: "multi", values } : { kind: "multi", values, writeIn };
        }
        case "text":
            requireNonBlank(pending.value, `text question ${question.id} requires a non-blank answer`);
            return { kind: "text", value: pending.value };
    }
}

export class QuestionProgress {
    readonly #questions: readonly QuestionItem[];
    readonly #responses = new Map<string, QuestionResponse>();
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
    responseFor(questionOrId: QuestionItem | string): QuestionResponse | undefined {
        return this.#responses.get(typeof questionOrId === "string" ? questionOrId : questionOrId.id);
    }
    isAnswered(questionOrId: QuestionItem | string): boolean {
        return this.responseFor(questionOrId) !== undefined;
    }
    isUntouched(questionOrId: QuestionItem | string): boolean {
        return this.responseFor(questionOrId) === undefined;
    }
    isResponded(questionOrId: QuestionItem | string): boolean {
        return !this.isUntouched(questionOrId);
    }
    get answeredCount(): number {
        let count = 0;
        for (const question of this.#questions) if (this.isAnswered(question)) count += 1;
        return count;
    }
    get respondedCount(): number { return this.answeredCount; }
    get untouchedCount(): number { return this.total - this.respondedCount; }
    get allAnswered(): boolean { return this.answeredCount === this.total; }
    get allResponded(): boolean { return this.untouchedCount === 0; }
    nextUntouched(after = this.#index): number | undefined {
        for (let offset = 1; offset <= this.total; offset += 1) {
            const index = (after + offset) % this.total;
            if (this.isUntouched(this.#questions[index]!)) return index;
        }
        return undefined;
    }
    submit(pending: PendingQuestionResponse): QuestionResponse {
        const response = normalizeQuestionResponse(this.current, pending);
        this.#responses.set(this.current.id, response);
        return response;
    }
    clear(questionOrId: QuestionItem | string = this.current): void {
        this.#responses.delete(typeof questionOrId === "string" ? questionOrId : questionOrId.id);
    }
    submitted(): QuestionResultDetails {
        return { status: "submitted", responses: Object.fromEntries(this.#responses) };
    }
    cancelled(includeCurrentQuestion = true): QuestionResultDetails {
        const base = { status: "cancelled" as const, responses: Object.fromEntries(this.#responses) };
        return includeCurrentQuestion ? { ...base, currentQuestionId: this.current.id } : base;
    }
}

export function unavailableResult(): QuestionResultDetails { return { status: "unavailable", responses: {} }; }
export function buildQuestionToolResult(details: QuestionResultDetails): QuestionToolResult {
    return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
}
