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
    type TUI,
} from "@earendil-works/pi-tui";
import {
    QuestionProgress,
    type PendingQuestionAnswer,
    type QuestionItem,
    type QuestionOption,
    type QuestionResultDetails,
} from "./question_core.ts";

type TuiQuestionResult = PendingQuestionAnswer | null;

interface DisplayChoice {
    value: string;
    label: string;
    description?: string;
}

interface TuiQuestionContext {
    ui: Pick<ExtensionUIContext, "custom">;
}

function isAborted(signal: AbortSignal | undefined): boolean {
    return signal?.aborted === true;
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

export class QuestionComponent implements Component {
    readonly #tui: Pick<TUI, "requestRender">;
    readonly #theme: Theme;
    readonly #question: QuestionItem;
    readonly #questionIndex: number;
    readonly #questionTotal: number;
    readonly #done: (result: TuiQuestionResult) => void;
    readonly #choices: DisplayChoice[];
    readonly #editor: Editor;
    readonly #selected = new Set<string>();
    readonly #notes = new Map<string, string>();
    readonly #signal?: AbortSignal;
    readonly #abortHandler: () => void;
    #focusIndex = 0;
    #mode: "choices" | "note" | "text";
    #editingValue?: string;
    #validation?: string;
    #cachedLines?: string[];
    #cachedWidth?: number;
    #finished = false;

    constructor(options: {
        tui: TUI;
        theme: Theme;
        question: QuestionItem;
        questionIndex: number;
        questionTotal: number;
        signal?: AbortSignal;
        done: (result: TuiQuestionResult) => void;
    }) {
        this.#tui = options.tui;
        this.#theme = options.theme;
        this.#question = options.question;
        this.#questionIndex = options.questionIndex;
        this.#questionTotal = options.questionTotal;
        this.#done = options.done;
        this.#choices = choicesFor(options.question);
        this.#mode = options.question.kind === "text" ? "text" : "choices";
        this.#editor = new Editor(options.tui, editorTheme(options.theme));
        this.#editor.disableSubmit = true;
        this.#editor.focused = this.#mode !== "choices";
        if (options.question.kind === "text") {
            this.#editor.setText(options.question.initialValue ?? "");
        }

        this.#signal = options.signal;
        this.#abortHandler = () => this.#finish(null);
        this.#signal?.addEventListener("abort", this.#abortHandler, { once: true });
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
    }

    #refresh(): void {
        this.invalidate();
        this.#tui.requestRender();
    }

    #finish(result: TuiQuestionResult): void {
        if (this.#finished) return;
        this.#finished = true;
        this.#cleanup();
        this.#done(result);
    }

    #currentChoice(): DisplayChoice {
        const choice = this.#choices[this.#focusIndex];
        if (choice === undefined) {
            throw new Error(`Question ${this.#question.id} has no focused choice`);
        }
        return choice;
    }

    #move(delta: number): void {
        if (this.#choices.length === 0) return;
        this.#focusIndex =
            (this.#focusIndex + delta + this.#choices.length) % this.#choices.length;
        this.#validation = undefined;
        this.#refresh();
    }

    #selectForNote(choice: DisplayChoice): void {
        if (this.#question.kind === "multi") {
            this.#selected.add(choice.value);
        } else {
            this.#selected.clear();
            this.#selected.add(choice.value);
        }
    }

    #openNote(): void {
        const choice = this.#currentChoice();
        this.#selectForNote(choice);
        this.#editingValue = choice.value;
        this.#editor.setText(this.#notes.get(choice.value) ?? "");
        this.#editor.focused = true;
        this.#mode = "note";
        this.#validation = undefined;
        this.#refresh();
    }

    #closeNote(save: boolean): void {
        if (save && this.#editingValue !== undefined) {
            const note = this.#editor.getExpandedText();
            if (note.trim().length === 0) {
                this.#notes.delete(this.#editingValue);
            } else {
                this.#notes.set(this.#editingValue, note);
            }
        }
        this.#editingValue = undefined;
        this.#editor.setText("");
        this.#editor.focused = false;
        this.#mode = "choices";
        this.#refresh();
    }

    #choicePending(): PendingQuestionAnswer | undefined {
        const question = this.#question;
        if (question.kind === "multi") {
            if (this.#selected.size === 0) {
                this.#validation = "Select at least one option before continuing.";
                this.#refresh();
                return undefined;
            }
            return {
                kind: "multi",
                values: (question.options ?? [])
                    .filter(option => this.#selected.has(option.value))
                    .map(option => ({
                        value: option.value,
                        note: this.#notes.get(option.value),
                    })),
            };
        }

        const choice = this.#currentChoice();
        this.#selected.clear();
        this.#selected.add(choice.value);
        const note = this.#notes.get(choice.value);
        if (question.kind === "single") {
            return { kind: "single", value: choice.value, note };
        }
        if (question.kind === "confirm") {
            return { kind: "confirm", value: choice.value === "true", note };
        }
        throw new Error(`Question ${question.id} is not a choice question`);
    }

    #handleChoiceInput(data: string): void {
        if (matchesKey(data, Key.escape)) {
            this.#finish(null);
            return;
        }
        if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl("p"))) {
            this.#move(-1);
            return;
        }
        if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl("n"))) {
            this.#move(1);
            return;
        }
        if (this.#question.kind === "confirm") {
            if (matchesKey(data, "y") || matchesKey(data, Key.shift("y"))) {
                this.#focusIndex = 0;
                this.#refresh();
                return;
            }
            if (matchesKey(data, "n") || matchesKey(data, Key.shift("n"))) {
                this.#focusIndex = 1;
                this.#refresh();
                return;
            }
        }
        if (this.#question.kind === "multi" && matchesKey(data, Key.space)) {
            const value = this.#currentChoice().value;
            if (this.#selected.has(value)) {
                this.#selected.delete(value);
            } else {
                this.#selected.add(value);
            }
            this.#validation = undefined;
            this.#refresh();
            return;
        }
        if (matchesKey(data, Key.tab)) {
            this.#openNote();
            return;
        }
        if (matchesKey(data, Key.enter)) {
            const pending = this.#choicePending();
            if (pending !== undefined) this.#finish(pending);
        }
    }

    #handleNoteInput(data: string): void {
        if (matchesKey(data, Key.escape)) {
            this.#closeNote(false);
            return;
        }
        if (matchesKey(data, Key.enter)) {
            this.#closeNote(true);
            return;
        }
        this.#editor.handleInput(data);
        this.#refresh();
    }

    #handleTextInput(data: string): void {
        if (matchesKey(data, Key.escape)) {
            this.#finish(null);
            return;
        }
        if (matchesKey(data, Key.enter)) {
            this.#editor.insertTextAtCursor("\n");
            this.#validation = undefined;
            this.#refresh();
            return;
        }
        if (matchesKey(data, Key.ctrl("d"))) {
            const value = this.#editor.getExpandedText();
            if (value.trim().length === 0) {
                this.#validation = "Enter a non-blank answer before pressing Ctrl-D.";
                this.#refresh();
                return;
            }
            this.#finish({ kind: "text", value });
            return;
        }
        this.#editor.handleInput(data);
        this.#validation = undefined;
        this.#refresh();
    }

    handleInput(data: string): void {
        if (this.#finished) return;
        if (matchesKey(data, Key.ctrl("c"))) {
            this.#finish(null);
            return;
        }
        if (this.#mode === "choices") {
            this.#handleChoiceInput(data);
        } else if (this.#mode === "note") {
            this.#handleNoteInput(data);
        } else {
            this.#handleTextInput(data);
        }
    }

    #renderChoices(lines: string[], width: number): void {
        for (let index = 0; index < this.#choices.length; index += 1) {
            const choice = this.#choices[index];
            const focused = index === this.#focusIndex;
            const selected = this.#selected.has(choice.value);
            const noteSaved = this.#notes.has(choice.value);
            const focusMarker = focused ? ">" : " ";
            const selectedMarker = selected ? "[x]" : "[ ]";
            const noteMarker = noteSaved ? " note saved" : "";
            const label = `${selectedMarker} ${choice.label}${noteMarker}`;
            appendWrapped(
                lines,
                width,
                this.#theme.fg(focused ? "accent" : "text", label),
                `${focusMarker} `,
            );
            if (choice.description !== undefined) {
                appendWrapped(
                    lines,
                    width,
                    this.#theme.fg("muted", choice.description),
                    "    ",
                );
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

    render(width: number): string[] {
        const renderWidth = Math.max(1, width);
        if (
            this.#cachedLines !== undefined &&
            this.#cachedWidth === renderWidth
        ) {
            return this.#cachedLines;
        }
        const lines: string[] = [this.#theme.fg("accent", "─".repeat(renderWidth))];
        appendWrapped(
            lines,
            renderWidth,
            this.#theme.fg(
                "accent",
                `Question ${this.#questionIndex + 1}/${this.#questionTotal}`,
            ),
            " ",
        );
        appendWrapped(
            lines,
            renderWidth,
            this.#theme.fg("text", this.#question.prompt),
            " ",
        );
        lines.push("");

        if (this.#mode === "choices") {
            this.#renderChoices(lines, renderWidth);
        } else if (this.#mode === "note") {
            const choice = this.#choices.find(
                candidate => candidate.value === this.#editingValue,
            );
            this.#renderEditor(
                lines,
                renderWidth,
                `Optional note for ${choice?.label ?? "selection"}`,
            );
            if (this.#question.notePlaceholder !== undefined) {
                appendWrapped(
                    lines,
                    renderWidth,
                    this.#theme.fg("dim", this.#question.notePlaceholder),
                    " ",
                );
            }
        } else {
            this.#renderEditor(lines, renderWidth, "Answer");
        }

        if (this.#validation !== undefined) {
            lines.push("");
            appendWrapped(
                lines,
                renderWidth,
                this.#theme.fg("warning", this.#validation),
                " ",
            );
        }
        lines.push("");

        const help =
            this.#mode === "note"
                ? "Enter save note • Esc discard • Ctrl-C cancel"
                : this.#mode === "text"
                  ? "Enter newline • Ctrl-D submit • Esc/Ctrl-C cancel"
                  : this.#question.kind === "multi"
                    ? "↑↓/Ctrl-P/N move • Space toggle • Tab note • Enter continue • Esc/Ctrl-C cancel"
                    : this.#question.kind === "confirm"
                      ? "↑↓/Ctrl-P/N or Y/N choose • Tab note • Enter continue • Esc/Ctrl-C cancel"
                      : "↑↓/Ctrl-P/N move • Tab note • Enter continue • Esc/Ctrl-C cancel";
        appendWrapped(
            lines,
            renderWidth,
            this.#theme.fg("dim", help),
            " ",
        );
        lines.push(this.#theme.fg("accent", "─".repeat(renderWidth)));

        this.#cachedLines = lines.map(line =>
            truncateToWidth(line, renderWidth, ""),
        );
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
    while (progress.current !== undefined) {
        if (isAborted(signal)) return progress.cancelled();
        const question = progress.current;
        const pending = await context.ui.custom<TuiQuestionResult>(
            (tui, theme, _keybindings, done) =>
                new QuestionComponent({
                    tui,
                    theme,
                    question,
                    questionIndex: progress.index,
                    questionTotal: progress.total,
                    signal,
                    done,
                }),
        );
        if (pending === null || isAborted(signal)) {
            return progress.cancelled();
        }
        const completed = progress.submit(pending);
        if (completed !== undefined) return completed;
    }
    throw new Error("TUI question flow ended without a result");
}
