import {
    defineTool,
    type ExtensionAPI,
    type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
    buildQuestionToolResult,
    questionParameters,
    unavailableResult,
    validateQuestionParameters,
    type QuestionAnswer,
    type QuestionItem,
    type QuestionResultDetails,
} from "./utilities/decision_core.ts";
import { runStandardQuestionFlow } from "./utilities/decision_standard_ui.ts";
import { runTuiQuestionFlow } from "./utilities/decision_tui.ts";
import { loadQuestionKeymapConfig } from "./utilities/decision_keymap.ts";

export const questionDescription =
    "Ask the user for decisions or missing information required to continue the current task. Supports single-choice, multiple-choice, multiline text, and confirmation questions. Selection questions support answer-level notes by default or per-option notes when note.mode is per-option. Users may submit with questions unanswered; absent answer IDs are unanswered.";

function inline(value: string): string {
    return value.replace(/\s*\r?\n\s*/g, " ⏎ ").trim();
}

function answerDisplay(question: QuestionItem, answer: QuestionAnswer, expanded: boolean): string {
    const note = (value: string | undefined) => value === undefined ? "" : ` — note: ${expanded ? value : inline(value)}`;
    if (answer.kind === "text") return expanded ? answer.value : inline(answer.value);
    if (answer.kind === "confirm") return `${answer.value ? "Yes" : "No"}${note(answer.note)}`;
    if (answer.kind === "single") {
        const label = question.options?.find(option => option.value === answer.value)?.label ?? answer.value;
        return `${label}${note(answer.note)}`;
    }
    const values = answer.values.map(selected => {
        const label = question.options?.find(option => option.value === selected.value)?.label ?? selected.value;
        return `${label}${note(selected.note)}`;
    }).join(", ");
    return `${values}${note(answer.note)}`;
}

export const questionPromptGuidelines = [
    "Ask only questions whose answers affect the current task; do not ask for facts available from the repository or provided materials.",
    "Group related questions in one question call when useful, but ask the minimum number needed.",
    "Selection questions accept optional notes. note.mode='answer' attaches one note to the answer; note.mode='per-option' attaches notes to selected options. Treat each note as decision input.",
    "When a user may choose a direction such as 'revise' and explain conditions, prefer that option with its note over adding a separate text question.",
    "Separate meaningful directions into options and use notes for conditions that do not fit the option label.",
    "Do not mechanically add a generic 'Other' option because notes are always available; add it only when it is a meaningful independent branch.",
    "A submitted question result may omit unanswered question IDs. Treat absent IDs as intentionally unanswered rather than as tool failure.",
    "After receiving the structured answers, return to the original task.",
];

export function createQuestionToolDefinition(): ToolDefinition<
    typeof questionParameters,
    QuestionResultDetails
> {
    return defineTool({
        name: "question",
        label: "Question",
        description: questionDescription,
        promptSnippet:
            "Ask the user for task-blocking decisions or missing information, with optional notes on selections",
        promptGuidelines: questionPromptGuidelines,
        parameters: questionParameters,
        executionMode: "sequential",
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            validateQuestionParameters(params);

            let details: QuestionResultDetails;
            if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) {
                details = unavailableResult();
            } else if (ctx.mode === "tui") {
                details = await runTuiQuestionFlow(ctx, params.questions, signal);
            } else {
                details = await runStandardQuestionFlow(
                    { hasUI: ctx.hasUI, ui: ctx.ui },
                    params.questions,
                    signal,
                );
            }

            return buildQuestionToolResult(details);
        },
        renderCall(args, theme) {
            const count = args.questions.length;
            const prompts = args.questions.map((question, index) => `Q${index + 1}: ${question.prompt}`);
            return new Text(`${theme.fg("accent", "question")} — ${count} ${count === 1 ? "item" : "items"}\n${prompts.join("\n")}`);
        },
        renderResult(result, options, theme, context) {
            const details = result.details;
            const questions = context.args.questions;
            const count = Object.keys(details.answers).length;
            const unanswered = questions.length - count;
            const current = details.currentQuestionId === undefined ? "" : ` at ${details.currentQuestionId}`;
            const summary = `${theme.fg("accent", details.status)} — ${count} answered, ${unanswered} unanswered${current}`;
            const rows = questions.map((question, index) => {
                const answer = details.answers[question.id];
                const title = `Q${index + 1}: ${question.prompt}`;
                if (answer === undefined) return `${title} — Unanswered`;
                const display = answerDisplay(question, answer, options.expanded);
                return options.expanded ? `${title}\n  ${display.replace(/\n/g, "\n  ")}` : `${title} — ${display}`;
            });
            return new Text(`${summary}\n${rows.join("\n")}`);
        },
    });
}

export default function registerQuestion(pi: ExtensionAPI): void {
    // Parse the user file during extension loading; inherited-key validation runs when TUI injects its manager.
    loadQuestionKeymapConfig();
    pi.registerTool(createQuestionToolDefinition());
}
