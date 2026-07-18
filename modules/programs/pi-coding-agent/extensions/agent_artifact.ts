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
} from "./agent_artifact_store.ts";

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

function detailsFrom(summary: ArtifactSummary, status: AgentArtifactStatus, message: string, revisionInstructions?: string): AgentArtifactResultDetails {
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
        revisionInstructions,
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

async function selectApprovalAction(ctx: ExtensionContext, summary: ArtifactSummary, signal?: AbortSignal): Promise<"approve" | "revise" | "reject" | undefined> {
    const choices = ["Approve", "Request revision", "Reject", "View full text"];
    while (true) {
        const selected = await ctx.ui.select(reviewText(summary), choices, { signal });
        if (selected === undefined || signal?.aborted) return undefined;
        if (selected === "Approve") return "approve";
        if (selected === "Request revision") return "revise";
        if (selected === "Reject") return "reject";
        if (selected === "View full text") {
            const content = await readPendingArtifactContent(ctx.cwd, summary.id);
            await ctx.ui.editor(`Full text: ${summary.pendingPath}`, content);
        }
    }
}

async function runApprovalFlow(ctx: ExtensionContext, summary: ArtifactSummary, signal?: AbortSignal): Promise<AgentArtifactResultDetails> {
    if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) {
        return detailsFrom(summary, "unavailable", "Approval UI is unavailable; pending artifact was not promoted.");
    }

    const action = await selectApprovalAction(ctx, summary, signal);
    if (action === "approve") {
        const approved = artifactSummary(await approvePendingArtifact(ctx.cwd, summary.id));
        return detailsFrom(approved, "approved", `Approved and saved to ${approved.finalPath}`);
    }
    if (action === "revise") {
        const instructions = await ctx.ui.editor("Revision instructions", "");
        if (instructions === undefined || instructions.trim() === "") {
            const rejected = artifactSummary(await rejectPendingArtifact(ctx.cwd, summary.id));
            return detailsFrom(rejected, "rejected", "Artifact approval was cancelled before revision instructions were supplied.");
        }
        const revised = artifactSummary(await requestPendingArtifactRevision(ctx.cwd, summary.id, instructions));
        return detailsFrom(revised, "revision_requested", "Revision requested; edit the same pending artifact and call save_agent_artifact with pendingId.", instructions);
    }

    const rejected = artifactSummary(await rejectPendingArtifact(ctx.cwd, summary.id));
    return detailsFrom(rejected, "rejected", "Artifact was rejected and was not saved as a final artifact.");
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
