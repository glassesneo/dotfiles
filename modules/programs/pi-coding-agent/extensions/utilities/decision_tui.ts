import type { ExtensionUIContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Editor, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type EditorTheme, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { decisionNoteRequirement, noteMode, QuestionProgress, shouldAutoSubmitSingle, type DecisionFlowPolicy, type DecisionNoteRequirement, type PendingQuestionAnswer, type QuestionAnswer, type QuestionItem, type QuestionOption, type QuestionResultDetails } from "./decision_core.ts";
import { loadQuestionKeymapConfig, questionHelp, resolveQuestionKeymap, resolveUiAction, type QuestionContext, type ResolvedQuestionKeymap, type UiAction } from "./decision_keymap.ts";

interface DisplayChoice { value: string; label: string; description?: string; }
interface ChoiceDraft { focusIndex: number; selected: Set<string>; answerNote?: string; optionNotes: Map<string, string>; }
interface TextDraft { value: string; }
type QuestionDraft = ChoiceDraft | TextDraft;
type Mode = "question" | "note" | "review";
interface TuiQuestionContext { ui: Pick<ExtensionUIContext, "custom">; }

function editorTheme(theme: Theme): EditorTheme {
    return { borderColor: text => theme.fg("accent", text), selectList: {
        selectedPrefix: text => theme.fg("accent", text), selectedText: text => theme.fg("accent", text),
        description: text => theme.fg("muted", text), scrollInfo: text => theme.fg("dim", text), noMatch: text => theme.fg("warning", text),
    } };
}
function choicesFor(question: QuestionItem): DisplayChoice[] {
    if (question.kind === "confirm") return [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
    return (question.options ?? []).map((option: QuestionOption) => ({ ...option }));
}
function appendWrapped(lines: string[], width: number, text: string, prefix = ""): void {
    const prefixWidth = visibleWidth(prefix);
    if (prefixWidth >= width) { lines.push(...wrapTextWithAnsi(`${prefix}${text}`, width)); return; }
    const wrapped = wrapTextWithAnsi(text, width - prefixWidth);
    wrapped.forEach((line, index) => lines.push(`${index === 0 ? prefix : " ".repeat(prefixWidth)}${line}`));
}
function cloneDraft(draft: QuestionDraft): QuestionDraft {
    return "value" in draft ? { value: draft.value } : { focusIndex: draft.focusIndex, selected: new Set(draft.selected), answerNote: draft.answerNote, optionNotes: new Map(draft.optionNotes) };
}
function draftFrom(question: QuestionItem, answer?: QuestionAnswer): QuestionDraft {
    if (question.kind === "text") return { value: answer?.kind === "text" ? answer.value : question.initialValue ?? "" };
    const draft: ChoiceDraft = { focusIndex: 0, selected: new Set(), optionNotes: new Map() };
    if (answer?.kind === "single") { draft.selected.add(answer.value); draft.focusIndex = Math.max(0, (question.options ?? []).findIndex(option => option.value === answer.value)); draft.answerNote = answer.note; }
    else if (answer?.kind === "confirm") { const value = String(answer.value); draft.selected.add(value); draft.focusIndex = answer.value ? 0 : 1; draft.answerNote = answer.note; }
    else if (answer?.kind === "multi") { for (const item of answer.values) { draft.selected.add(item.value); if (item.note !== undefined) draft.optionNotes.set(item.value, item.note); } draft.answerNote = answer.note; }
    return draft;
}
function notePreview(note: string | undefined): string | undefined {
    return note?.split(/\r?\n/).map(line => line.trim()).find(line => line.length > 0);
}
function answerSummary(question: QuestionItem, answer: QuestionAnswer): string {
    if (answer.kind === "text") return answer.value;
    if (answer.kind === "confirm") return `${answer.value ? "Yes" : "No"}${answer.note ? ` — note: ${answer.note}` : ""}`;
    if (answer.kind === "single") return `${question.options?.find(option => option.value === answer.value)?.label ?? answer.value}${answer.note ? ` — note: ${answer.note}` : ""}`;
    const values = answer.values.map(item => `${question.options?.find(option => option.value === item.value)?.label ?? item.value}${item.note ? ` (${item.note})` : ""}`).join(", ");
    return `${values}${answer.note ? ` — note: ${answer.note}` : ""}`;
}

export class DecisionComponent implements Component, Focusable {
    readonly #tui: Pick<TUI, "requestRender">;
    readonly #theme: Theme;
    readonly #questions: readonly QuestionItem[];
    readonly #progress: QuestionProgress;
    readonly #done: (result: QuestionResultDetails) => void;
    readonly #drafts = new Map<string, QuestionDraft>();
    readonly #editor: Editor;
    readonly #keymap: ResolvedQuestionKeymap;
    readonly #policy?: DecisionFlowPolicy;
    readonly #signal?: AbortSignal;
    readonly #abortHandler: () => void;
    #mode: Mode = "question";
    #reviewIndex = 0;
    #fromReview = false;
    #reviewEntryWasAnswered = false;
    #lastEditedIndex = 0;
    #questionSnapshot?: QuestionDraft;
    #noteSnapshot?: string;
    #noteTarget?: string;
    #submitAfterNote = false;
    #validation?: string;
    #cachedLines?: string[];
    #cachedWidth?: number;
    #finished = false;
    #focused = false;

    constructor(options: { tui: TUI; theme: Theme; keybindings: Pick<KeybindingsManager, "getKeys">; keymapConfig?: Parameters<typeof resolveQuestionKeymap>[1]; keymapPath?: string; questions: readonly QuestionItem[]; progress?: QuestionProgress; policy?: DecisionFlowPolicy; signal?: AbortSignal; done: (result: QuestionResultDetails) => void; }) {
        this.#tui = options.tui; this.#theme = options.theme; this.#questions = options.questions;
        this.#progress = options.progress ?? new QuestionProgress(options.questions); this.#done = options.done;
        this.#policy = options.policy;
        this.#keymap = resolveQuestionKeymap(options.keybindings, options.keymapConfig, options.keymapPath);
        this.#editor = new Editor(options.tui, editorTheme(options.theme)); this.#editor.disableSubmit = true;
        for (const question of options.questions) this.#drafts.set(question.id, draftFrom(question));
        this.#openQuestion(false);
        this.#signal = options.signal; this.#abortHandler = () => this.#cancel();
        this.#signal?.addEventListener("abort", this.#abortHandler, { once: true });
        if (this.#signal?.aborted) this.#cancel();
    }
    get focused(): boolean { return this.#focused; }
    set focused(value: boolean) { this.#focused = value; this.#syncEditorFocus(); }
    invalidate(): void { this.#cachedLines = undefined; this.#cachedWidth = undefined; this.#editor.invalidate(); }
    dispose(): void { this.#cleanup(); }
    #cleanup(): void { this.#signal?.removeEventListener("abort", this.#abortHandler); this.#editor.focused = false; }
    #refresh(): void { this.invalidate(); this.#tui.requestRender(); }
    #finish(result: QuestionResultDetails): void { if (this.#finished) return; this.#finished = true; this.#cleanup(); this.#done(result); }
    #cancel(): void { this.#finish(this.#progress.cancelled(this.#mode !== "review")); }
    #question(): QuestionItem { return this.#progress.current; }
    #autoSubmitSingle(): boolean { return this.#progress.total === 1 && shouldAutoSubmitSingle(this.#policy); }
    #draft(): QuestionDraft { return this.#drafts.get(this.#question().id)!; }
    #choiceDraft(): ChoiceDraft { const draft = this.#draft(); if (!("selected" in draft)) throw new Error("Not a choice question"); return draft; }
    #textDraft(): TextDraft { const draft = this.#draft(); if (!("value" in draft)) throw new Error("Not a text question"); return draft; }
    #choices(): DisplayChoice[] { return choicesFor(this.#question()); }
    #syncEditorFocus(): void { this.#editor.focused = this.#focused && (this.#mode === "note" || (this.#mode === "question" && this.#question().kind === "text")); }
    #context(): QuestionContext { return this.#mode === "review" ? "question.review" : this.#mode === "note" ? "question.note" : `question.${this.#question().kind}` as QuestionContext; }
    #openQuestion(fromReview: boolean): void {
        this.#mode = "question"; this.#fromReview = fromReview; this.#reviewEntryWasAnswered = fromReview && this.#progress.isAnswered(this.#question()); this.#lastEditedIndex = this.#progress.index;
        this.#questionSnapshot = cloneDraft(this.#draft()); this.#validation = undefined;
        if (this.#question().kind === "text") this.#editor.setText(this.#textDraft().value);
        this.#syncEditorFocus();
    }
    #saveEditorDraft(): void { if (this.#mode === "question" && this.#question().kind === "text") this.#textDraft().value = this.#editor.getExpandedText(); }
    #moveQuestion(delta: number): void {
        this.#saveEditorDraft();
        const next = this.#progress.index + delta;
        if (delta > 0 && next >= this.#progress.total) {
            if (this.#autoSubmitSingle()) { this.#finish(this.#progress.submitted()); return; }
            this.#mode = "review"; this.#reviewIndex = 0; this.#syncEditorFocus(); this.#validation = undefined; this.#refresh(); return;
        }
        if (next < 0 || next >= this.#progress.total) return;
        this.#progress.moveTo(next); this.#openQuestion(false); this.#refresh();
    }
    #moveChoice(delta: number): void { const choices = this.#choices(); const draft = this.#choiceDraft(); draft.focusIndex = (draft.focusIndex + delta + choices.length) % choices.length; this.#validation = undefined; this.#refresh(); }
    #noteKey(): string { return noteMode(this.#question()) === "answer" ? "__answer__" : this.#choices()[this.#choiceDraft().focusIndex]!.value; }
    #noteRequirement(): DecisionNoteRequirement {
        const question = this.#question();
        const option = question.kind === "multi" && noteMode(question) === "answer"
            ? undefined
            : this.#choices()[this.#choiceDraft().focusIndex]!;
        return decisionNoteRequirement(this.#policy, question, option);
    }
    #getNote(key: string): string | undefined { return key === "__answer__" ? this.#choiceDraft().answerNote : this.#choiceDraft().optionNotes.get(key); }
    #setNote(key: string, value: string | undefined): void { const normalized = value === undefined || value.trim() === "" ? undefined : value; if (key === "__answer__") this.#choiceDraft().answerNote = normalized; else if (normalized === undefined) this.#choiceDraft().optionNotes.delete(key); else this.#choiceDraft().optionNotes.set(key, normalized); }
    #openNote(submitAfterSave = false): void { this.#noteTarget = this.#noteKey(); this.#noteSnapshot = this.#getNote(this.#noteTarget); this.#submitAfterNote = submitAfterSave; this.#editor.setText(this.#noteSnapshot ?? ""); this.#mode = "note"; this.#validation = undefined; this.#syncEditorFocus(); this.#refresh(); }
    #closeNote(save: boolean): void {
        if (save && this.#noteRequirement() === "required" && this.#editor.getExpandedText().trim() === "") {
            this.#validation = "Note must contain non-whitespace text."; this.#refresh(); return;
        }
        if (this.#noteTarget !== undefined) this.#setNote(this.#noteTarget, save ? this.#editor.getExpandedText() : this.#noteSnapshot);
        const submit = save && this.#submitAfterNote;
        this.#noteTarget = undefined; this.#noteSnapshot = undefined; this.#submitAfterNote = false; this.#mode = "question"; this.#validation = undefined; this.#syncEditorFocus();
        if (submit) this.#commit(); else this.#refresh();
    }
    #pending(): PendingQuestionAnswer | undefined {
        const question = this.#question();
        if (question.kind === "text") { const value = this.#editor.getExpandedText(); this.#textDraft().value = value; if (value.trim() === "") { this.#validation = "Answer must contain non-whitespace text."; this.#refresh(); return undefined; } return { kind: "text", value }; }
        const draft = this.#choiceDraft();
        if (question.kind === "multi") { if (draft.selected.size === 0) { this.#validation = "Select at least one option."; this.#refresh(); return undefined; } return { kind: "multi", values: (question.options ?? []).filter(option => draft.selected.has(option.value)).map(option => ({ value: option.value, note: draft.optionNotes.get(option.value) })), note: draft.answerNote }; }
        const choice = this.#choices()[draft.focusIndex]!; draft.selected.clear(); draft.selected.add(choice.value);
        if (question.kind === "single") return { kind: "single", value: choice.value, note: draft.answerNote };
        return { kind: "confirm", value: choice.value === "true", note: draft.answerNote };
    }
    #commit(): void {
        if ((this.#question().kind === "single" || this.#question().kind === "confirm") && this.#noteRequirement() === "required" && this.#getNote(this.#noteKey()) === undefined) {
            this.#openNote(true); return;
        }
        const pending = this.#pending(); if (pending === undefined) return;
        const editedIndex = this.#progress.index;
        const wasAnswered = this.#reviewEntryWasAnswered;
        this.#progress.submit(pending);
        if (!this.#fromReview && this.#autoSubmitSingle()) {
            this.#finish(this.#progress.submitted()); return;
        }
        if (this.#fromReview) {
            this.#mode = "review";
            if (this.#progress.allAnswered) this.#reviewIndex = 0;
            else if (!wasAnswered) this.#reviewIndex = (this.#progress.nextUnanswered(editedIndex) ?? editedIndex) + 1;
            else this.#reviewIndex = editedIndex + 1;
            this.#fromReview = false; this.#reviewEntryWasAnswered = false; this.#syncEditorFocus(); this.#refresh(); return;
        }
        const next = this.#progress.nextUnanswered();
        if (next === undefined) { this.#mode = "review"; this.#reviewIndex = 0; this.#syncEditorFocus(); this.#refresh(); }
        else { this.#progress.moveTo(next); this.#openQuestion(false); this.#refresh(); }
    }
    #back(): void {
        if (this.#mode === "note") { this.#closeNote(false); return; }
        if (this.#mode === "review") { this.#progress.moveTo(this.#lastEditedIndex); this.#openQuestion(true); this.#refresh(); return; }
        if (this.#questionSnapshot !== undefined) this.#drafts.set(this.#question().id, cloneDraft(this.#questionSnapshot));
        if (this.#fromReview) { this.#mode = "review"; this.#reviewIndex = this.#progress.index + 1; this.#fromReview = false; this.#reviewEntryWasAnswered = false; this.#syncEditorFocus(); this.#refresh(); }
        else { this.#validation = "Nothing to go back to. Press Ctrl-C to cancel all questions."; if (this.#question().kind === "text") this.#editor.setText(this.#textDraft().value); this.#refresh(); }
    }
    #handleQuestion(action: UiAction | undefined, data: string): void {
        if (action === "next-question") return this.#moveQuestion(1); if (action === "previous-question") return this.#moveQuestion(-1);
        if (action === "back") return this.#back(); if (action === "move-up") return this.#moveChoice(-1); if (action === "move-down") return this.#moveChoice(1);
        if (action === "edit-note" && this.#question().kind !== "text" && this.#noteRequirement() !== "none") return this.#openNote();
        if (action === "toggle" && this.#question().kind === "multi") { const draft = this.#choiceDraft(); const value = this.#choices()[draft.focusIndex]!.value; draft.selected.has(value) ? draft.selected.delete(value) : draft.selected.add(value); this.#validation = undefined; return this.#refresh(); }
        if (action === "confirm-yes" && this.#question().kind === "confirm") { this.#choiceDraft().focusIndex = 0; return this.#commit(); }
        if (action === "confirm-no" && this.#question().kind === "confirm") { this.#choiceDraft().focusIndex = 1; return this.#commit(); }
        if (action === "accept") return this.#commit();
        if (action === "newline" && this.#question().kind === "text") { this.#editor.insertTextAtCursor("\n"); this.#validation = undefined; return this.#refresh(); }
        if (this.#question().kind === "text") { this.#editor.handleInput(data); this.#validation = undefined; this.#refresh(); }
    }
    #handleReview(action: UiAction | undefined): void {
        if (action === "move-up") { this.#reviewIndex = (this.#reviewIndex - 1 + this.#questions.length + 1) % (this.#questions.length + 1); this.#refresh(); }
        else if (action === "move-down") { this.#reviewIndex = (this.#reviewIndex + 1) % (this.#questions.length + 1); this.#refresh(); }
        else if (action === "next-question" || action === "previous-question") {
            const delta = action === "next-question" ? 1 : -1;
            if (this.#reviewIndex === 0) this.#reviewIndex = delta > 0 ? 1 : this.#questions.length;
            else this.#reviewIndex = ((this.#reviewIndex - 1 + delta + this.#questions.length) % this.#questions.length) + 1;
            this.#refresh();
        }
        else if (action === "back") this.#back();
        else if (action === "accept") {
            if (this.#reviewIndex === 0) this.#finish(this.#progress.submitted());
            else {
                this.#progress.moveTo(this.#reviewIndex - 1);
                const answer = this.#progress.answerFor(this.#question());
                if (answer !== undefined) this.#drafts.set(this.#question().id, draftFrom(this.#question(), answer));
                this.#openQuestion(true); this.#refresh();
            }
        }
    }
    handleInput(data: string): void {
        if (this.#finished) return;
        const action = resolveUiAction(data, this.#context(), this.#keymap);
        if (action === "cancel") return this.#cancel();
        if (this.#mode === "note") { if (action === "back") this.#closeNote(false); else if (action === "accept") this.#closeNote(true); else if (action === "newline") { this.#editor.insertTextAtCursor("\n"); this.#refresh(); } else { this.#editor.handleInput(data); this.#refresh(); } }
        else if (this.#mode === "review") this.#handleReview(action); else this.#handleQuestion(action, data);
    }
    #renderHeader(lines: string[], width: number): void { const tabs = this.#questions.map((question, index) => `[${index + 1} ${this.#mode !== "review" && index === this.#progress.index ? "●" : this.#progress.isAnswered(question) ? "✓" : "○"}]`); if (!this.#autoSubmitSingle()) tabs.push(`[Review${this.#mode === "review" ? " ●" : ""}]`); appendWrapped(lines, width, this.#theme.fg("accent", tabs.join(" "))); }
    #renderChoices(lines: string[], width: number): void {
        const draft = this.#choiceDraft();
        for (let index = 0; index < this.#choices().length; index += 1) {
            const choice = this.#choices()[index]!; const focused = index === draft.focusIndex; const selected = draft.selected.has(choice.value);
            const preview = notePreview(draft.optionNotes.get(choice.value));
            appendWrapped(lines, width, this.#theme.fg(focused ? "accent" : "text", `[${selected ? "x" : " "}] ${choice.label}${preview ? ` — Note: ${preview}` : ""}`), focused ? "> " : "  ");
            if (choice.description) appendWrapped(lines, width, this.#theme.fg("muted", choice.description), "    ");
        }
        const answerNote = notePreview(draft.answerNote);
        if (answerNote) appendWrapped(lines, width, this.#theme.fg("muted", `Note: ${answerNote}`), "  ");
    }
    #renderEditor(lines: string[], width: number, label: string): void { appendWrapped(lines, width, this.#theme.fg("muted", label), " "); for (const line of this.#editor.render(Math.max(1, width - 1))) lines.push(width > 1 ? ` ${line}` : line); }
    #renderReview(lines: string[], width: number): void {
        appendWrapped(lines, width, this.#theme.fg("accent", `${this.#reviewIndex === 0 ? ">" : " "} Submit answers — ready (${this.#progress.answeredCount} answered, ${this.#progress.unansweredCount} unanswered)`));
        this.#questions.forEach((question, index) => { const answer = this.#progress.answerFor(question); appendWrapped(lines, width, `${this.#reviewIndex === index + 1 ? ">" : " "} Q${index + 1} ${answer ? "✓ Answered" : "○ Unanswered"}: ${question.prompt}`); if (answer) appendWrapped(lines, width, this.#theme.fg("muted", answerSummary(question, answer)), "    "); });
    }
    render(width: number): string[] {
        const w = Math.max(1, width); if (this.#cachedLines && this.#cachedWidth === w) return this.#cachedLines;
        const lines = [this.#theme.fg("accent", "─".repeat(w))]; this.#renderHeader(lines, w); lines.push("");
        if (this.#mode === "review") this.#renderReview(lines, w); else { appendWrapped(lines, w, this.#theme.fg("text", this.#question().prompt), " "); lines.push(""); if (this.#mode === "note") { const config = this.#question().note; const target = this.#noteTarget === "__answer__" ? "answer" : this.#choices().find(choice => choice.value === this.#noteTarget)?.label ?? "option"; const fallback = this.#noteRequirement() === "required" ? `Required note for ${target}` : `Optional note for ${target}`; this.#renderEditor(lines, w, config?.prompt ?? fallback); if (config?.placeholder) appendWrapped(lines, w, this.#theme.fg("dim", config.placeholder), " "); } else if (this.#question().kind === "text") this.#renderEditor(lines, w, "Answer"); else this.#renderChoices(lines, w); }
        if (this.#validation) { lines.push(""); appendWrapped(lines, w, this.#theme.fg("warning", `Error: ${this.#validation}`), " "); }
        lines.push(""); appendWrapped(lines, w, this.#theme.fg("dim", questionHelp(this.#context(), this.#keymap)), " "); lines.push(this.#theme.fg("accent", "─".repeat(w)));
        this.#cachedLines = lines.map(line => truncateToWidth(line, w, "")); this.#cachedWidth = w; return this.#cachedLines;
    }
}

export async function runTuiDecisionFlow(context: TuiQuestionContext, questions: readonly QuestionItem[], signal?: AbortSignal, policy?: DecisionFlowPolicy): Promise<QuestionResultDetails> {
    const progress = new QuestionProgress(questions); if (signal?.aborted) return progress.cancelled();
    const loaded = loadQuestionKeymapConfig();
    return context.ui.custom<QuestionResultDetails>((tui, theme, keybindings, done) => new DecisionComponent({ tui, theme, keybindings, keymapConfig: loaded.config, keymapPath: loaded.path, questions, progress, policy, signal, done }));
}

export { DecisionComponent as QuestionComponent };
export const runTuiQuestionFlow = runTuiDecisionFlow;
