import {
    defineTool,
    type ExtensionAPI,
    type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
    buildQuestionToolResult,
    formatQuestionResponse,
    questionParameters,
    unavailableResult,
    validateQuestionParameters,
    type QuestionItem,
    type QuestionResponse,
    type QuestionResultDetails,
} from "./utilities/decision_core.ts";
import { runStandardQuestionFlow } from "./utilities/decision_standard_ui.ts";
import { runTuiQuestionFlow } from "./utilities/decision_tui.ts";
import { loadQuestionKeymapConfig } from "./utilities/decision_keymap.ts";

export const questionDescription =
    "Ask the user for decisions or missing information required to continue the current task. Supports single-choice, multiple-choice, and multiline text questions. For yes/no questions, use a two-option single question. Users may add an optional response note to selected answers or submit an unanswered note when no option applies. Users may submit with questions untouched; absent response IDs are intentionally skipped.";

function inline(value: string): string {
    return value.replace(/\s*\r?\n\s*/g, " ⏎ ").trim();
}

function responseDisplay(question: QuestionItem, response: QuestionResponse, expanded: boolean): string {
    const formatValue = expanded ? (value: string) => value : inline;
    return formatQuestionResponse(question, response, {
        formatText: formatValue,
        formatResponseNote: value => ` — note: ${formatValue(value)}`,
    });
}

export const questionPromptGuidelines = [
    "Ask only questions whose answers affect the current task; do not ask for facts available from the repository or provided materials.",
    "Group related questions in one question call when useful, but ask the minimum number needed.",
    "For yes/no questions, use kind='single' with Yes and No options and stable string values.",
    "Users can add one optional response note to a selected answer, or submit an unanswered note when no option fits. Treat each note as decision input.",
    "When a user may choose a direction such as 'revise' and explain conditions, prefer that option with its note over adding a separate text question.",
    "Separate meaningful directions into options and use notes for conditions that do not fit the option label.",
    "Do not mechanically add a generic 'Other' option; users can submit an unanswered note when no option applies.",
    "A submitted question result may omit untouched question IDs. Treat absent IDs as intentionally skipped rather than as tool failure.",
    "After receiving the structured responses, return to the original task.",
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
            "Ask the user to make user-owned decisions or provide missing information that affects the current task, with optional response notes",
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
            const responded = Object.keys(details.responses).length;
            const untouched = questions.length - responded;
            const answered = questions.filter(q => {
                const r = details.responses[q.id];
                return r?.kind === "single" || r?.kind === "multi" || r?.kind === "text";
            }).length;
            const withNote = questions.filter(q => details.responses[q.id]?.kind === "unanswered").length;
            const current = details.currentQuestionId === undefined ? "" : ` at ${details.currentQuestionId}`;
            const summary = `${theme.fg("accent", details.status)} — ${answered} answered, ${withNote} unanswered with note, ${untouched} untouched${current}`;
            const rows = questions.map((question, index) => {
                const response = details.responses[question.id];
                const title = `Q${index + 1}: ${question.prompt}`;
                if (response === undefined) return `${title} — Untouched`;
                const display = responseDisplay(question, response, options.expanded);
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
