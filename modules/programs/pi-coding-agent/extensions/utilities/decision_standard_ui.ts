import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
    decisionNoteRequirement,
    noteMode,
    optionDisplayText,
    QuestionProgress,
    shouldAutoSubmitSingle,
    unavailableResult,
    type DecisionFlowPolicy,
    type DecisionNoteRequirement,
    type PendingQuestionAnswer,
    type QuestionAnswer,
    type QuestionItem,
    type QuestionOption,
    type QuestionResultDetails,
} from "./decision_core.ts";

export interface StandardQuestionContext {
    hasUI: boolean;
    ui: Pick<ExtensionUIContext, "select" | "input" | "editor" | "notify">;
}

const REVIEW_NOW = Symbol("review-now");
type QuestionStepResult = PendingQuestionAnswer | typeof REVIEW_NOW | undefined;

function isCancelled(signal: AbortSignal | undefined): boolean {
    return signal?.aborted === true;
}

function progressTitle(question: QuestionItem, index: number, total: number): string {
    return `Question ${index + 1}/${total}: ${question.prompt}`;
}

function uniqueLabel(base: string, displays: ReadonlySet<string>): string {
    let label = base;
    let suffix = 2;
    while (displays.has(label)) {
        label = `${base} (${suffix})`;
        suffix += 1;
    }
    return label;
}

function noteFrom(answer: QuestionAnswer | undefined, value?: string): string | undefined {
    if (answer?.kind === "single" || answer?.kind === "confirm") return answer.note;
    if (answer?.kind === "multi") {
        if (value === undefined) return answer.note;
        return answer.values.find(selected => selected.value === value)?.note;
    }
    return undefined;
}

async function askNote(
    ui: StandardQuestionContext["ui"],
    question: QuestionItem,
    label: string,
    existing: string | undefined,
    requirement: DecisionNoteRequirement,
    signal: AbortSignal | undefined,
): Promise<string | undefined | null> {
    if (requirement === "none") return undefined;
    let prefill = existing ?? "";
    while (true) {
        if (isCancelled(signal)) return null;
        const fallback = requirement === "required" ? `Required note for ${label}` : `Optional note for ${label}`;
        const title = question.note?.prompt ?? fallback;
        const placeholder = question.note?.placeholder;
        const note = await ui.editor(
            placeholder === undefined ? title : `${title} — ${placeholder}`,
            prefill,
        );
        if (note === undefined || isCancelled(signal)) return null;
        if (requirement !== "required" || note.trim().length > 0) return note;
        ui.notify("Enter a non-blank note to continue.", "warning");
        prefill = note;
    }
}

function markedOptions(
    options: readonly QuestionOption[],
    currentValue: string | undefined,
): string[] {
    return options.map(option =>
        `${option.value === currentValue ? "[current]" : "[ ]"} ${optionDisplayText(option)}`,
    );
}

async function askSingle(
    context: StandardQuestionContext,
    question: QuestionItem,
    title: string,
    existing: QuestionAnswer | undefined,
    signal: AbortSignal | undefined,
    policy: DecisionFlowPolicy | undefined,
    reviewActionLabel: string,
): Promise<QuestionStepResult> {
    const options = question.options ?? [];
    const current = existing?.kind === "single" ? existing.value : undefined;
    const displays = markedOptions(options, current);
    const reviewLabel = uniqueLabel(reviewActionLabel, new Set(displays));
    const selected = await context.ui.select(title, [...displays, reviewLabel], { signal });
    if (selected === undefined || isCancelled(signal)) return undefined;
    if (selected === reviewLabel) return REVIEW_NOW;
    const option = options[displays.indexOf(selected)];
    if (option === undefined) throw new Error(`Standard UI returned an unknown option: ${selected}`);
    const requirement = decisionNoteRequirement(policy, question, option);
    const note = await askNote(context.ui, question, option.label, noteFrom(existing), requirement, signal);
    if (note === null) return undefined;
    return { kind: "single", value: option.value, note };
}

async function askMulti(
    context: StandardQuestionContext,
    question: QuestionItem,
    title: string,
    existing: QuestionAnswer | undefined,
    signal: AbortSignal | undefined,
    policy: DecisionFlowPolicy | undefined,
    reviewActionLabel: string,
): Promise<QuestionStepResult> {
    const options = question.options ?? [];
    const selectedValues = new Set(
        existing?.kind === "multi" ? existing.values.map(selected => selected.value) : [],
    );
    const rawDisplays = new Set(options.map(optionDisplayText));
    const doneLabel = uniqueLabel("Done — confirm selections", rawDisplays);
    rawDisplays.add(doneLabel);
    const reviewLabel = uniqueLabel(reviewActionLabel, rawDisplays);

    while (true) {
        if (isCancelled(signal)) return undefined;
        const displays = options.map(option =>
            `${selectedValues.has(option.value) ? "[x]" : "[ ]"} ${optionDisplayText(option)}`,
        );
        const selected = await context.ui.select(
            `${title} (toggle items, then choose Done)`,
            [...displays, doneLabel, reviewLabel],
            { signal },
        );
        if (selected === undefined || isCancelled(signal)) return undefined;
        if (selected === reviewLabel) return REVIEW_NOW;
        if (selected === doneLabel) {
            if (selectedValues.size > 0) break;
            context.ui.notify("Select at least one option before choosing Done.", "warning");
            continue;
        }
        const option = options[displays.indexOf(selected)];
        if (option === undefined) {
            throw new Error(`Standard UI returned an unknown multi option: ${selected}`);
        }
        if (selectedValues.has(option.value)) selectedValues.delete(option.value);
        else selectedValues.add(option.value);
    }

    const values: Array<{ value: string; note?: string }> = [];
    if (noteMode(question) === "per-option") {
        for (const option of options) {
            if (!selectedValues.has(option.value)) continue;
            const requirement = decisionNoteRequirement(policy, question, option);
            const note = await askNote(context.ui, question, option.label, noteFrom(existing, option.value), requirement, signal);
            if (note === null) return undefined;
            values.push({ value: option.value, note });
        }
        return { kind: "multi", values };
    }
    for (const option of options) if (selectedValues.has(option.value)) values.push({ value: option.value });
    const requirement = decisionNoteRequirement(policy, question);
    const note = await askNote(context.ui, question, "answer", noteFrom(existing), requirement, signal);
    if (note === null) return undefined;
    return { kind: "multi", values, note };
}

async function askConfirm(
    context: StandardQuestionContext,
    question: QuestionItem,
    title: string,
    existing: QuestionAnswer | undefined,
    signal: AbortSignal | undefined,
    policy: DecisionFlowPolicy | undefined,
    reviewActionLabel: string,
): Promise<QuestionStepResult> {
    const current = existing?.kind === "confirm" ? String(existing.value) : undefined;
    const displays = [
        `${current === "true" ? "[current]" : "[ ]"} Yes`,
        `${current === "false" ? "[current]" : "[ ]"} No`,
    ];
    const reviewLabel = uniqueLabel(reviewActionLabel, new Set(displays));
    const selected = await context.ui.select(title, [...displays, reviewLabel], { signal });
    if (selected === undefined || isCancelled(signal)) return undefined;
    if (selected === reviewLabel) return REVIEW_NOW;
    const index = displays.indexOf(selected);
    if (index < 0) throw new Error(`Standard UI returned an unknown confirmation: ${selected}`);
    const note = await askNote(
        context.ui,
        question,
        index === 0 ? "Yes" : "No",
        noteFrom(existing),
        decisionNoteRequirement(policy, question, {
            value: String(index === 0),
            label: index === 0 ? "Yes" : "No",
        }),
        signal,
    );
    if (note === null) return undefined;
    return { kind: "confirm", value: index === 0, note };
}

async function askText(
    context: StandardQuestionContext,
    question: QuestionItem,
    title: string,
    existing: QuestionAnswer | undefined,
    signal: AbortSignal | undefined,
    _policy: DecisionFlowPolicy | undefined,
    reviewActionLabel: string,
): Promise<QuestionStepResult> {
    const action = await context.ui.select(title, ["Answer this question", reviewActionLabel], { signal });
    if (action === undefined || isCancelled(signal)) return undefined;
    if (action === reviewActionLabel) return REVIEW_NOW;
    let prefill = existing?.kind === "text" ? existing.value : question.initialValue;
    while (true) {
        if (isCancelled(signal)) return undefined;
        const value = await context.ui.editor(title, prefill);
        if (value === undefined || isCancelled(signal)) return undefined;
        if (value.trim().length > 0) return { kind: "text", value };
        context.ui.notify("Enter a non-blank answer to continue.", "warning");
        prefill = value;
    }
}

async function askQuestion(
    context: StandardQuestionContext,
    question: QuestionItem,
    index: number,
    total: number,
    existing: QuestionAnswer | undefined,
    signal: AbortSignal | undefined,
    policy: DecisionFlowPolicy | undefined,
): Promise<QuestionStepResult> {
    const title = progressTitle(question, index, total);
    const reviewActionLabel = total === 1 && shouldAutoSubmitSingle(policy)
        ? "Submit without answering"
        : "Review answers now";
    switch (question.kind) {
        case "single":
            return askSingle(context, question, title, existing, signal, policy, reviewActionLabel);
        case "multi":
            return askMulti(context, question, title, existing, signal, policy, reviewActionLabel);
        case "confirm":
            return askConfirm(context, question, title, existing, signal, policy, reviewActionLabel);
        case "text":
            return askText(context, question, title, existing, signal, policy, reviewActionLabel);
    }
}

function summarizeAnswer(question: QuestionItem, answer: QuestionAnswer): string {
    if (answer.kind === "text") return answer.value;
    if (answer.kind === "confirm") return `${answer.value ? "Yes" : "No"}${answer.note === undefined ? "" : ` — note: ${answer.note}`}`;
    if (answer.kind === "single") {
        const label = question.options?.find(option => option.value === answer.value)?.label ?? answer.value;
        return `${label}${answer.note === undefined ? "" : ` — note: ${answer.note}`}`;
    }
    const values = answer.values
        .map(selected => {
            const label = question.options?.find(option => option.value === selected.value)?.label ?? selected.value;
            return `${label}${selected.note === undefined ? "" : ` (note: ${selected.note})`}`;
        })
        .join(", ");
    return `${values}${answer.note === undefined ? "" : ` — note: ${answer.note}`}`;
}

export async function runStandardDecisionFlow(
    context: StandardQuestionContext,
    questions: readonly QuestionItem[],
    signal?: AbortSignal,
    policy?: DecisionFlowPolicy,
): Promise<QuestionResultDetails> {
    if (!context.hasUI) return unavailableResult();

    const progress = new QuestionProgress(questions);
    for (let index = 0; index < questions.length; index += 1) {
        progress.moveTo(index);
        const pending = await askQuestion(
            context,
            progress.current,
            index,
            progress.total,
            undefined,
            signal,
            policy,
        );
        if (pending === undefined) return progress.cancelled();
        if (pending === REVIEW_NOW) {
            if (questions.length === 1 && shouldAutoSubmitSingle(policy)) return progress.submitted();
            break;
        }
        progress.submit(pending);
        if (questions.length === 1 && shouldAutoSubmitSingle(policy)) return progress.submitted();
    }

    while (true) {
        if (isCancelled(signal)) return progress.cancelled(false);
        const questionLabels = questions.map((question, index) => {
            const answer = progress.answerFor(question);
            return `Q${index + 1}: ${question.prompt} — ${answer === undefined ? "Unanswered" : summarizeAnswer(question, answer)}`;
        });
        const used = new Set(questionLabels);
        const submitLabel = uniqueLabel("Submit answers", used);
        used.add(submitLabel);
        const cancelLabel = uniqueLabel("Cancel", used);
        const selected = await context.ui.select(
            "Review answers (choose a question to revise)",
            [...questionLabels, submitLabel, cancelLabel],
            { signal },
        );
        if (selected === undefined || selected === cancelLabel || isCancelled(signal)) {
            return progress.cancelled(false);
        }
        if (selected === submitLabel) return progress.submitted();

        const index = questionLabels.indexOf(selected);
        if (index < 0) throw new Error(`Standard UI returned an unknown review item: ${selected}`);
        progress.moveTo(index);
        const pending = await askQuestion(
            context,
            progress.current,
            index,
            progress.total,
            progress.answerFor(progress.current),
            signal,
            policy,
        );
        if (pending === undefined) return progress.cancelled(false);
        if (pending !== REVIEW_NOW) progress.submit(pending);
    }
}

export const runStandardQuestionFlow = runStandardDecisionFlow;
