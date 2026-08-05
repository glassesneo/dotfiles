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
    "Ask the user for user-owned decisions or missing information that affects the current task. Supports single-choice, multiple-choice, and multiline text questions. For yes/no questions, use a two-option single question with stable values. Options accept notes; set noteRequired to true when an explanation is required. Users can submit a write-in response when no listed option applies, and write-ins count as answered. Users may submit with questions untouched; absent response IDs are intentionally skipped.";

function inline(value: string): string {
    return value.replace(/\s*\r?\n\s*/g, " ⏎ ").trim();
}

function responseDisplay(question: QuestionItem, response: QuestionResponse, expanded: boolean): string {
    const formatValue = expanded ? (value: string) => value : inline;
    const format = (value: QuestionResponse): string => formatQuestionResponse(question, value, {
        formatText: formatValue,
        formatResponseNote: note => ` — note: ${formatValue(note)}`,
    });
    if (response.kind !== "multi") return format(response);
    return [
        ...response.values.map(value => format({ kind: "multi", values: [value] })),
        ...(response.writeIn === undefined ? [] : [format({ kind: "write-in", value: response.writeIn })]),
    ].join(expanded ? "\n" : ", ");
}

export const questionPromptGuidelines = [
    "Use the `question` tool only for user-owned decisions or missing information that affects the current task; do not use it for facts available from the repository or provided materials.",
    "In a `question` tool call, group related questions when useful, but ask the minimum number needed.",
    "For yes/no questions in the `question` tool, use kind='single' with Yes and No options and stable string values.",
    "The `question` tool lets users add a note to each selected option; set `noteRequired: true` when an option requires a non-blank explanation. Multi-choice results keep each note with its option.",
    "Users may submit a write-in response when no listed option applies. Treat a write-in as answered decision input, not as an unanswered choice.",
    "When the `question` tool asks the user to choose a direction such as 'revise' and explain conditions, prefer that option with its note over adding a separate text question.",
    "In the `question` tool, separate meaningful directions into options and use notes for conditions that do not fit the option label.",
    "Do not mechanically add a generic 'Other' option to the `question` tool; users can use the write-in action when no option applies. A contextually meaningful Other option may be used with `noteRequired: true`.",
    "A submitted `question` tool result may omit untouched question IDs. Treat absent IDs as intentionally skipped rather than as tool failure, and do not treat the omitted decisions as settled.",
    "If the `question` tool returns cancelled or unavailable, do not treat its requested user-owned decisions as settled; use an available conversation fallback when appropriate.",
    "After receiving responses from the `question` tool, return to the original task.",
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
            "Use the question tool to ask the user for user-owned decisions or missing information that affects the current task, with optional notes for selected options",
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
                return r?.kind === "single" || r?.kind === "multi" || r?.kind === "text" || r?.kind === "write-in";
            }).length;
            const current = details.currentQuestionId === undefined ? "" : ` at ${details.currentQuestionId}`;
            const summary = `${theme.fg("accent", details.status)} — ${answered} answered, ${untouched} untouched${current}`;
            const rows = questions.map((question, index) => {
                const response = details.responses[question.id];
                const title = `Q${index + 1}`;
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
