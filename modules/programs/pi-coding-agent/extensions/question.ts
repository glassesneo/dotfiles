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
    type QuestionResultDetails,
} from "./question_core.ts";
import { runStandardQuestionFlow } from "./question_standard_ui.ts";
import { runTuiQuestionFlow } from "./question_tui.ts";

export const questionDescription =
    "Ask the user for decisions or missing information required to continue the current task. Supports sequential single-choice, multiple-choice, multiline text, and confirmation questions; every selection may include an optional note.";

export const questionPromptGuidelines = [
    "Ask only questions whose answers affect the current task; do not ask for facts available from the repository or provided materials.",
    "Group related questions in one question call when useful, but ask the minimum number needed.",
    "Users may attach an optional note to every single, multi, or confirm selection. Treat each note as decision input alongside its associated value.",
    "When a user may choose a direction such as 'revise' and explain conditions, prefer that option with its note over adding a separate text question.",
    "Separate meaningful directions into options and use notes for conditions that do not fit the option label.",
    "Do not mechanically add a generic 'Other' option because notes are always available; add it only when it is a meaningful independent branch.",
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
            return new Text(
                `${theme.fg("accent", "question")} ${count} ${count === 1 ? "item" : "items"}`,
            );
        },
        renderResult(result, options, theme) {
            const details = result.details;
            const count = Object.keys(details.answers).length;
            const current =
                details.currentQuestionId === undefined
                    ? ""
                    : ` at ${details.currentQuestionId}`;
            const summary = `${theme.fg("accent", details.status)} — ${count} ${count === 1 ? "answer" : "answers"}${current}`;
            if (!options.expanded || count === 0) return new Text(summary);
            return new Text(`${summary}\n${Object.keys(details.answers).join("\n")}`);
        },
    });
}

export default function registerQuestion(pi: ExtensionAPI): void {
    pi.registerTool(createQuestionToolDefinition());
}
