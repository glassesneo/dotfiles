import type { ExtensionUIContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Editor, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type EditorTheme, type Focusable, type TUI } from "@earendil-works/pi-tui";
import {
    decisionNoteRequirement,
    formatQuestionResponse,
    notePresentation,
    QuestionProgress,
    shouldAllowUnansweredNote,
    shouldAutoSubmitSingle,
    SYNTHETIC_UNANSWERED_LABEL,
    type DecisionFlowPolicy,
    type DecisionNoteRequirement,
    type PendingQuestionResponse,
    type QuestionItem,
    type QuestionOption,
    type QuestionResponse,
    type QuestionResultDetails,
} from "./decision_core.ts";
import { loadQuestionKeymapConfig, questionHelp, resolveQuestionKeymap, resolveUiAction, type QuestionContext, type ResolvedQuestionKeymap, type UiAction } from "./decision_keymap.ts";
import { keyLabel } from "./extension_keybindings.ts";

interface DisplayChoice { value?: string; label: string; description?: string; synthetic?: boolean; }
interface ChoiceDraft {
    focusIndex: number;
    selected: Set<string>;
    optionNotes: Map<string, string>;
    unansweredNote?: string;
    syntheticSelected: boolean;
}
interface TextDraft { value: string; }
type QuestionDraft = ChoiceDraft | TextDraft;
type Mode = "question" | "note" | "review";
type NoteContext = "response" | "unanswered";
interface TuiQuestionContext { ui: Pick<ExtensionUIContext, "custom">; }

function editorTheme(theme: Theme): EditorTheme {
    return { borderColor: text => theme.fg("borderAccent", text), selectList: {
        selectedPrefix: text => theme.fg("accent", text), selectedText: text => theme.fg("accent", text),
        description: text => theme.fg("muted", text), scrollInfo: text => theme.fg("dim", text), noMatch: text => theme.fg("warning", text),
    } };
}
function choicesFor(question: QuestionItem, allowUnansweredNote: boolean): DisplayChoice[] {
    const options: DisplayChoice[] = (question.options ?? []).map((option: QuestionOption) => ({ ...option }));
    if (allowUnansweredNote && (question.kind === "single" || question.kind === "multi")) {
        options.push({ label: SYNTHETIC_UNANSWERED_LABEL, synthetic: true });
    }
    return options;
}
function appendWrapped(lines: string[], width: number, text: string, prefix = "", decorate?: (line: string) => string): void {
    const append = (line: string): void => { lines.push(decorate?.(line) ?? line); };
    const prefixWidth = visibleWidth(prefix);
    if (prefixWidth >= width) { wrapTextWithAnsi(`${prefix}${text}`, width).forEach(append); return; }
    const wrapped = wrapTextWithAnsi(text, width - prefixWidth);
    wrapped.forEach((line, index) => append(`${index === 0 ? prefix : " ".repeat(prefixWidth)}${line}`));
}
function cloneDraft(draft: QuestionDraft): QuestionDraft {
    return "value" in draft ? { value: draft.value } : {
        focusIndex: draft.focusIndex,
        selected: new Set(draft.selected),
        optionNotes: new Map(draft.optionNotes),
        unansweredNote: draft.unansweredNote,
        syntheticSelected: draft.syntheticSelected,
    };
}
function draftFrom(question: QuestionItem, response?: QuestionResponse): QuestionDraft {
    if (question.kind === "text") return { value: response?.kind === "text" ? response.value : "" };
    const draft: ChoiceDraft = { focusIndex: 0, selected: new Set(), optionNotes: new Map(), syntheticSelected: false };
    if (response?.kind === "single") {
        draft.selected.add(response.value);
        if (response.note !== undefined) draft.optionNotes.set(response.value, response.note);
        draft.focusIndex = Math.max(0, (question.options ?? []).findIndex(option => option.value === response.value));
    } else if (response?.kind === "multi") {
        for (const item of response.values) {
            draft.selected.add(item.value);
            if (item.note !== undefined) draft.optionNotes.set(item.value, item.note);
        }
    } else if (response?.kind === "unanswered") {
        draft.unansweredNote = response.note;
        draft.syntheticSelected = true;
    }
    return draft;
}
function notePreview(note: string | undefined): string | undefined {
    return note?.split(/\r?\n/).map(line => line.trim()).find(line => line.length > 0);
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
    #reviewEntryWasResponded = false;
    #lastEditedIndex = 0;
    #questionSnapshot?: QuestionDraft;
    #noteDraftSnapshot?: ChoiceDraft;
    #syntheticDraftSnapshot?: ChoiceDraft;
    #noteSnapshot?: string;
    #noteTarget?: string;
    #noteContext: NoteContext = "response";
    #noteFromSynthetic = false;
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
        for (const question of options.questions) this.#drafts.set(question.id, draftFrom(question, this.#progress.responseFor(question)));
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
    #allowUnansweredNote(): boolean { return shouldAllowUnansweredNote(this.#policy); }
    #draft(): QuestionDraft { return this.#drafts.get(this.#question().id)!; }
    #choiceDraft(): ChoiceDraft { const draft = this.#draft(); if (!("selected" in draft)) throw new Error("Not a choice question"); return draft; }
    #textDraft(): TextDraft { const draft = this.#draft(); if (!("value" in draft)) throw new Error("Not a text question"); return draft; }
    #choices(): DisplayChoice[] { return choicesFor(this.#question(), this.#allowUnansweredNote()); }
    #syncEditorFocus(): void { this.#editor.focused = this.#focused && (this.#mode === "note" || (this.#mode === "question" && this.#question().kind === "text")); }
    #context(): QuestionContext { return this.#mode === "review" ? "question.review" : this.#mode === "note" ? "question.note" : `question.${this.#question().kind}` as QuestionContext; }
    #openQuestion(fromReview: boolean): void {
        this.#mode = "question"; this.#fromReview = fromReview;
        this.#reviewEntryWasResponded = fromReview && this.#progress.isResponded(this.#question());
        this.#lastEditedIndex = this.#progress.index;
        this.#questionSnapshot = cloneDraft(this.#draft());
        this.#validation = undefined;
        if (this.#question().kind === "text") this.#editor.setText(this.#textDraft().value);
        this.#syncEditorFocus();
    }
    #saveEditorDraft(): void { if (this.#mode === "question" && this.#question().kind === "text") this.#textDraft().value = this.#editor.getExpandedText(); }
    #saveDraftOnNavigate(): void {
        this.#saveEditorDraft();
        const pending = this.#pendingFromDraft();
        if (pending === undefined) this.#progress.clear();
        else this.#progress.submit(pending);
    }
    #moveQuestion(delta: number): void {
        this.#saveDraftOnNavigate();
        const next = this.#progress.index + delta;
        if (delta > 0 && next >= this.#progress.total) {
            if (this.#autoSubmitSingle()) { this.#finish(this.#progress.submitted()); return; }
            this.#mode = "review"; this.#reviewIndex = 0; this.#syncEditorFocus(); this.#validation = undefined; this.#refresh(); return;
        }
        if (next < 0 || next >= this.#progress.total) return;
        this.#progress.moveTo(next); this.#openQuestion(false); this.#refresh();
    }
    #moveChoice(delta: number): void { const choices = this.#choices(); const draft = this.#choiceDraft(); draft.focusIndex = (draft.focusIndex + delta + choices.length) % choices.length; this.#validation = undefined; this.#refresh(); }
    #focusedChoice(): DisplayChoice { return this.#choices()[this.#choiceDraft().focusIndex]!; }
    #noteRequirement(context: NoteContext = this.#noteContext, option?: QuestionOption): DecisionNoteRequirement {
        const question = this.#question();
        if (context === "unanswered") return "required";
        const focused = this.#focusedChoice();
        const target = option ?? (this.#noteTarget === undefined
            ? question.options?.find(candidate => candidate.value === focused.value)
            : question.options?.find(candidate => candidate.value === this.#noteTarget));
        return decisionNoteRequirement(this.#policy, question, target);
    }
    #openNote(options: { submitAfterSave?: boolean; context?: NoteContext } = {}): void {
        const draft = this.#choiceDraft();
        const focused = this.#focusedChoice();
        this.#noteContext = options.context ?? (focused.synthetic ? "unanswered" : "response");
        this.#noteFromSynthetic = this.#noteContext === "unanswered";
        this.#noteTarget = this.#noteFromSynthetic ? undefined : focused.value;
        this.#noteDraftSnapshot = this.#noteFromSynthetic && this.#syntheticDraftSnapshot !== undefined
            ? cloneDraft(this.#syntheticDraftSnapshot) as ChoiceDraft
            : cloneDraft(draft) as ChoiceDraft;
        if (this.#noteFromSynthetic) {
            draft.selected.clear();
            draft.syntheticSelected = true;
            this.#noteSnapshot = draft.unansweredNote;
        } else {
            if (this.#noteTarget === undefined) throw new Error("Regular choice has no value");
            this.#noteSnapshot = draft.optionNotes.get(this.#noteTarget);
        }
        this.#submitAfterNote = options.submitAfterSave ?? false;
        this.#editor.setText(this.#noteSnapshot ?? "");
        this.#mode = "note"; this.#validation = undefined; this.#syncEditorFocus(); this.#refresh();
    }
    #closeNote(save: boolean): void {
        const editedNote = this.#editor.getExpandedText();
        if (save && this.#noteRequirement() === "required" && editedNote.trim() === "") {
            this.#validation = "Note must contain non-whitespace text."; this.#refresh(); return;
        }
        if (!save) {
            if (this.#noteDraftSnapshot !== undefined) this.#drafts.set(this.#question().id, cloneDraft(this.#noteDraftSnapshot));
        } else {
            const draft = this.#choiceDraft();
            const normalized = editedNote.trim() === "" ? undefined : editedNote;
            if (this.#noteFromSynthetic) {
                if (normalized === undefined) {
                    this.#validation = "Note must contain non-whitespace text."; this.#refresh(); return;
                }
                draft.selected.clear();
                draft.syntheticSelected = true;
                draft.unansweredNote = normalized;
            } else {
                const target = this.#noteTarget;
                if (target === undefined) throw new Error("Regular note has no target");
                if (normalized === undefined) draft.optionNotes.delete(target);
                else {
                    draft.optionNotes.set(target, normalized);
                    if (this.#question().kind === "single") draft.selected.clear();
                    draft.selected.add(target);
                    draft.syntheticSelected = false;
                }
            }
        }
        const submit = save && this.#submitAfterNote;
        this.#noteDraftSnapshot = undefined; this.#syntheticDraftSnapshot = undefined; this.#noteSnapshot = undefined; this.#noteTarget = undefined;
        this.#noteFromSynthetic = false; this.#submitAfterNote = false; this.#noteContext = "response"; this.#mode = "question";
        this.#validation = undefined; this.#syncEditorFocus();
        if (submit) this.#commit(); else this.#refresh();
    }
    #pendingFromDraft(): PendingQuestionResponse | undefined {
        const question = this.#question();
        if (question.kind === "text") {
            const value = this.#textDraft().value;
            return value.trim() === "" ? undefined : { kind: "text", value };
        }
        const draft = this.#choiceDraft();
        if (draft.syntheticSelected) return draft.unansweredNote === undefined ? undefined : { kind: "unanswered", note: draft.unansweredNote };
        if (draft.selected.size === 0) return undefined;
        if (question.kind === "multi") {
            return { kind: "multi", values: (question.options ?? [])
                .filter(option => draft.selected.has(option.value))
                .map(option => draft.optionNotes.has(option.value)
                    ? { value: option.value, note: draft.optionNotes.get(option.value) }
                    : { value: option.value }) };
        }
        const value = [...draft.selected][0]!;
        const note = draft.optionNotes.get(value);
        return note === undefined ? { kind: "single", value } : { kind: "single", value, note };
    }
    #pending(options: { silent?: boolean } = {}): PendingQuestionResponse | undefined {
        const question = this.#question();
        if (question.kind === "text") {
            const value = this.#editor.getExpandedText();
            this.#textDraft().value = value;
            if (value.trim() === "") {
                if (!options.silent) { this.#validation = "Answer must contain non-whitespace text."; this.#refresh(); }
                return undefined;
            }
            return { kind: "text", value };
        }
        const draft = this.#choiceDraft();
        const focused = this.#focusedChoice();
        if (draft.syntheticSelected) {
            if (draft.unansweredNote === undefined) {
                this.#openNote({ submitAfterSave: true, context: "unanswered" });
                return undefined;
            }
            return { kind: "unanswered", note: draft.unansweredNote };
        }
        if (focused.synthetic) {
            this.#openNote({ submitAfterSave: true, context: "unanswered" });
            return undefined;
        }
        if (question.kind === "multi") {
            if (draft.selected.size === 0) {
                if (!options.silent) { this.#validation = "Select at least one option."; this.#refresh(); }
                return undefined;
            }
            for (const [index, option] of (question.options ?? []).entries()) {
                if (!draft.selected.has(option.value)) continue;
                if (decisionNoteRequirement(this.#policy, question, option) === "required" && draft.optionNotes.get(option.value) === undefined) {
                    draft.focusIndex = index;
                    this.#openNote({ submitAfterSave: true, context: "response" });
                    return undefined;
                }
            }
            return this.#pendingFromDraft();
        }
        let realSelected = [...draft.selected];
        if (realSelected.length === 0) {
            if (focused.value === undefined) throw new Error("Focused regular choice has no value");
            draft.selected.add(focused.value);
            realSelected = [focused.value];
        }
        const value = realSelected[0]!;
        const option = question.options?.find(candidate => candidate.value === value);
        if (decisionNoteRequirement(this.#policy, question, option) === "required" && draft.optionNotes.get(value) === undefined) {
            draft.focusIndex = Math.max(0, (question.options ?? []).findIndex(candidate => candidate.value === value));
            this.#openNote({ submitAfterSave: true, context: "response" });
            return undefined;
        }
        const note = draft.optionNotes.get(value);
        return note === undefined ? { kind: "single", value } : { kind: "single", value, note };
    }
    #finishAfterCommit(editedIndex: number, wasResponded: boolean): void {
        if (!this.#fromReview && this.#autoSubmitSingle()) {
            this.#finish(this.#progress.submitted()); return;
        }
        if (this.#fromReview) {
            this.#mode = "review";
            if (this.#progress.allResponded) this.#reviewIndex = 0;
            else if (!wasResponded) this.#reviewIndex = (this.#progress.nextUntouched(editedIndex) ?? editedIndex) + 1;
            else this.#reviewIndex = editedIndex + 1;
            this.#fromReview = false; this.#reviewEntryWasResponded = false; this.#syncEditorFocus(); this.#refresh(); return;
        }
        const next = this.#progress.nextUntouched();
        if (next === undefined) { this.#mode = "review"; this.#reviewIndex = 0; this.#syncEditorFocus(); this.#refresh(); }
        else { this.#progress.moveTo(next); this.#openQuestion(false); this.#refresh(); }
    }
    #commit(): void {
        const pending = this.#pending(); if (pending === undefined) return;
        const editedIndex = this.#progress.index;
        const wasResponded = this.#reviewEntryWasResponded;
        this.#progress.submit(pending);
        this.#finishAfterCommit(editedIndex, wasResponded);
    }
    #back(): void {
        if (this.#mode === "note") { this.#closeNote(false); return; }
        if (this.#mode === "review") { this.#progress.moveTo(this.#lastEditedIndex); this.#openQuestion(true); this.#refresh(); return; }
        if (this.#questionSnapshot !== undefined) this.#drafts.set(this.#question().id, cloneDraft(this.#questionSnapshot));
        if (this.#fromReview) { this.#mode = "review"; this.#reviewIndex = this.#progress.index + 1; this.#fromReview = false; this.#reviewEntryWasResponded = false; this.#syncEditorFocus(); this.#refresh(); }
        else { const cancel = (this.#keymap["question.common"].cancel ?? []).map(keyLabel).join("/"); this.#validation = `Nothing to go back to. Press ${cancel} to cancel all questions.`; if (this.#question().kind === "text") this.#editor.setText(this.#textDraft().value); this.#refresh(); }
    }
    #handleToggle(): void {
        const question = this.#question();
        if (question.kind !== "single" && question.kind !== "multi") return;
        const draft = this.#choiceDraft();
        const choice = this.#focusedChoice();
        if (choice.synthetic) {
            if (draft.syntheticSelected) {
                if (this.#syntheticDraftSnapshot !== undefined) {
                    this.#drafts.set(question.id, cloneDraft(this.#syntheticDraftSnapshot));
                    this.#syntheticDraftSnapshot = undefined;
                } else {
                    draft.syntheticSelected = false;
                }
            } else {
                this.#syntheticDraftSnapshot = cloneDraft(draft) as ChoiceDraft;
                draft.selected.clear();
                draft.syntheticSelected = true;
            }
            this.#validation = undefined;
            return this.#refresh();
        }
        if (choice.value === undefined) throw new Error("Regular choice has no value");
        draft.syntheticSelected = false;
        this.#syntheticDraftSnapshot = undefined;
        if (question.kind === "single") {
            draft.selected.clear();
            draft.selected.add(choice.value);
        } else {
            if (draft.selected.has(choice.value)) draft.selected.delete(choice.value); else draft.selected.add(choice.value);
        }
        this.#validation = undefined;
        this.#refresh();
    }
    #handleQuestion(action: UiAction | undefined, data: string): void {
        if (action === "next-question") return this.#moveQuestion(1); if (action === "previous-question") return this.#moveQuestion(-1);
        if (action === "back") return this.#back(); if (action === "move-up") return this.#moveChoice(-1); if (action === "move-down") return this.#moveChoice(1);
        if (action === "edit-note" && this.#question().kind !== "text") {
            const choice = this.#focusedChoice();
            if (choice.synthetic) {
                if (this.#allowUnansweredNote()) return this.#openNote({ context: "unanswered" });
            } else if (this.#noteRequirement("response", this.#question().options?.find(option => option.value === choice.value)) !== "none") {
                return this.#openNote({ context: "response" });
            }
        }
        if (action === "toggle") return this.#handleToggle();
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
    #responseStatusLabel(question: QuestionItem): string {
        if (this.#progress.isAnswered(question)) return "✓ Answered";
        if (this.#progress.isUnansweredWithNote(question)) return "◐ Unanswered (note)";
        return "○ Unanswered";
    }
    #renderHeader(lines: string[], width: number): void {
        const tabs = this.#questions.map((question, index) => {
            const active = this.#mode !== "review" && index === this.#progress.index;
            const marker = this.#progress.isAnswered(question) ? "✓" : this.#progress.isUnansweredWithNote(question) ? "◐" : "○";
            const text = `[${index + 1} ${active ? "●" : marker}]`;
            if (active) return this.#theme.fg("accent", this.#theme.bold(text));
            if (this.#progress.isAnswered(question)) return this.#theme.fg("success", text);
            if (this.#progress.isUnansweredWithNote(question)) return this.#theme.fg("warning", text);
            return this.#theme.fg("dim", text);
        });
        if (!this.#autoSubmitSingle()) {
            const text = `[Review${this.#mode === "review" ? " ●" : ""}]`;
            tabs.push(this.#mode === "review" ? this.#theme.fg("accent", this.#theme.bold(text)) : this.#theme.fg("dim", text));
        }
        appendWrapped(lines, width, tabs.join(" "));
    }
    #renderChoices(lines: string[], width: number): void {
        const question = this.#question(); const draft = this.#choiceDraft();
        for (let index = 0; index < this.#choices().length; index += 1) {
            const choice = this.#choices()[index]!; const focused = index === draft.focusIndex;
            const virtualSelected = this.#mode === "note" && !this.#noteFromSynthetic && choice.value === this.#noteTarget;
            const selected = choice.synthetic ? draft.syntheticSelected : choice.value !== undefined && (draft.selected.has(choice.value) || virtualSelected);
            const control = question.kind === "multi" ? `[${selected ? "x" : " "}]` : `(${selected ? "●" : " "})`;
            const text = `${control} ${choice.label}`;
            const styled = this.#theme.fg(focused ? "accent" : selected ? "success" : choice.synthetic ? "muted" : "text", focused || selected ? this.#theme.bold(text) : text);
            appendWrapped(lines, width, styled, focused ? "> " : "  ", focused ? line => this.#theme.bg("selectedBg", line) : undefined);
            if (choice.description) appendWrapped(lines, width, this.#theme.fg("muted", choice.description), "    ");
            const note = choice.synthetic ? draft.unansweredNote : choice.value === undefined ? undefined : draft.optionNotes.get(choice.value);
            const preview = notePreview(note);
            if (preview) appendWrapped(lines, width, this.#theme.fg("muted", `Note: ${preview}`), "    ");
        }
    }
    #renderEditor(lines: string[], width: number, label: string): void { appendWrapped(lines, width, this.#theme.fg("accent", this.#theme.bold(label)), " "); for (const line of this.#editor.render(Math.max(1, width - 1))) lines.push(width > 1 ? ` ${line}` : line); }
    #renderNoteTarget(lines: string[], width: number): void {
        const draft = this.#choiceDraft();
        const choice = this.#noteFromSynthetic
            ? this.#choices().find(candidate => candidate.synthetic)
            : this.#question().options?.find(option => option.value === this.#noteTarget);
        if (choice !== undefined) {
            const selected = this.#noteFromSynthetic ? draft.syntheticSelected : true;
            const control = this.#question().kind === "multi" ? `[${selected ? "x" : " "}]` : `(${selected ? "●" : " "})`;
            appendWrapped(lines, width, this.#theme.fg("accent", this.#theme.bold(`${control} ${choice.label}`)), " ");
            if (choice.description) appendWrapped(lines, width, this.#theme.fg("muted", choice.description), "    ");
        }
        const presentation = notePresentation(this.#policy, this.#question(), this.#noteContext);
        const fallback = this.#noteContext === "unanswered"
            ? "Add a note when none of the options apply"
            : this.#noteRequirement() === "required" ? "Required note for this option" : "Optional note for this option";
        this.#renderEditor(lines, width, presentation.prompt ?? fallback);
        if (presentation.placeholder) appendWrapped(lines, width, this.#theme.fg("dim", presentation.placeholder), " ");
    }
    #renderReview(lines: string[], width: number): void {
        const submitText = `Submit responses — ready (${this.#progress.answeredCount} answered, ${this.#progress.unansweredWithNoteCount} unanswered with note, ${this.#progress.untouchedCount} untouched)`;
        const submitFocused = this.#reviewIndex === 0;
        appendWrapped(lines, width, this.#theme.fg(submitFocused ? "accent" : "success", this.#theme.bold(submitText)), submitFocused ? "> " : "  ", submitFocused ? line => this.#theme.bg("selectedBg", line) : undefined);
        this.#questions.forEach((question, index) => {
            const response = this.#progress.responseFor(question); const focused = this.#reviewIndex === index + 1;
            const text = `Q${index + 1} ${this.#responseStatusLabel(question)}: ${question.prompt}`;
            const color = focused ? "accent" : response === undefined ? "warning" : this.#progress.isAnswered(question) ? "success" : "warning";
            const styled = this.#theme.fg(color, focused ? this.#theme.bold(text) : text);
            appendWrapped(lines, width, styled, focused ? "> " : "  ", focused ? line => this.#theme.bg("selectedBg", line) : undefined);
            if (response) appendWrapped(lines, width, this.#theme.fg("muted", formatQuestionResponse(question, response)), "    ");
        });
    }
    render(width: number): string[] {
        const w = Math.max(1, width); if (this.#cachedLines && this.#cachedWidth === w) return this.#cachedLines;
        const lines = [this.#theme.fg("border", "─".repeat(w))]; this.#renderHeader(lines, w); lines.push("");
        if (this.#mode === "review") this.#renderReview(lines, w); else {
            appendWrapped(lines, w, this.#theme.fg("accent", this.#theme.bold(this.#question().prompt)), " "); lines.push("");
            if (this.#mode === "note") this.#renderNoteTarget(lines, w);
            else if (this.#question().kind === "text") this.#renderEditor(lines, w, "Answer");
            else this.#renderChoices(lines, w);
        }
        if (this.#validation) { lines.push(""); appendWrapped(lines, w, this.#theme.fg("error", this.#theme.bold(`Error: ${this.#validation}`)), " "); }
        lines.push(""); appendWrapped(lines, w, this.#theme.fg("dim", questionHelp(this.#context(), this.#keymap)), " "); lines.push(this.#theme.fg("border", "─".repeat(w)));
        this.#cachedLines = lines.map(line => truncateToWidth(line, w, "")); this.#cachedWidth = w; return this.#cachedLines;
    }
}

export async function runTuiDecisionFlow(context: TuiQuestionContext, questions: readonly QuestionItem[], signal?: AbortSignal, policy?: DecisionFlowPolicy): Promise<QuestionResultDetails> {
    const progress = new QuestionProgress(questions); if (signal?.aborted) return progress.cancelled();
    const loaded = loadQuestionKeymapConfig();
    return context.ui.custom<QuestionResultDetails>((tui, theme, keybindings, done) => new DecisionComponent({ tui, theme, keybindings, keymapConfig: loaded.config, keymapPath: loaded.path, questions, progress, policy, signal, done }));
}

export const runTuiQuestionFlow = runTuiDecisionFlow;
