import {
    defineTool,
    type ExtensionAPI,
    type ExtensionContext,
    type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
    approvePendingArtifact,
    artifactParameters,
    artifactSummary,
    createOrUpdatePendingArtifact,
    readPendingArtifactContent,
    rejectPendingArtifact,
    requestPendingArtifactRevision,
    type ArtifactKind,
    type ArtifactSummary,
} from "./utilities/agent_artifact_store.ts";
import {
    type DecisionFlowPolicy,
    type DecisionItem,
    type DecisionResultDetails,
} from "./utilities/decision_core.ts";
import { runStandardDecisionFlow } from "./utilities/decision_standard_ui.ts";
import { runTuiDecisionFlow } from "./utilities/decision_tui.ts";

export type AgentArtifactStatus = "approved" | "revision_requested" | "rejected" | "unavailable" | "error";

export interface AgentArtifactResultDetails {
    status: AgentArtifactStatus;
    kind: ArtifactKind;
    slug: string;
    pendingId: string;
    pendingPath: string;
    plannedFinalPath: string;
    finalPath?: string;
    title: string;
    summary: string;
    lineCount: number;
    fileSize: number;
    revisionInstructions?: string;
    actionNote?: string;
    message: string;
}

export const agentArtifactDescription =
    "Create a pending specification or implementation plan artifact, show it to the user for approval, and promote it to the project artifact directory only after approval.";

export const agentArtifactPromptGuidelines = [
    "Use save_agent_artifact for completed specification and implementation plan drafts; do not print the full artifact in normal assistant text first.",
    "Pass the completed Markdown content to save_agent_artifact once so the pending file, review screen, and approved artifact use the same content.",
    "Use kind=spec for specifications and kind=plan for implementation plans.",
    "Provide a non-empty lowercase kebab-case slug that describes the artifact.",
    "If save_agent_artifact returns revision_requested, read the pendingPath, edit that same artifact content, and call save_agent_artifact again with the same pendingId instead of creating a new artifact.",
    "After save_agent_artifact returns approved, mention the finalPath if useful but do not repeat the artifact body.",
];

function detailsFrom(
    summary: ArtifactSummary,
    status: AgentArtifactStatus,
    message: string,
    options: { revisionInstructions?: string; actionNote?: string } = {},
): AgentArtifactResultDetails {
    return {
        status,
        kind: summary.kind,
        slug: summary.slug,
        pendingId: summary.id,
        pendingPath: summary.pendingPath,
        plannedFinalPath: summary.plannedFinalPath,
        finalPath: summary.finalPath,
        title: summary.title,
        summary: summary.summary,
        lineCount: summary.lineCount,
        fileSize: summary.fileSize,
        revisionInstructions: options.revisionInstructions,
        actionNote: options.actionNote,
        message,
    };
}

function resultText(details: AgentArtifactResultDetails): string {
    const rows = [
        `status: ${details.status}`,
        `kind: ${details.kind}`,
        `title: ${details.title}`,
        `summary: ${details.summary}`,
        `pendingId: ${details.pendingId}`,
        `pendingPath: ${details.pendingPath}`,
        `plannedFinalPath: ${details.plannedFinalPath}`,
        details.finalPath === undefined ? undefined : `finalPath: ${details.finalPath}`,
        `lineCount: ${details.lineCount}`,
        `fileSize: ${details.fileSize}`,
        details.revisionInstructions === undefined ? undefined : `revisionInstructions: ${details.revisionInstructions}`,
        details.actionNote === undefined ? undefined : `actionNote: ${details.actionNote}`,
        details.message,
    ].filter((row): row is string => row !== undefined);
    return rows.join("\n");
}

function reviewText(summary: ArtifactSummary): string {
    return [
        "Review pending agent artifact",
        `Kind: ${summary.kind}`,
        `Title: ${summary.title}`,
        `Summary: ${summary.summary}`,
        `Pending path: ${summary.pendingPath}`,
        `Planned final path: ${summary.plannedFinalPath}`,
        `Line count: ${summary.lineCount}`,
        `File size: ${summary.fileSize} bytes`,
    ].join("\n");
}

type ApprovalAction = "approve" | "revise" | "reject" | "view";

const approvalDecisionPolicy: DecisionFlowPolicy = {
    autoSubmitSingle: true,
    noteRequirement(_item, option) {
        if (option?.value === "view") return "none";
        if (option?.value === "revise") return "required";
        return "optional";
    },
};

function approvalQuestion(summary: ArtifactSummary): DecisionItem {
    return {
        id: "artifact-action",
        prompt: reviewText(summary),
        kind: "single",
        options: [
            { value: "approve", label: "Approve" },
            { value: "revise", label: "Request revision" },
            { value: "reject", label: "Reject" },
            { value: "view", label: "View full text" },
        ],
        note: {
            mode: "answer",
            placeholder: "Add conditions, reasons, or revision instructions",
        },
    };
}

async function askApprovalDecision(
    ctx: ExtensionContext,
    summary: ArtifactSummary,
    signal?: AbortSignal,
): Promise<DecisionResultDetails> {
    const questions = [approvalQuestion(summary)];
    return ctx.mode === "tui"
        ? runTuiDecisionFlow(ctx, questions, signal, approvalDecisionPolicy)
        : runStandardDecisionFlow({ hasUI: ctx.hasUI, ui: ctx.ui }, questions, signal, approvalDecisionPolicy);
}

async function selectApprovalAction(
    ctx: ExtensionContext,
    summary: ArtifactSummary,
    signal?: AbortSignal,
): Promise<{ action: Exclude<ApprovalAction, "view">; note?: string } | undefined> {
    while (!signal?.aborted) {
        const decision = await askApprovalDecision(ctx, summary, signal);
        const answer = decision.answers["artifact-action"];
        if (decision.status !== "answered" || answer?.kind !== "single") return undefined;
        const action = answer.value as ApprovalAction;
        if (action === "view") {
            const content = await readPendingArtifactContent(ctx.cwd, summary.id);
            await ctx.ui.editor(`Full text: ${summary.pendingPath}`, content);
            continue;
        }
        if (action === "revise" && answer.note === undefined) {
            ctx.ui.notify("Request revision requires non-blank revision instructions in the action note.", "warning");
            continue;
        }
        return { action, note: answer.note };
    }
    return undefined;
}

async function runApprovalFlow(ctx: ExtensionContext, summary: ArtifactSummary, signal?: AbortSignal): Promise<AgentArtifactResultDetails> {
    if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) {
        return detailsFrom(summary, "unavailable", "Approval UI is unavailable; pending artifact was not promoted.");
    }

    const decision = await selectApprovalAction(ctx, summary, signal);
    if (decision?.action === "approve") {
        const approved = artifactSummary(await approvePendingArtifact(ctx.cwd, summary.id));
        return detailsFrom(approved, "approved", `Approved and saved to ${approved.finalPath}`, { actionNote: decision.note });
    }
    if (decision?.action === "revise") {
        const instructions = decision.note!;
        const revised = artifactSummary(await requestPendingArtifactRevision(ctx.cwd, summary.id, instructions));
        return detailsFrom(revised, "revision_requested", "Revision requested; edit the same pending artifact and call save_agent_artifact with pendingId.", {
            revisionInstructions: instructions,
            actionNote: instructions,
        });
    }

    const rejected = artifactSummary(await rejectPendingArtifact(ctx.cwd, summary.id));
    return detailsFrom(
        rejected,
        "rejected",
        decision === undefined ? "Artifact approval was cancelled; the artifact was not saved as a final artifact." : "Artifact was rejected and was not saved as a final artifact.",
        { actionNote: decision?.note },
    );
}

export function createAgentArtifactToolDefinition(): ToolDefinition<typeof artifactParameters, AgentArtifactResultDetails> {
    return defineTool({
        name: "save_agent_artifact",
        label: "Save agent artifact",
        description: agentArtifactDescription,
        promptSnippet: "Create, review, and approve a project-local spec or plan artifact without repeating its body",
        promptGuidelines: agentArtifactPromptGuidelines,
        parameters: artifactParameters,
        executionMode: "sequential",
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            const pending = await createOrUpdatePendingArtifact({
                cwd: ctx.cwd,
                kind: params.kind,
                slug: params.slug,
                content: params.content,
                pendingId: params.pendingId,
            });
            const details = await runApprovalFlow(ctx, artifactSummary(pending), signal);
            return { content: [{ type: "text", text: resultText(details) }], details };
        },
        renderCall(args, theme) {
            const pending = args.pendingId === undefined ? "new pending artifact" : `update ${args.pendingId}`;
            return new Text(`${theme.fg("accent", "save_agent_artifact")} — ${args.kind} ${args.slug} (${pending})`);
        },
        renderResult(result, _options, theme) {
            const details = result.details;
            const path = details.finalPath ?? details.pendingPath;
            return new Text(`${theme.fg("accent", details.status)} — ${details.kind} ${details.title}\n${details.summary}\n${path}`);
        },
    });
}

export default function registerAgentArtifact(pi: ExtensionAPI): void {
    pi.registerTool(createAgentArtifactToolDefinition());
}
