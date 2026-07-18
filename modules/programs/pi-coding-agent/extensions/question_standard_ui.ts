import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
    optionDisplayText,
    QuestionProgress,
    unavailableResult,
    type PendingQuestionAnswer,
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

function displayMap(options: readonly QuestionOption[]): Map<string, string> {
    return new Map(options.map(option => [optionDisplayText(option), option.value]));
}

function progressTitle(
    question: QuestionItem,
    index: number,
    total: number,
): string {
    return `Question ${index + 1}/${total}: ${question.prompt}`;
}

function uniqueDoneLabel(displays: ReadonlySet<string>): string {
    const base = "Done — confirm selections";
    let label = base;
    let suffix = 2;
    while (displays.has(label)) {
        label = `${base} (${suffix})`;
        suffix += 1;
    }
    return label;
}

async function askNote(
    ui: StandardQuestionContext["ui"],
    question: QuestionItem,
    label: string,
    signal: AbortSignal | undefined,
): Promise<string | undefined | null> {
    if (isCancelled(signal)) return null;
    const note = await ui.input(
        `Optional note for ${label}`,
        question.notePlaceholder ?? "Leave blank for no note",
        { signal },
    );
    if (note === undefined || isCancelled(signal)) return null;
    return note;
}

async function askSingle(
    context: StandardQuestionContext,
    question: QuestionItem,
    title: string,
    signal: AbortSignal | undefined,
): Promise<PendingQuestionAnswer | undefined> {
    const options = question.options ?? [];
    const byDisplay = displayMap(options);
    const selected = await context.ui.select(title, [...byDisplay.keys()], { signal });
    if (selected === undefined || isCancelled(signal)) return undefined;

    const value = byDisplay.get(selected);
    if (value === undefined) {
        throw new Error(`Standard UI returned an unknown option: ${selected}`);
    }
    const option = options.find(candidate => candidate.value === value);
    if (option === undefined) {
        throw new Error(`Missing option for value: ${value}`);
    }
    const note = await askNote(context.ui, question, option.label, signal);
    if (note === null) return undefined;
    return { kind: "single", value, note };
}

async function askMulti(
    context: StandardQuestionContext,
    question: QuestionItem,
    title: string,
    signal: AbortSignal | undefined,
): Promise<PendingQuestionAnswer | undefined> {
    const options = question.options ?? [];
    const selectedValues = new Set<string>();
    const rawDisplays = new Set(options.map(optionDisplayText));
    const doneLabel = uniqueDoneLabel(rawDisplays);

    while (true) {
        if (isCancelled(signal)) return undefined;
        const displays = options.map(option => {
            const marker = selectedValues.has(option.value) ? "[x]" : "[ ]";
            return `${marker} ${optionDisplayText(option)}`;
        });
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

        const index = displays.indexOf(selected);
        const option = options[index];
        if (option === undefined) {
            throw new Error(`Standard UI returned an unknown multi option: ${selected}`);
        }
        if (selectedValues.has(option.value)) {
            selectedValues.delete(option.value);
        } else {
            selectedValues.add(option.value);
        }
    }

    const values: Array<{ value: string; note?: string }> = [];
    for (const option of options) {
        if (!selectedValues.has(option.value)) continue;
        const note = await askNote(context.ui, question, option.label, signal);
        if (note === null) return undefined;
        values.push({ value: option.value, note });
    }
    return { kind: "multi", values };
}

async function askConfirm(
    context: StandardQuestionContext,
    question: QuestionItem,
    title: string,
    signal: AbortSignal | undefined,
): Promise<PendingQuestionAnswer | undefined> {
    const selected = await context.ui.select(title, ["Yes", "No"], { signal });
    if (selected === undefined || isCancelled(signal)) return undefined;
    if (selected !== "Yes" && selected !== "No") {
        throw new Error(`Standard UI returned an unknown confirmation: ${selected}`);
    }

    const note = await askNote(context.ui, question, selected, signal);
    if (note === null) return undefined;
    return { kind: "confirm", value: selected === "Yes", note };
}

async function askText(
    context: StandardQuestionContext,
    question: QuestionItem,
    title: string,
    signal: AbortSignal | undefined,
): Promise<PendingQuestionAnswer | undefined> {
    let prefill = question.initialValue;
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
    signal: AbortSignal | undefined,
): Promise<PendingQuestionAnswer | undefined> {
    const title = progressTitle(question, index, total);
    switch (question.kind) {
        case "single":
            return askSingle(context, question, title, signal);
        case "multi":
            return askMulti(context, question, title, signal);
        case "confirm":
            return askConfirm(context, question, title, signal);
        case "text":
            return askText(context, question, title, signal);
    }
}

export async function runStandardQuestionFlow(
    context: StandardQuestionContext,
    questions: readonly QuestionItem[],
    signal?: AbortSignal,
): Promise<QuestionResultDetails> {
    if (!context.hasUI) return unavailableResult();

    const progress = new QuestionProgress(questions);
    while (progress.current !== undefined) {
        const pending = await askQuestion(
            context,
            progress.current,
            progress.index,
            progress.total,
            signal,
        );
        if (pending === undefined) return progress.cancelled();
        const completed = progress.submit(pending);
        if (completed !== undefined) return completed;
    }

    throw new Error("Question flow ended without a result");
}
