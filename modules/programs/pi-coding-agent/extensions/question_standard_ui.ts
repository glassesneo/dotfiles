import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
    optionDisplayText,
    QuestionProgress,
    unavailableResult,
    type PendingQuestionAnswer,
    type QuestionAnswer,
    type QuestionItem,
    type QuestionOption,
    type QuestionResultDetails,
} from "./question_core.ts";

export interface StandardQuestionContext {
    hasUI: boolean;
    ui: Pick<ExtensionUIContext, "select" | "input" | "editor" | "notify">;
}

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
    if (answer?.kind === "multi" && value !== undefined) {
        return answer.values.find(selected => selected.value === value)?.note;
    }
    return undefined;
}

async function askNote(
    ui: StandardQuestionContext["ui"],
    question: QuestionItem,
    label: string,
    existing: string | undefined,
    signal: AbortSignal | undefined,
): Promise<string | undefined | null> {
    if (isCancelled(signal)) return null;
    const note = await ui.editor(
        `Optional note for ${label}${question.notePlaceholder === undefined ? "" : ` — ${question.notePlaceholder}`}`,
        existing ?? "",
    );
    if (note === undefined || isCancelled(signal)) return null;
    return note;
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
): Promise<PendingQuestionAnswer | undefined> {
    const options = question.options ?? [];
    const current = existing?.kind === "single" ? existing.value : undefined;
    const displays = markedOptions(options, current);
    const selected = await context.ui.select(title, displays, { signal });
    if (selected === undefined || isCancelled(signal)) return undefined;
    const option = options[displays.indexOf(selected)];
    if (option === undefined) throw new Error(`Standard UI returned an unknown option: ${selected}`);
    const note = await askNote(context.ui, question, option.label, noteFrom(existing), signal);
    if (note === null) return undefined;
    return { kind: "single", value: option.value, note };
}

async function askMulti(
    context: StandardQuestionContext,
    question: QuestionItem,
    title: string,
    existing: QuestionAnswer | undefined,
    signal: AbortSignal | undefined,
): Promise<PendingQuestionAnswer | undefined> {
    const options = question.options ?? [];
    const selectedValues = new Set(
        existing?.kind === "multi" ? existing.values.map(selected => selected.value) : [],
    );
    const rawDisplays = new Set(options.map(optionDisplayText));
    const doneLabel = uniqueLabel("Done — confirm selections", rawDisplays);

    while (true) {
        if (isCancelled(signal)) return undefined;
        const displays = options.map(option =>
            `${selectedValues.has(option.value) ? "[x]" : "[ ]"} ${optionDisplayText(option)}`,
        );
        const selected = await context.ui.select(
            `${title} (toggle items, then choose Done)`,
            [...displays, doneLabel],
            { signal },
        );
        if (selected === undefined || isCancelled(signal)) return undefined;
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
    for (const option of options) {
        if (!selectedValues.has(option.value)) continue;
        const note = await askNote(
            context.ui,
            question,
            option.label,
            noteFrom(existing, option.value),
            signal,
        );
        if (note === null) return undefined;
        values.push({ value: option.value, note });
    }
    return { kind: "multi", values };
}

async function askConfirm(
    context: StandardQuestionContext,
    question: QuestionItem,
    title: string,
    existing: QuestionAnswer | undefined,
    signal: AbortSignal | undefined,
): Promise<PendingQuestionAnswer | undefined> {
    const current = existing?.kind === "confirm" ? String(existing.value) : undefined;
    const displays = [
        `${current === "true" ? "[current]" : "[ ]"} Yes`,
        `${current === "false" ? "[current]" : "[ ]"} No`,
    ];
    const selected = await context.ui.select(title, displays, { signal });
    if (selected === undefined || isCancelled(signal)) return undefined;
    const index = displays.indexOf(selected);
    if (index < 0) throw new Error(`Standard UI returned an unknown confirmation: ${selected}`);
    const note = await askNote(
        context.ui,
        question,
        index === 0 ? "Yes" : "No",
        noteFrom(existing),
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
): Promise<PendingQuestionAnswer | undefined> {
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
): Promise<PendingQuestionAnswer | undefined> {
    const title = progressTitle(question, index, total);
    switch (question.kind) {
        case "single":
            return askSingle(context, question, title, existing, signal);
        case "multi":
            return askMulti(context, question, title, existing, signal);
        case "confirm":
            return askConfirm(context, question, title, existing, signal);
        case "text":
            return askText(context, question, title, existing, signal);
    }
}

function summarizeAnswer(question: QuestionItem, answer: QuestionAnswer): string {
    if (answer.kind === "text") return answer.value;
    if (answer.kind === "confirm") return `${answer.value ? "Yes" : "No"}${answer.note === undefined ? "" : ` — note: ${answer.note}`}`;
    if (answer.kind === "single") {
        const label = question.options?.find(option => option.value === answer.value)?.label ?? answer.value;
        return `${label}${answer.note === undefined ? "" : ` — note: ${answer.note}`}`;
    }
    return answer.values
        .map(selected => {
            const label = question.options?.find(option => option.value === selected.value)?.label ?? selected.value;
            return `${label}${selected.note === undefined ? "" : ` (note: ${selected.note})`}`;
        })
        .join(", ");
}

export async function runStandardQuestionFlow(
    context: StandardQuestionContext,
    questions: readonly QuestionItem[],
    signal?: AbortSignal,
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
        );
        if (pending === undefined) return progress.cancelled();
        progress.submit(pending);
    }

    while (true) {
        if (isCancelled(signal)) return progress.cancelled(false);
        const questionLabels = questions.map((question, index) =>
            `Q${index + 1}: ${question.prompt} — ${summarizeAnswer(question, progress.answerFor(question)!)}`,
        );
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
        if (selected === submitLabel) return progress.answered();

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
        );
        if (pending === undefined) return progress.cancelled(false);
        progress.submit(pending);
    }
}
