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
    "Ask the user for task-relevant decisions or missing information. Write-ins are answers; absent response IDs are intentionally skipped.";

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

const questionPromptGuidelines = [
    "Use question only for user-owned input unavailable from current evidence, grouping the minimum useful questions.",
    "In question, use option notes for conditions, especially revision conditions; require a note when an explanation is necessary.",
    "Treat question write-ins as answers and absent IDs as skipped, not settled. A cancelled or unavailable question leaves the decision unresolved.",
];

export function createQuestionToolDefinition(): ToolDefinition<
    typeof questionParameters,
    QuestionResultDetails
> {
    return defineTool({
        name: "question",
        label: "Question",
        description: questionDescription,
        promptSnippet: "Ask for user-owned task input",
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
