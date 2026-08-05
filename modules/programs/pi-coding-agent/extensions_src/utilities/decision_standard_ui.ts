import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
    decisionNoteRequirement,
    formatQuestionResponse,
    notePresentation,
    QuestionProgress,
    shouldAllowWriteIn,
    shouldAutoSubmitSingle,
    unavailableResult,
    type DecisionFlowPolicy,
    type DecisionNoteRequirement,
    type PendingQuestionResponse,
    type QuestionItem,
    type QuestionOption,
    type QuestionResponse,
    type QuestionResultDetails,
} from "./decision_core.ts";

export interface StandardQuestionContext {
    hasUI: boolean;
    ui: Pick<ExtensionUIContext, "select" | "editor" | "notify">;
}

const REVIEW_NOW = Symbol("review-now");
const DELETE_RESPONSE = Symbol("delete-response");
type QuestionStepResult = PendingQuestionResponse | typeof REVIEW_NOW | typeof DELETE_RESPONSE | undefined;

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

function noteFrom(response: QuestionResponse | undefined, value?: string): string | undefined {
    if (response?.kind === "single") return value === undefined || response.value === value ? response.note : undefined;
    if (response?.kind === "multi") {
        if (value === undefined) return undefined;
        return response.values.find(selected => selected.value === value)?.note;
    }
    return undefined;
}

async function askNote(
    ui: StandardQuestionContext["ui"],
    question: QuestionItem,
    context: "response" | "write-in",
    label: string,
    existing: string | undefined,
    requirement: DecisionNoteRequirement,
    signal: AbortSignal | undefined,
    policy: DecisionFlowPolicy | undefined,
): Promise<string | undefined | null> {
    if (requirement === "none") return undefined;
    let prefill = existing ?? "";
    while (true) {
        if (isCancelled(signal)) return null;
        const presentation = notePresentation(policy, question, context);
        const fallback = context === "write-in"
            ? "Write another response"
            : requirement === "required" ? `Required note for ${label}` : `Optional note for ${label}`;
        const title = presentation.prompt ?? fallback;
        const editorTitle = presentation.placeholder === undefined ? title : `${title} — ${presentation.placeholder}`;
        const note = await ui.editor(editorTitle, prefill);
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
        `${option.value === currentValue ? "[current]" : "[ ]"} ${option.label}${option.description ? ` — ${option.description}` : ""}`,
    );
}

function writeInLabel(displays: ReadonlySet<string>): string {
    return uniqueLabel("Write another response…", displays);
}

async function askWriteIn(
    ui: StandardQuestionContext["ui"],
    question: QuestionItem,
    existing: string | undefined,
    signal: AbortSignal | undefined,
    policy: DecisionFlowPolicy | undefined,
): Promise<string | undefined | null> {
    let prefill = existing ?? "";
    while (true) {
        if (isCancelled(signal)) return null;
        const value = await ui.editor(notePresentation(policy, question, "write-in").prompt ?? "Write another response", prefill);
        if (value === undefined || isCancelled(signal)) return null;
        if (value.trim().length > 0) return value;
        if (existing !== undefined) return undefined;
        ui.notify("Enter a non-blank response to continue.", "warning");
        prefill = value;
    }
}

async function askSingle(
    context: StandardQuestionContext,
    question: QuestionItem,
    title: string,
    existing: QuestionResponse | undefined,
    signal: AbortSignal | undefined,
    policy: DecisionFlowPolicy | undefined,
    reviewActionLabel: string,
): Promise<QuestionStepResult> {
    const options = question.options ?? [];
    const current = existing?.kind === "single" ? existing.value : undefined;
    const displays = markedOptions(options, current);
    const displaySet = new Set(displays);
    const writeLabel = shouldAllowWriteIn(policy) ? writeInLabel(displaySet) : undefined;
    if (writeLabel !== undefined) displaySet.add(writeLabel);
    const reviewLabel = uniqueLabel(reviewActionLabel, displaySet);
    while (true) {
        const selected = await context.ui.select(title, [...displays, ...(writeLabel ? [writeLabel] : []), reviewLabel], { signal });
        if (selected === undefined || isCancelled(signal)) return undefined;
        if (selected === reviewLabel) return REVIEW_NOW;
        if (selected === writeLabel) {
            const value = await askWriteIn(context.ui, question, existing?.kind === "write-in" ? existing.value : undefined, signal, policy);
            if (isCancelled(signal)) return undefined;
            if (value === null) continue;
            if (value === undefined) return DELETE_RESPONSE;
            return { kind: "write-in", value };
        }
        const option = options[displays.indexOf(selected)];
        if (option === undefined) throw new Error(`Standard UI returned an unknown option: ${selected}`);
        const requirement = decisionNoteRequirement(policy, question, option);
        const note = await askNote(context.ui, question, "response", option.label, noteFrom(existing, option.value), requirement, signal, policy);
        if (note === null) {
            if (isCancelled(signal)) return undefined;
            continue;
        }
        return note === undefined
            ? { kind: "single", value: option.value }
            : { kind: "single", value: option.value, note };
    }
}

async function askMulti(
    context: StandardQuestionContext,
    question: QuestionItem,
    title: string,
    existing: QuestionResponse | undefined,
    signal: AbortSignal | undefined,
    policy: DecisionFlowPolicy | undefined,
    reviewActionLabel: string,
): Promise<QuestionStepResult> {
    const options = question.options ?? [];
    const selectedValues = new Set(
        existing?.kind === "multi" ? existing.values.map(selected => selected.value) : [],
    );
    const notes = new Map(existing?.kind === "multi"
        ? existing.values.filter(value => value.note !== undefined).map(value => [value.value, value.note!])
        : []);
    const completedNotes = new Set<string>();
    let writeIn = existing?.kind === "multi" ? existing.writeIn : undefined;
    const controlDisplays = new Set<string>();
    for (const option of options) {
        const display = `${option.label}${option.description ? ` — ${option.description}` : ""}`;
        controlDisplays.add(`[ ] ${display}`);
        controlDisplays.add(`[x] ${display}`);
    }
    const doneLabel = uniqueLabel("Done — confirm selections", controlDisplays);
    controlDisplays.add(doneLabel);
    const writeLabel = shouldAllowWriteIn(policy) ? writeInLabel(controlDisplays) : undefined;
    if (writeLabel !== undefined) controlDisplays.add(writeLabel);
    const reviewLabel = uniqueLabel(reviewActionLabel, controlDisplays);

    choiceLoop: while (true) {
        if (isCancelled(signal)) return undefined;
        const displays = options.map(option =>
            `${selectedValues.has(option.value) ? "[x]" : "[ ]"} ${option.label}${option.description ? ` — ${option.description}` : ""}`,
        );
        const selected = await context.ui.select(
            `${title} (toggle items, then choose Done)`,
            [...displays, doneLabel, ...(writeLabel ? [writeLabel] : []), reviewLabel],
            { signal },
        );
        if (selected === undefined || isCancelled(signal)) return undefined;
        if (selected === reviewLabel) return REVIEW_NOW;
        if (selected === writeLabel) {
            const value = await askWriteIn(context.ui, question, writeIn, signal, policy);
            if (isCancelled(signal)) return undefined;
            if (value === null) continue;
            writeIn = value;
            continue;
        }
        if (selected === doneLabel) {
            if (selectedValues.size === 0 && writeIn === undefined) {
                context.ui.notify("Select at least one option or write another response before choosing Done.", "warning");
                continue;
            }
            const values: Array<{ value: string; note?: string }> = [];
            for (const option of options) {
                if (!selectedValues.has(option.value)) continue;
                const requirement = decisionNoteRequirement(policy, question, option);
                let note = notes.get(option.value);
                if ((requirement === "optional" && !completedNotes.has(option.value)) || (requirement === "required" && note === undefined)) {
                    const entered = await askNote(context.ui, question, "response", option.label, note ?? noteFrom(existing, option.value), requirement, signal, policy);
                    if (entered === null) {
                        if (isCancelled(signal)) return undefined;
                        continue choiceLoop;
                    }
                    note = entered;
                    completedNotes.add(option.value);
                    if (entered === undefined) notes.delete(option.value);
                    else notes.set(option.value, entered);
                }
                values.push(note === undefined ? { value: option.value } : { value: option.value, note });
            }
            return writeIn === undefined ? { kind: "multi", values } : { kind: "multi", values, writeIn };
        }
        const option = options[displays.indexOf(selected)];
        if (option === undefined) {
            throw new Error(`Standard UI returned an unknown multi option: ${selected}`);
        }
        if (selectedValues.has(option.value)) {
            selectedValues.delete(option.value);
            notes.delete(option.value);
            completedNotes.delete(option.value);
        } else if (decisionNoteRequirement(policy, question, option) === "required") {
            const note = await askNote(context.ui, question, "response", option.label, notes.get(option.value), "required", signal, policy);
            if (isCancelled(signal)) return undefined;
            if (note === null) continue;
            if (note !== undefined) notes.set(option.value, note);
            completedNotes.add(option.value);
            selectedValues.add(option.value);
        } else selectedValues.add(option.value);
    }
}

async function askText(
    context: StandardQuestionContext,
    question: QuestionItem,
    title: string,
    existing: QuestionResponse | undefined,
    signal: AbortSignal | undefined,
    _policy: DecisionFlowPolicy | undefined,
    reviewActionLabel: string,
): Promise<QuestionStepResult> {
    const action = await context.ui.select(title, ["Answer this question", reviewActionLabel], { signal });
    if (action === undefined || isCancelled(signal)) return undefined;
    if (action === reviewActionLabel) return REVIEW_NOW;
    let prefill = existing?.kind === "text" ? existing.value : undefined;
    while (true) {
        if (isCancelled(signal)) return undefined;
        const value = await context.ui.editor(title, prefill);
        if (value === undefined || isCancelled(signal)) return undefined;
        if (value.trim().length > 0) return { kind: "text", value };
        context.ui.notify("Enter a non-blank answer to continue.", "warning");
        prefill = value;
    }
}

function responseReviewLabel(question: QuestionItem, index: number, response: QuestionResponse | undefined): string {
    const prefix = `Q${index + 1}: ${question.prompt} — `;
    if (response === undefined) return `${prefix}Untouched`;
    return `${prefix}${formatQuestionResponse(question, response)}`;
}

async function askQuestion(
    context: StandardQuestionContext,
    question: QuestionItem,
    index: number,
    total: number,
    existing: QuestionResponse | undefined,
    signal: AbortSignal | undefined,
    policy: DecisionFlowPolicy | undefined,
): Promise<QuestionStepResult> {
    const title = progressTitle(question, index, total);
    const reviewActionLabel = total === 1 && shouldAutoSubmitSingle(policy)
        ? "Submit without responding"
        : "Review responses now";
    switch (question.kind) {
        case "single":
            return askSingle(context, question, title, existing, signal, policy, reviewActionLabel);
        case "multi":
            return askMulti(context, question, title, existing, signal, policy, reviewActionLabel);
        case "text":
            return askText(context, question, title, existing, signal, policy, reviewActionLabel);
    }
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
        if (pending === DELETE_RESPONSE) progress.clear();
        else progress.submit(pending);
        if (questions.length === 1 && shouldAutoSubmitSingle(policy)) return progress.submitted();
    }

    while (true) {
        if (isCancelled(signal)) return progress.cancelled(false);
        const questionLabels = questions.map((question, index) =>
            responseReviewLabel(question, index, progress.responseFor(question)),
        );
        const used = new Set(questionLabels);
        const submitLabel = uniqueLabel("Submit responses", used);
        used.add(submitLabel);
        const cancelLabel = uniqueLabel("Cancel", used);
        const selected = await context.ui.select(
            "Review responses (choose a question to revise)",
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
            progress.responseFor(progress.current),
            signal,
            policy,
        );
        if (pending === undefined) return progress.cancelled(false);
        if (pending === DELETE_RESPONSE) progress.clear();
        else if (pending !== REVIEW_NOW) progress.submit(pending);
    }
}

export const runStandardQuestionFlow = runStandardDecisionFlow;
