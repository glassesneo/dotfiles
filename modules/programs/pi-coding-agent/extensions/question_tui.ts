import type {
    ExtensionUIContext,
    Theme,
} from "@earendil-works/pi-coding-agent";
import {
    Editor,
    type EditorTheme,
    Key,
    matchesKey,
    truncateToWidth,
    visibleWidth,
    wrapTextWithAnsi,
    type Component,
    type Focusable,
    type TUI,
} from "@earendil-works/pi-tui";
import {
    QuestionProgress,
    type PendingQuestionAnswer,
    type QuestionAnswer,
    type QuestionItem,
    type QuestionOption,
    type QuestionResultDetails,
} from "./question_core.ts";

interface DisplayChoice {
    value: string;
    label: string;
    description?: string;
}

interface ChoiceDraft {
    focusIndex: number;
    selected: Set<string>;
    notes: Map<string, string>;
}

interface TextDraft {
    value: string;
}

type QuestionDraft = ChoiceDraft | TextDraft;
type Mode =
    | "choices"
    | "note-editor"
    | "text-editor"
    | "text-tab-navigation"
    | "confirm";

interface TuiQuestionContext {
    ui: Pick<ExtensionUIContext, "custom">;
}

function editorTheme(theme: Theme): EditorTheme {
    return {
        borderColor: text => theme.fg("accent", text),
        selectList: {
            selectedPrefix: text => theme.fg("accent", text),
            selectedText: text => theme.fg("accent", text),
            description: text => theme.fg("muted", text),
            scrollInfo: text => theme.fg("dim", text),
            noMatch: text => theme.fg("warning", text),
        },
    };
}

function choicesFor(question: QuestionItem): DisplayChoice[] {
    if (question.kind === "confirm") {
        return [
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
        ];
    }
    return (question.options ?? []).map((option: QuestionOption) => ({ ...option }));
}

function appendWrapped(
    lines: string[],
    width: number,
    text: string,
    prefix = "",
): void {
    const prefixWidth = visibleWidth(prefix);
    if (prefixWidth >= width) {
        lines.push(...wrapTextWithAnsi(`${prefix}${text}`, width));
        return;
    }
    const wrapped = wrapTextWithAnsi(text, width - prefixWidth);
    const continuation = " ".repeat(prefixWidth);
    wrapped.forEach((line, index) => {
        lines.push(`${index === 0 ? prefix : continuation}${line}`);
    });
}

function choiceDraft(question: QuestionItem): ChoiceDraft {
    return { focusIndex: 0, selected: new Set(), notes: new Map() };
}

function answerSummary(question: QuestionItem, answer: QuestionAnswer): string[] {
    if (answer.kind === "text") return [answer.value];
    if (answer.kind === "confirm") {
        return [answer.value ? "Yes" : "No", ...(answer.note === undefined ? [] : [`Note: ${answer.note}`])];
    }
    if (answer.kind === "single") {
        const label = question.options?.find(option => option.value === answer.value)?.label ?? answer.value;
        return [label, ...(answer.note === undefined ? [] : [`Note: ${answer.note}`])];
    }
    return answer.values.flatMap(selected => {
        const label = question.options?.find(option => option.value === selected.value)?.label ?? selected.value;
        return selected.note === undefined ? [`- ${label}`] : [`- ${label}`, `  Note: ${selected.note}`];
    });
}

export class QuestionComponent implements Component, Focusable {
    readonly #tui: Pick<TUI, "requestRender">;
    readonly #theme: Theme;
    readonly #questions: readonly QuestionItem[];
    readonly #progress: QuestionProgress;
    readonly #done: (result: QuestionResultDetails) => void;
    readonly #drafts = new Map<string, QuestionDraft>();
    readonly #editor: Editor;
    readonly #signal?: AbortSignal;
    readonly #abortHandler: () => void;
    #mode: Mode;
    #editingValue?: string;
    #savedNoteBeforeEdit?: string;
    #validation?: string;
    #cachedLines?: string[];
    #cachedWidth?: number;
    #finished = false;
    #focused = false;

    constructor(options: {
        tui: TUI;
        theme: Theme;
        questions: readonly QuestionItem[];
        progress?: QuestionProgress;
        signal?: AbortSignal;
        done: (result: QuestionResultDetails) => void;
    }) {
        this.#tui = options.tui;
        this.#theme = options.theme;
        this.#questions = options.questions;
        this.#progress = options.progress ?? new QuestionProgress(options.questions);
        this.#done = options.done;
        this.#editor = new Editor(options.tui, editorTheme(options.theme));
        this.#editor.disableSubmit = true;

        for (const question of options.questions) {
            this.#drafts.set(
                question.id,
                question.kind === "text"
                    ? { value: question.initialValue ?? "" }
                    : choiceDraft(question),
            );
        }
        this.#mode = this.#progress.current.kind === "text" ? "text-editor" : "choices";
        if (this.#mode === "text-editor") {
            this.#editor.setText(this.#textDraft().value);
        }

        this.#signal = options.signal;
        this.#abortHandler = () => this.#cancel();
        this.#signal?.addEventListener("abort", this.#abortHandler, { once: true });
        if (this.#signal?.aborted) this.#cancel();
    }

    get focused(): boolean {
        return this.#focused;
    }

    set focused(value: boolean) {
        this.#focused = value;
        this.#syncEditorFocus();
    }

    invalidate(): void {
        this.#cachedLines = undefined;
        this.#cachedWidth = undefined;
        this.#editor.invalidate();
    }

    dispose(): void {
        this.#cleanup();
    }

    #cleanup(): void {
        this.#signal?.removeEventListener("abort", this.#abortHandler);
        this.#editor.focused = false;
    }

    #refresh(): void {
        this.invalidate();
        this.#tui.requestRender();
    }

    #finish(result: QuestionResultDetails): void {
        if (this.#finished) return;
        this.#finished = true;
        this.#cleanup();
        this.#done(result);
    }

    #cancel(): void {
        this.#finish(this.#progress.cancelled(this.#mode !== "confirm"));
    }

    #question(): QuestionItem {
        return this.#progress.current;
    }

    #draft(): QuestionDraft {
        return this.#drafts.get(this.#question().id)!;
    }

    #choiceDraft(): ChoiceDraft {
        const draft = this.#draft();
        if (!("selected" in draft)) throw new Error("Current question is not a choice question");
        return draft;
    }

    #textDraft(): TextDraft {
        const draft = this.#draft();
        if (!("value" in draft)) throw new Error("Current question is not a text question");
        return draft;
    }

    #choices(): DisplayChoice[] {
        return choicesFor(this.#question());
    }

    #currentChoice(): DisplayChoice {
        const choice = this.#choices()[this.#choiceDraft().focusIndex];
        if (choice === undefined) throw new Error(`Question ${this.#question().id} has no focused choice`);
        return choice;
    }

    #syncEditorFocus(): void {
        this.#editor.focused =
            this.#focused && (this.#mode === "note-editor" || this.#mode === "text-editor");
    }

    #setMode(mode: Mode): void {
        this.#mode = mode;
        this.#syncEditorFocus();
        this.#validation = undefined;
    }

    #openCurrentQuestion(): void {
        const question = this.#question();
        if (question.kind === "text") {
            this.#editor.setText(this.#textDraft().value);
            this.#setMode("text-editor");
        } else {
            this.#setMode("choices");
        }
        this.#refresh();
    }

    #moveQuestion(delta: number): void {
        this.#progress.move(delta);
        this.#openCurrentQuestion();
    }

    #moveChoice(delta: number): void {
        const choices = this.#choices();
        if (choices.length === 0) return;
        const draft = this.#choiceDraft();
        draft.focusIndex = (draft.focusIndex + delta + choices.length) % choices.length;
        this.#validation = undefined;
        this.#refresh();
    }

    #selectForNote(choice: DisplayChoice): void {
        const draft = this.#choiceDraft();
        if (this.#question().kind === "multi") draft.selected.add(choice.value);
        else {
            draft.selected.clear();
            draft.selected.add(choice.value);
        }
    }

    #openNote(): void {
        const choice = this.#currentChoice();
        const draft = this.#choiceDraft();
        this.#selectForNote(choice);
        this.#editingValue = choice.value;
        this.#savedNoteBeforeEdit = draft.notes.get(choice.value);
        this.#editor.setText(this.#savedNoteBeforeEdit ?? "");
        this.#setMode("note-editor");
        this.#refresh();
    }

    #closeNote(save: boolean): void {
        const value = this.#editingValue;
        if (value !== undefined) {
            const notes = this.#choiceDraft().notes;
            if (save) {
                const note = this.#editor.getExpandedText();
                if (note.trim().length === 0) notes.delete(value);
                else notes.set(value, note);
            } else if (this.#savedNoteBeforeEdit === undefined) {
                notes.delete(value);
            } else {
                notes.set(value, this.#savedNoteBeforeEdit);
            }
        }
        this.#editingValue = undefined;
        this.#savedNoteBeforeEdit = undefined;
        this.#editor.setText("");
        this.#setMode("choices");
        this.#refresh();
    }

    #choicePending(): PendingQuestionAnswer | undefined {
        const question = this.#question();
        const draft = this.#choiceDraft();
        if (question.kind === "multi") {
            if (draft.selected.size === 0) {
                this.#validation = "Select at least one option before continuing.";
                this.#refresh();
                return undefined;
            }
            return {
                kind: "multi",
                values: (question.options ?? [])
                    .filter(option => draft.selected.has(option.value))
                    .map(option => ({ value: option.value, note: draft.notes.get(option.value) })),
            };
        }

        const choice = this.#currentChoice();
        draft.selected.clear();
        draft.selected.add(choice.value);
        const note = draft.notes.get(choice.value);
        if (question.kind === "single") return { kind: "single", value: choice.value, note };
        if (question.kind === "confirm") return { kind: "confirm", value: choice.value === "true", note };
        throw new Error(`Question ${question.id} is not a choice question`);
    }

    #advanceAfterAnswer(): void {
        if (this.#progress.allAnswered) {
            this.#setMode("confirm");
            this.#refresh();
            return;
        }
        this.#progress.move(1);
        this.#openCurrentQuestion();
    }

    #handleChoiceInput(data: string): void {
        if (matchesKey(data, Key.left)) return this.#moveQuestion(-1);
        if (matchesKey(data, Key.right)) return this.#moveQuestion(1);
        if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl("p"))) return this.#moveChoice(-1);
        if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl("n"))) return this.#moveChoice(1);
        if (this.#question().kind === "confirm") {
            if (matchesKey(data, "y") || matchesKey(data, Key.shift("y"))) {
                this.#choiceDraft().focusIndex = 0;
                return this.#refresh();
            }
            if (matchesKey(data, "n") || matchesKey(data, Key.shift("n"))) {
                this.#choiceDraft().focusIndex = 1;
                return this.#refresh();
            }
        }
        if (this.#question().kind === "multi" && matchesKey(data, Key.space)) {
            const draft = this.#choiceDraft();
            const value = this.#currentChoice().value;
            if (draft.selected.has(value)) draft.selected.delete(value);
            else draft.selected.add(value);
            this.#validation = undefined;
            return this.#refresh();
        }
        if (matchesKey(data, Key.tab)) return this.#openNote();
        if (matchesKey(data, Key.enter)) {
            const pending = this.#choicePending();
            if (pending !== undefined) {
                this.#progress.submit(pending);
                this.#advanceAfterAnswer();
            }
        }
    }

    #handleNoteInput(data: string): void {
        if (matchesKey(data, Key.escape)) return this.#closeNote(false);
        if (matchesKey(data, Key.tab)) return this.#closeNote(true);
        if (matchesKey(data, Key.enter)) {
            this.#editor.insertTextAtCursor("\n");
            return this.#refresh();
        }
        this.#editor.handleInput(data);
        this.#refresh();
    }

    #handleTextEditorInput(data: string): void {
        if (matchesKey(data, Key.tab)) {
            this.#textDraft().value = this.#editor.getExpandedText();
            this.#setMode("text-tab-navigation");
            return this.#refresh();
        }
        if (matchesKey(data, Key.enter)) {
            this.#editor.insertTextAtCursor("\n");
            this.#validation = undefined;
            return this.#refresh();
        }
        if (matchesKey(data, Key.ctrl("d"))) {
            const value = this.#editor.getExpandedText();
            if (value.trim().length === 0) {
                this.#validation = "Enter a non-blank answer before pressing Ctrl-D.";
                return this.#refresh();
            }
            this.#textDraft().value = value;
            this.#progress.submit({ kind: "text", value });
            return this.#advanceAfterAnswer();
        }
        this.#editor.handleInput(data);
        this.#validation = undefined;
        this.#refresh();
    }

    #handleTextNavigationInput(data: string): void {
        if (matchesKey(data, Key.tab)) {
            this.#editor.setText(this.#textDraft().value);
            this.#setMode("text-editor");
            return this.#refresh();
        }
        if (matchesKey(data, Key.left)) return this.#moveQuestion(-1);
        if (matchesKey(data, Key.right)) return this.#moveQuestion(1);
        if (matchesKey(data, Key.ctrl("d"))) {
            const value = this.#textDraft().value;
            if (value.trim().length === 0) {
                this.#validation = "Enter a non-blank answer before pressing Ctrl-D.";
                return this.#refresh();
            }
            this.#progress.submit({ kind: "text", value });
            this.#advanceAfterAnswer();
        }
    }

    #handleConfirmInput(data: string): void {
        if (matchesKey(data, Key.left)) {
            this.#progress.moveTo(this.#progress.total - 1);
            return this.#openCurrentQuestion();
        }
        if (matchesKey(data, Key.enter) && this.#progress.allAnswered) {
            this.#finish(this.#progress.answered());
        }
    }

    handleInput(data: string): void {
        if (this.#finished) return;
        if (matchesKey(data, Key.ctrl("c"))) return this.#cancel();
        if (matchesKey(data, Key.escape) && this.#mode !== "note-editor") return this.#cancel();
        if (this.#mode === "choices") this.#handleChoiceInput(data);
        else if (this.#mode === "note-editor") this.#handleNoteInput(data);
        else if (this.#mode === "text-editor") this.#handleTextEditorInput(data);
        else if (this.#mode === "text-tab-navigation") this.#handleTextNavigationInput(data);
        else this.#handleConfirmInput(data);
    }

    #renderTabs(lines: string[], width: number): void {
        const tabs = this.#questions.map((question, index) => {
            const current = this.#mode !== "confirm" && index === this.#progress.index ? ">" : " ";
            const answered = this.#progress.isAnswered(question) ? "x" : " ";
            return `${current}[${answered}]Q${index + 1}`;
        });
        const confirm = this.#mode === "confirm"
            ? ">[ready]Confirm"
            : this.#progress.allAnswered
              ? " [ready]Confirm"
              : " [locked]Confirm";
        appendWrapped(lines, width, this.#theme.fg("accent", [...tabs, confirm].join(" ")));
    }

    #renderChoices(lines: string[], width: number): void {
        const draft = this.#choiceDraft();
        for (let index = 0; index < this.#choices().length; index += 1) {
            const choice = this.#choices()[index]!;
            const focused = index === draft.focusIndex;
            const selected = draft.selected.has(choice.value);
            const label = `[${selected ? "x" : " "}] ${choice.label}${draft.notes.has(choice.value) ? " (note saved)" : ""}`;
            appendWrapped(lines, width, this.#theme.fg(focused ? "accent" : "text", label), focused ? "> " : "  ");
            if (choice.description !== undefined) {
                appendWrapped(lines, width, this.#theme.fg("muted", choice.description), "    ");
            }
        }
    }

    #renderEditor(lines: string[], width: number, label: string): void {
        appendWrapped(lines, width, this.#theme.fg("muted", label), " ");
        const editorWidth = Math.max(1, width - 1);
        for (const line of this.#editor.render(editorWidth)) {
            lines.push(width > 1 ? ` ${line}` : line);
        }
    }

    #renderConfirm(lines: string[], width: number): void {
        appendWrapped(lines, width, this.#theme.fg("accent", "Review answers before submitting"), " ");
        for (let index = 0; index < this.#questions.length; index += 1) {
            const question = this.#questions[index]!;
            const answer = this.#progress.answerFor(question);
            appendWrapped(lines, width, this.#theme.fg("text", `Q${index + 1}: ${question.prompt}`), " ");
            if (answer !== undefined) {
                for (const summary of answerSummary(question, answer)) {
                    appendWrapped(lines, width, this.#theme.fg("muted", summary), "   ");
                }
            }
        }
    }

    render(width: number): string[] {
        const renderWidth = Math.max(1, width);
        if (this.#cachedLines !== undefined && this.#cachedWidth === renderWidth) return this.#cachedLines;

        const lines: string[] = [this.#theme.fg("accent", "─".repeat(renderWidth))];
        this.#renderTabs(lines, renderWidth);
        lines.push("");

        if (this.#mode === "confirm") {
            this.#renderConfirm(lines, renderWidth);
        } else {
            const question = this.#question();
            appendWrapped(lines, renderWidth, this.#theme.fg("text", question.prompt), " ");
            lines.push("");
            if (this.#mode === "choices") this.#renderChoices(lines, renderWidth);
            else if (this.#mode === "note-editor") {
                const choice = this.#choices().find(candidate => candidate.value === this.#editingValue);
                this.#renderEditor(lines, renderWidth, `Optional note for ${choice?.label ?? "selection"}`);
                if (question.notePlaceholder !== undefined) {
                    appendWrapped(lines, renderWidth, this.#theme.fg("dim", question.notePlaceholder), " ");
                }
            } else if (this.#mode === "text-editor") this.#renderEditor(lines, renderWidth, "Answer (editing)");
            else appendWrapped(lines, renderWidth, this.#theme.fg("muted", "Answer draft saved. Tab to edit."), " ");
        }

        if (this.#validation !== undefined) {
            lines.push("");
            appendWrapped(lines, renderWidth, this.#theme.fg("warning", this.#validation), " ");
        }
        lines.push("");
        const help =
            this.#mode === "note-editor"
                ? "Enter newline • Tab save note • Esc discard edit • Ctrl-C cancel"
                : this.#mode === "text-editor"
                  ? "Enter newline • Tab tab-navigation • Ctrl-D confirm • Esc/Ctrl-C cancel"
                  : this.#mode === "text-tab-navigation"
                    ? "←→ questions • Tab edit answer • Ctrl-D confirm • Esc/Ctrl-C cancel"
                    : this.#mode === "confirm"
                      ? "← edit last question • Enter submit • Esc/Ctrl-C cancel"
                      : this.#question().kind === "multi"
                        ? "←→ questions • ↑↓/Ctrl-P/N move • Space toggle • Tab note • Enter confirm • Esc/Ctrl-C cancel"
                        : "←→ questions • ↑↓/Ctrl-P/N move • Tab note • Enter confirm • Esc/Ctrl-C cancel";
        appendWrapped(lines, renderWidth, this.#theme.fg("dim", help), " ");
        lines.push(this.#theme.fg("accent", "─".repeat(renderWidth)));

        this.#cachedLines = lines.map(line => truncateToWidth(line, renderWidth, ""));
        this.#cachedWidth = renderWidth;
        return this.#cachedLines;
    }
}

export async function runTuiQuestionFlow(
    context: TuiQuestionContext,
    questions: readonly QuestionItem[],
    signal?: AbortSignal,
): Promise<QuestionResultDetails> {
    const progress = new QuestionProgress(questions);
    if (signal?.aborted) return progress.cancelled();
    return context.ui.custom<QuestionResultDetails>((tui, theme, _keybindings, done) =>
        new QuestionComponent({ tui, theme, questions, progress, signal, done }),
    );
}
