import { UserMessageComponent, type AgentToolResult, type Theme, type ThemeColor, type ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import {
    AGENT_STATE_BADGES,
    TASK_STATE_BADGES,
    agentColorRole,
    formatStateBadge,
    formatTaskStateBadge,
} from "./orchestration_display_tree.ts";
import {
    displayIdentityForAgentId,
    displayIdentityForSnapshot,
    fitUsualIdentityLine,
    formatCompactAgentIdentity,
    formatUsualStatus,
    partyLabelForEndpoint,
    publicCapabilityLabel,
    type AgentDisplayIdentity,
} from "./orchestration_identity.ts";
import type { SubmitDetails } from "./orchestration_projection.ts";
import { type AgentSnapshot, type AgentState, type TaskState } from "./orchestration_types.ts";

/** Subset of Pi ToolRenderContext used by mesh cards (not re-exported by the package). */
export type CardRenderContext = {
    args?: object;
    lastComponent: Component | undefined;
    expanded?: boolean;
    isError?: boolean;
};

export type SendCardArgs = { agent?: string; access?: "read" | "write"; agentId?: string; purpose?: string; message: string };
export type EndResponseCardArgs = object;
export type ControlCardArgs = { agentId: string; action: "pause" | "interrupt" | "resume" };
export type ReportCardArgs = { summary: string };

const COLLAPSED_ERROR_CHARS = 240;
const EXPANDED_TEXT_LINES = 40;
const EXPANDED_TEXT_CHARS = 4_000;
const RAW_PAYLOAD_LINES = 40;
const RAW_PAYLOAD_CHARS = 4_000;

class WidthSafeText implements Component {
    #text: string;
    #pad: number;
    constructor(text: string, pad = 0) { this.#text = text; this.#pad = pad; }
    setText(text: string, pad = this.#pad): void { this.#text = text; this.#pad = pad; }
    invalidate(): void {}
    render(width: number): string[] {
        const outer = Math.max(1, width);
        const pad = " ".repeat(Math.min(this.#pad, Math.max(0, outer - 1)));
        const inner = Math.max(1, outer - pad.length);
        const lines = this.#text.replace(/\r\n|\r/gu, "\n").split("\n").flatMap(line => line.length ? wrapTextWithAnsi(line, inner) : [""]);
        return lines.map(line => truncateToWidth(`${pad}${line}`, outer, ""));
    }
}

function previewText(value: string, maxLines: number, maxChars: number): string {
    const lines = value.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").split("\n");
    const kept = lines.slice(0, maxLines).join("\n");
    const chars = Array.from(kept);
    if (chars.length <= maxChars && lines.length <= maxLines) return kept;
    return `${chars.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}

function joinParts(parts: Array<string | undefined>): string { return parts.filter((part): part is string => Boolean(part)).join(" · "); }
function textFromComponent(last: Component | undefined, text: string): WidthSafeText {
    if (last instanceof WidthSafeText) { last.setText(text); return last; }
    return new WidthSafeText(text);
}
function argsRecord(context: CardRenderContext): Record<string, unknown> { return context.args as Record<string, unknown> | undefined ?? {}; }
function labeled(theme: Theme, label: string, value: string): string { return `${theme.fg("muted", `${label}:`)} ${value}`; }
function styleBadge(theme: Theme, role: ThemeColor, text: string): string { return theme.fg(role, text); }
function agentStateText(theme: Theme, state: AgentState): string { return styleBadge(theme, AGENT_STATE_BADGES[state].role, formatStateBadge(state)); }
function taskStateText(theme: Theme, state: TaskState): string { return styleBadge(theme, TASK_STATE_BADGES[state].role, formatTaskStateBadge(state)); }
function agentTypeText(theme: Theme, agent: string): string { return theme.fg(agentColorRole(agent), agent); }

function isRenderableAgentSnapshot(value: unknown): value is AgentSnapshot {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    const agent = record.agent as Record<string, unknown> | undefined;
    const status = record.status as Record<string, unknown> | undefined;
    if (!agent || !status || typeof agent.agentId !== "string" || typeof agent.childId !== "string" || typeof status.state !== "string") return false;
    const task = record.task;
    if (task === undefined || task === null) return true;
    if (typeof task !== "object") return false;
    const taskRecord = task as Record<string, unknown>;
    const request = taskRecord.request as Record<string, unknown> | undefined;
    const taskStatus = taskRecord.status as Record<string, unknown> | undefined;
    return Boolean(request && taskStatus && typeof request.prompt === "string" && typeof request.purpose === "string" && typeof taskStatus.state === "string");
}
function isSubmitDetails(value: unknown): value is SubmitDetails { return isRenderableAgentSnapshot(value) && Boolean((value as unknown as Record<string, unknown>).accounting); }
function isDisplayIdentity(value: unknown): value is AgentDisplayIdentity {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (typeof record.agentId !== "string" || typeof record.handle !== "string") return false;
    if (record.publicAgent !== undefined && typeof record.publicAgent !== "string") return false;
    if (record.access !== undefined && record.access !== "read" && record.access !== "write") return false;
    if (record.purpose !== undefined && typeof record.purpose !== "string") return false;
    if (record.status !== undefined && typeof record.status !== "string") return false;
    if (record.taskState !== undefined && typeof record.taskState !== "string") return false;
    if (record.description !== undefined && typeof record.description !== "string") return false;
    if (record.model !== undefined && typeof record.model !== "string") return false;
    if (record.fallbackCount !== undefined && (!Number.isInteger(record.fallbackCount) || Number(record.fallbackCount) < 0)) return false;
    if (record.thinkingLevel !== undefined && typeof record.thinkingLevel !== "string") return false;
    if (record.harness !== undefined && typeof record.harness !== "string") return false;
    if (record.attempts !== undefined) {
        if (!Array.isArray(record.attempts)) return false;
        for (const attempt of record.attempts) {
            if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) return false;
            const item = attempt as Record<string, unknown>;
            if (!Number.isInteger(item.index) || typeof item.model !== "string" || typeof item.category !== "string" || typeof item.at !== "string") return false;
            if (item.message !== undefined && typeof item.message !== "string") return false;
        }
    }
    return true;
}
function identityFor(agentId: string, value?: unknown, words?: readonly string[]): AgentDisplayIdentity {
    return isDisplayIdentity(value) && value.agentId === agentId ? value : displayIdentityForAgentId(agentId, words);
}
class CompactAgentCard implements Component {
    #snapshot: AgentSnapshot;
    #theme: Theme;
    #words?: readonly string[];
    constructor(snapshot: AgentSnapshot, theme: Theme, words?: readonly string[]) {
        this.#snapshot = snapshot;
        this.#theme = theme;
        this.#words = words;
    }
    update(snapshot: AgentSnapshot, theme: Theme, words?: readonly string[]): void {
        this.#snapshot = snapshot;
        this.#theme = theme;
        this.#words = words;
    }
    invalidate(): void {}
    render(width: number): string[] {
        const outer = Math.max(1, width);
        const identity = displayIdentityForSnapshot(this.#snapshot, this.#words);
        const fitted = fitUsualIdentityLine(identity, outer);
        const styled = this.#theme.bold(fitted);
        const taskBadge = this.#snapshot.task ? taskStateText(this.#theme, this.#snapshot.task.status.state) : undefined;
        if (!taskBadge) return [styled];
        const combined = joinParts([styled, taskBadge]);
        if (visibleWidth(combined) <= outer) return [combined];
        return [styled, truncateToWidth(taskBadge, outer, "")];
    }
}

function compactAgentCard(last: Component | undefined, snapshot: AgentSnapshot, theme: Theme, words?: readonly string[]): CompactAgentCard {
    if (last instanceof CompactAgentCard) {
        last.update(snapshot, theme, words);
        return last;
    }
    return new CompactAgentCard(snapshot, theme, words);
}

type DirectionalBlock = { header: string; body?: string; extra?: string[] };

/** Received follow-up/report rendering: short header lines plus Pi-owned full bodies. */
class ReceivedFullTextCard implements Component {
    #blocks: DirectionalBlock[];
    #expanded: boolean;
    #pad: number;
    constructor(blocks: DirectionalBlock[], expanded: boolean, pad = 0) {
        this.#blocks = blocks;
        this.#expanded = expanded;
        this.#pad = pad;
    }
    invalidate(): void {}
    render(width: number): string[] {
        const outer = Math.max(1, width);
        const pad = " ".repeat(Math.min(this.#pad, Math.max(0, outer - 1)));
        const inner = Math.max(1, outer - pad.length);
        const lines: string[] = [];
        for (const block of this.#blocks) {
            lines.push(...wrapTextWithAnsi(block.header, inner).map(line => truncateToWidth(`${pad}${line}`, outer, "")));
            if (block.body !== undefined) {
                try {
                    lines.push(...new UserMessageComponent(block.body, undefined, this.#pad).render(outer));
                } catch {
                    // Pi theme is unavailable outside a live session (e.g. unit tests):
                    // keep the full-text contract with plain wrapping instead of crashing.
                    lines.push(...block.body.replace(/\r\n|\r/gu, "\n").split("\n").flatMap(line => line.length ? wrapTextWithAnsi(line, inner) : [""]).map(line => truncateToWidth(`${pad}${line}`, outer, "")));
                }
            }
            if (this.#expanded) for (const extra of block.extra ?? []) lines.push(...wrapTextWithAnsi(extra, inner).map(line => truncateToWidth(`${pad}${line}`, outer, "")));
        }
        return lines.length ? lines : [""];
    }
}

class EventCard implements Component {
    #blocks: DirectionalBlock[];
    #expanded: boolean;
    #pad: number;
    constructor(blocks: DirectionalBlock[], _remainderHint: string, expanded: boolean, pad = 0) {
        this.#blocks = blocks;
        this.#expanded = expanded;
        this.#pad = pad;
    }
    invalidate(): void {}
    render(width: number): string[] {
        const outer = Math.max(1, width);
        const pad = " ".repeat(Math.min(this.#pad, Math.max(0, outer - 1)));
        const inner = Math.max(1, outer - pad.length);
        const lines: string[] = [];
        for (const block of this.#blocks) {
            lines.push(...wrapTextWithAnsi(block.header, inner));
            if (block.body) {
                if (this.#expanded) lines.push(...wrapTextWithAnsi(previewText(block.body, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS), inner));
                else {
                    const wrapped = block.body.replace(/\r\n|\r/gu, "\n").split("\n").flatMap(line => line.length ? wrapTextWithAnsi(line, inner) : [""]).filter(line => line.length > 0);
                    lines.push(...wrapped.slice(0, 2));
                }
            }
            if (this.#expanded) for (const extra of block.extra ?? []) lines.push(...wrapTextWithAnsi(extra, inner));
        }
        return (lines.length ? lines : [""]).map(line => truncateToWidth(`${pad}${line}`, outer, ""));
    }
}

function directionalBlock(from: string | undefined, to: string | undefined, kind: string, delivery: string | undefined, body: string | undefined, extra: string[] = []): DirectionalBlock {
    const arrow = from && to ? `${from} → ${to}` : from ?? to;
    return { header: joinParts([arrow, kind, delivery]), ...(body ? { body } : {}), extra };
}

function eventCard(blocks: DirectionalBlock[], _theme: Theme, expanded: boolean, pad = 0): Component {
    return new EventCard(blocks, "", expanded, pad);
}

function attemptLines(theme: Theme, attempts: NonNullable<AgentDisplayIdentity["attempts"]>): string[] {
    return attempts.map(attempt => labeled(
        theme,
        `attempt#${attempt.index}`,
        `${attempt.model} · ${attempt.category}${attempt.message ? `: ${previewText(attempt.message, 2, 240)}` : ""}`,
    ));
}

function expandedAgentCard(theme: Theme, snapshot: AgentSnapshot, argsPrompt?: string, words?: readonly string[]): string {
    const task = snapshot.task;
    const identity = displayIdentityForSnapshot(snapshot, words);
    const capability = publicCapabilityLabel(identity);
    const lines = [
        labeled(theme, "handle", identity.handle),
        labeled(theme, "agent", capability ?? "unavailable"),
        labeled(theme, "status", formatUsualStatus(identity.status) ?? "unavailable"),
        ...(identity.description ? [labeled(theme, "description", identity.description)] : []),
        labeled(theme, "agentId", snapshot.agent.agentId),
        labeled(theme, "model", identity.model ?? "unavailable"),
        labeled(theme, "fallback", String(identity.fallbackCount ?? 0)),
        labeled(theme, "thinking", identity.thinkingLevel ?? "unavailable"),
        labeled(theme, "harness", identity.harness ?? "unavailable"),
        labeled(theme, "agentState", agentStateText(theme, snapshot.status.state)),
        labeled(theme, "activity", snapshot.activity.phase),
        labeled(theme, "acceptingTask", String(snapshot.activity.acceptingTask)),
        labeled(theme, "pendingMessages", snapshot.activity.pendingMessages === null ? "unknown" : String(snapshot.activity.pendingMessages)),
        labeled(theme, "contextHealth", snapshot.activity.context.health),
    ];
    if (identity.attempts?.length) lines.push(...attemptLines(theme, identity.attempts));
    if (snapshot.stop) {
        lines.push(labeled(theme, "stopState", snapshot.stop.state), labeled(theme, "stopSource", snapshot.stop.source), labeled(theme, "stopReason", previewText(snapshot.stop.reason, 4, 512)));
    }
    if (task) {
        lines.push(labeled(theme, "taskId", task.request.taskId), labeled(theme, "taskState", taskStateText(theme, task.status.state)), labeled(theme, "purpose", task.request.purpose), labeled(theme, "prompt", previewText(task.request.prompt, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)), labeled(theme, "createdAt", task.status.createdAt));
        if (task.status.startedAt) lines.push(labeled(theme, "startedAt", task.status.startedAt));
        if (task.status.finishedAt) lines.push(labeled(theme, "finishedAt", task.status.finishedAt));
        if (task.interventions.length > 0) {
            lines.push(labeled(theme, "interventions", String(task.interventions.length)));
            for (const intervention of task.interventions) lines.push(`  #${intervention.sequence} ${intervention.deliveryMode}: ${previewText(intervention.text, 2, 200)}`);
        }
        if (task.result) {
            if (task.result.error) lines.push(labeled(theme, "error", previewText(task.result.error, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)));
            if (task.result.output) lines.push(labeled(theme, "output", previewText(task.result.output, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)));
            lines.push(labeled(theme, "turns", snapshot.agent.capabilities.usage ? String(task.result.turns) : "unavailable"), labeled(theme, "usage", snapshot.agent.capabilities.usage ? `${task.result.usage.totalTokens} tokens · $${task.result.usage.cost.total.toFixed(4)}` : "unavailable"), labeled(theme, "resultStartedAt", task.result.startedAt), labeled(theme, "resultFinishedAt", task.result.finishedAt));
        }
        lines.push(labeled(theme, "path", task.directory));
    } else {
        lines.push(labeled(theme, "summary", "No task"));
        if (argsPrompt) lines.push(labeled(theme, "prompt", previewText(argsPrompt, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)));
    }
    if (snapshot.status.childSessionFile) lines.push(labeled(theme, "sessionFile", snapshot.status.childSessionFile));
    lines.push(labeled(theme, "agentUsage", snapshot.agent.capabilities.usage ? `${snapshot.status.agentUsage.totalTokens} tokens · $${snapshot.status.agentUsage.cost.total.toFixed(4)}` : "unavailable"));
    return lines.join("\n");
}

function rawText(payload: unknown): string { try { return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) ?? String(payload); } catch { return String(payload); } }
function malformedNotice(theme: Theme, expanded: boolean, payload: unknown): string {
    const notice = theme.fg("error", "Malformed mesh result — expand for bounded raw payload");
    return expanded ? `${notice}\n${theme.fg("dim", previewText(rawText(payload), RAW_PAYLOAD_LINES, RAW_PAYLOAD_CHARS))}` : notice;
}
function resultPayload(result: AgentToolResult<unknown>): unknown { return result.details ?? result.content.map(part => "text" in part ? part.text : "").filter(Boolean).join("\n"); }
function resultProblem(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext): string {
    if (!context.isError) return malformedNotice(theme, options.expanded, resultPayload(result));
    const content = result.content.map(part => "text" in part ? part.text : "").filter(Boolean).join("\n");
    const summary = previewText(content.replace(/\s+/gu, " ").trim() || "Tool execution failed", 1, COLLAPSED_ERROR_CHARS);
    const notice = theme.fg("error", `Error: ${summary}`);
    return options.expanded ? `${notice}\n${theme.fg("dim", previewText(rawText(resultPayload(result)), RAW_PAYLOAD_LINES, RAW_PAYLOAD_CHARS))}` : notice;
}

function renderAgentResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, words?: readonly string[]): Component {
    try {
        if (!isRenderableAgentSnapshot(result.details)) throw new Error("invalid snapshot");
        const snapshot = result.details;
        if (!options.expanded) return compactAgentCard(context.lastComponent, snapshot, theme, words);
        const args = argsRecord(context);
        const message = typeof args.message === "string" ? args.message : undefined;
        return textFromComponent(context.lastComponent, expandedAgentCard(theme, snapshot, message, words));
    } catch { return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context)); }
}

export function renderSendCall(args: SendCardArgs, theme: Theme, context: CardRenderContext): Component {
    const lines = [joinParts(["mesh_send", args.agentId !== undefined ? "existing agent" : "new agent"])];
    if (context.expanded) {
        if (args.agent) lines.push(labeled(theme, "requestedAgent", agentTypeText(theme, args.agent)));
        if (args.access) lines.push(labeled(theme, "requestedAccess", args.access));
        if (args.agentId !== undefined) lines.push(labeled(theme, "agentId", args.agentId));
        if (args.purpose) lines.push(labeled(theme, "purpose", previewText(args.purpose, 1, 120)));
        lines.push(labeled(theme, "message", previewText(args.message, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)));
    }
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
export function renderGetCall(args: { taskId: string }, theme: Theme, context: CardRenderContext): Component {
    const lines = [joinParts(["mesh_get", "task"])];
    if (context.expanded) lines.push(labeled(theme, "taskId", args.taskId));
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
export function renderEndResponseCall(_args: EndResponseCardArgs, _theme: Theme, context: CardRenderContext): Component {
    return textFromComponent(context.lastComponent, joinParts(["end_response", "yield"]));
}
export function renderControlCall(args: ControlCardArgs, theme: Theme, context: CardRenderContext): Component {
    const lines = [joinParts(["mesh_control", args.action])];
    if (context.expanded) lines.push(labeled(theme, "agentId", args.agentId));
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
export function renderStopCall(args: { agentId?: string; taskId?: string; reason?: string }, theme: Theme, context: CardRenderContext): Component {
    const lines = [joinParts(["mesh_stop", args.taskId ? "task" : "agent"])];
    if (context.expanded) { lines.push(labeled(theme, args.taskId ? "taskId" : "agentId", args.taskId ?? args.agentId ?? "missing")); if (args.reason) lines.push(labeled(theme, "reason", previewText(args.reason, 4, 512))); }
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
export function renderReportCall(args: ReportCardArgs, theme: Theme, context: CardRenderContext): Component {
    const lines = ["mesh_report"];
    if (context.expanded) lines.push(labeled(theme, "summary", previewText(args.summary, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)));
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
export function renderAgentToolResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, words?: readonly string[]): Component { return renderAgentResult(result, options, theme, context, words); }
function party(endpointId: unknown, identities: Map<string, AgentDisplayIdentity>, words?: readonly string[]): string | undefined {
    return partyLabelForEndpoint(typeof endpointId === "string" ? endpointId : undefined, identities, words);
}

export function renderSendResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, words?: readonly string[]): Component {
    const disposition = (result.details as { disposition?: unknown } | undefined)?.disposition;
    if (disposition === "intervened") {
        const details = result.details as { agentId?: unknown; taskId?: unknown; sequence?: unknown; messageId?: unknown; deliveryState?: unknown; displayIdentity?: unknown; identities?: unknown; fromEndpointId?: unknown; toEndpointId?: unknown };
        if (typeof details.agentId !== "string" || typeof details.taskId !== "string" || typeof details.sequence !== "number" || typeof details.messageId !== "string") return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
        const identity = identityFor(details.agentId, details.displayIdentity, words);
        const identities = identityMap(details.identities);
        identities.set(details.agentId, identity);
        const from = party(details.fromEndpointId, identities, words);
        const to = party(details.toEndpointId ?? `agent:${details.agentId}`, identities, words);
        const args = argsRecord(context);
        const body = typeof args.message === "string" ? args.message : undefined;
        const extra = options.expanded
            ? [labeled(theme, "agentId", details.agentId), labeled(theme, "taskId", details.taskId), labeled(theme, "messageId", details.messageId)]
            : [];
        return eventCard([directionalBlock(from, to, "follow-up", typeof details.deliveryState === "string" ? details.deliveryState : "pending", body, extra)], theme, options.expanded);
    }
    if (!isSubmitDetails(result.details) || !result.details.task) return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    return renderAgentResult(result, options, theme, context, words);
}
export function renderEndResponseResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext): Component {
    const details = result.details as { kind?: unknown; ended?: unknown; error?: unknown } | undefined;
    if (details?.kind !== "end_response") return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    if (details.error === "standalone_call_required") return textFromComponent(context.lastComponent, joinParts(["end_response", "standalone call required"]));
    if (details.ended !== true) return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    const title = joinParts(["end_response", "yielded"]);
    return textFromComponent(context.lastComponent, options.expanded ? `${title}\nended: true` : title);
}
export function renderControlResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext): Component {
    const details = result.details as { requestId?: unknown; action?: unknown; targets?: unknown } | undefined;
    if (typeof details?.requestId !== "string" || typeof details.action !== "string" || !Array.isArray(details.targets)) return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    const title = joinParts(["mesh_control", details.action, `${details.targets.length} targets`]);
    if (!options.expanded) return textFromComponent(context.lastComponent, title);
    const lines = [title, labeled(theme, "requestId", details.requestId)];
    for (const target of details.targets) {
        const item = target && typeof target === "object" ? target as Record<string, unknown> : {};
        lines.push(labeled(theme, typeof item.agentId === "string" ? item.agentId : "target", typeof item.status === "string" ? item.status : "unknown"));
    }
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
export function renderStopResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, words?: readonly string[]): Component {
    return renderAgentResult(result, options, theme, context, words);
}

export function renderReportResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, words?: readonly string[]): Component {
    const details = result.details as { reportId?: unknown; taskId?: unknown; state?: unknown; displayIdentity?: unknown; identities?: unknown; fromEndpointId?: unknown; toEndpointId?: unknown } | undefined;
    if (typeof details?.reportId !== "string" || typeof details.taskId !== "string" || details.state !== "queued") return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    const identity = isDisplayIdentity(details.displayIdentity) ? details.displayIdentity : undefined;
    const identities = identityMap(details.identities);
    if (identity) identities.set(identity.agentId, identity);
    const from = party(details.fromEndpointId ?? (identity ? `agent:${identity.agentId}` : undefined), identities, words);
    const to = party(details.toEndpointId, identities, words);
    const args = argsRecord(context);
    const body = typeof args.summary === "string" ? args.summary : undefined;
    const extra = options.expanded ? [labeled(theme, "taskId", details.taskId), labeled(theme, "reportId", details.reportId)] : [];
    return eventCard([directionalBlock(from, to, "report", "pending", body, extra)], theme, options.expanded);
}
type CompletionMessage = { customType: string; content: unknown; details?: unknown };
type CompletionCardTask = { taskId: string; agentId: string; state: TaskState };
type CompletionTaskDisplay = { taskId: string; fromEndpointId?: string; toEndpointId?: string; purpose?: string; deliveryState?: string; preview?: string };
type CompletionCardPayload = { tasks: CompletionCardTask[]; pendingTasks: CompletionCardTask[]; identities: Map<string, AgentDisplayIdentity>; display: Map<string, CompletionTaskDisplay> };

function identityMap(value: unknown): Map<string, AgentDisplayIdentity> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return new Map();
    return new Map(Object.entries(value as Record<string, unknown>).flatMap(([agentId, identity]) => isDisplayIdentity(identity) && identity.agentId === agentId ? [[agentId, identity]] : []));
}
function eventIdentity(agentId: string, identities: Map<string, AgentDisplayIdentity>, words?: readonly string[]): AgentDisplayIdentity {
    return identityFor(agentId, identities.get(agentId), words);
}
function eventDetails(message: CompletionMessage): Record<string, unknown> | undefined {
    return message.details && typeof message.details === "object" && !Array.isArray(message.details) ? message.details as Record<string, unknown> : undefined;
}

function completionTasks(value: unknown): CompletionCardTask[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const tasks: CompletionCardTask[] = [];
    for (const task of value) {
        if (!task || typeof task !== "object" || Array.isArray(task)) return undefined;
        const record = task as Record<string, unknown>;
        if (typeof record.taskId !== "string" || typeof record.agentId !== "string" || typeof record.state !== "string") return undefined;
        tasks.push({ taskId: record.taskId, agentId: record.agentId, state: record.state as TaskState });
    }
    return tasks;
}

function completionTaskDisplays(value: unknown): Map<string, CompletionTaskDisplay> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return new Map();
    const record = value as Record<string, unknown>;
    const items = [...(Array.isArray(record.tasks) ? record.tasks : []), ...(Array.isArray(record.pendingTasks) ? record.pendingTasks : [])];
    const display = new Map<string, CompletionTaskDisplay>();
    for (const item of items) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const task = item as Record<string, unknown>;
        if (typeof task.taskId !== "string") continue;
        display.set(task.taskId, {
            taskId: task.taskId,
            ...(typeof task.fromEndpointId === "string" ? { fromEndpointId: task.fromEndpointId } : {}),
            ...(typeof task.toEndpointId === "string" ? { toEndpointId: task.toEndpointId } : {}),
            ...(typeof task.purpose === "string" ? { purpose: task.purpose } : {}),
            ...(typeof task.deliveryState === "string" ? { deliveryState: task.deliveryState } : {}),
            ...(typeof task.preview === "string" ? { preview: task.preview } : {}),
        });
    }
    return display;
}

function completionPayload(message: CompletionMessage): CompletionCardPayload | undefined {
    const details = eventDetails(message);
    const sources = details?.sources;
    const frontier = details?.frontier as Record<string, unknown> | undefined;
    if (details?.kind !== "completion" || !Array.isArray(sources) || !frontier) return undefined;
    const tasks: CompletionCardTask[] = [];
    for (const source of sources) {
        if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
        const sourceTasks = completionTasks((source as Record<string, unknown>).tasks);
        if (!sourceTasks) return undefined;
        tasks.push(...sourceTasks);
    }
    const pendingTasks = completionTasks(frontier.pendingTasks);
    return pendingTasks ? { tasks, pendingTasks, identities: identityMap(details.identities), display: completionTaskDisplays(details.display) } : undefined;
}

function taskStateSummary(tasks: Array<{ state: TaskState }>): string {
    const order: TaskState[] = ["succeeded", "failed", "stopped"];
    const counts = new Map<TaskState, number>();
    for (const task of tasks) counts.set(task.state, (counts.get(task.state) ?? 0) + 1);
    return order.filter(state => counts.has(state)).map(state => `${counts.get(state)} ${state}`).join(" · ") || "0 completed";
}

function completionTaskBlock(task: CompletionCardTask, kind: "completed" | "pending", payload: CompletionCardPayload, theme: Theme, expanded: boolean, words?: readonly string[]): DirectionalBlock {
    const identity = eventIdentity(task.agentId, payload.identities, words);
    payload.identities.set(task.agentId, identity);
    const view = payload.display.get(task.taskId);
    const from = party(`agent:${task.agentId}`, payload.identities, words);
    const to = party(view?.toEndpointId, payload.identities, words);
    const extra = expanded
        ? [labeled(theme, "taskId", task.taskId), labeled(theme, "agentId", task.agentId), labeled(theme, "state", task.state)]
        : [];
    return directionalBlock(from, to, kind, joinParts([view?.purpose, task.state, view?.deliveryState]), view?.preview, extra);
}

function followupMessages(details: Record<string, unknown>, messageIds: string[]): string[] {
    const display = details.display;
    if (!display || typeof display !== "object" || Array.isArray(display)) return [];
    const followups = (display as Record<string, unknown>).followups;
    if (!Array.isArray(followups)) return [];
    const byId = new Map<string, string>();
    for (const item of followups) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const record = item as Record<string, unknown>;
        if (typeof record.messageId === "string" && typeof record.message === "string") byId.set(record.messageId, record.message);
    }
    return messageIds.flatMap(id => {
        const message = byId.get(id);
        return message ? [message] : [];
    });
}

function eventRecord(message: CompletionMessage, kind: string): Record<string, unknown> | undefined {
    const details = eventDetails(message);
    return details?.kind === kind ? details : undefined;
}
function validEventTarget(value: unknown): value is { agentId: string; taskId: string } {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).agentId === "string" && typeof (value as Record<string, unknown>).taskId === "string");
}
function renderInterventionEvent(message: CompletionMessage, _options: { expanded: boolean }, theme: Theme, words?: readonly string[]): DirectionalBlock[] | undefined {
    const details = eventRecord(message, "intervention");
    if (!details) return undefined;
    const payload = details.payload;
    if (!validEventTarget(payload)) return undefined;
    const event = payload as Record<string, unknown>;
    if (typeof event.sequence !== "number") return undefined;
    const identities = identityMap(details.identities);
    const identity = eventIdentity(payload.agentId, identities, words);
    identities.set(payload.agentId, identity);
    const from = party(details.fromEndpointId, identities, words);
    const to = party(details.toEndpointId ?? `agent:${payload.agentId}`, identities, words);
    const body = typeof event.message === "string" ? event.message : undefined;
    const extra = [
        labeled(theme, "agentId", payload.agentId),
        labeled(theme, "taskId", payload.taskId),
        ...(typeof event.messageId === "string" ? [labeled(theme, "messageId", event.messageId)] : []),
        ...(typeof details.eventId === "string" ? [labeled(theme, "eventId", details.eventId)] : []),
    ];
    return [directionalBlock(from, to, "follow-up", typeof details.deliveryState === "string" ? details.deliveryState : undefined, body, extra)];
}
function renderAcknowledgmentEvent(message: CompletionMessage, _options: { expanded: boolean }, theme: Theme, words?: readonly string[]): DirectionalBlock[] | undefined {
    const details = eventRecord(message, "delivery-ack");
    if (!details || !Array.isArray(details.payloads)) return undefined;
    const identities = identityMap(details.identities);
    const blocks: DirectionalBlock[] = [];
    for (const payload of details.payloads) {
        if (!validEventTarget(payload)) return undefined;
        const acknowledgment = payload as Record<string, unknown>;
        if (typeof acknowledgment.acknowledgedThrough !== "number") return undefined;
        const identity = eventIdentity(payload.agentId, identities, words);
        identities.set(payload.agentId, identity);
        const from = party(details.fromEndpointId ?? `agent:${payload.agentId}`, identities, words);
        const to = party(details.toEndpointId, identities, words);
        const messageIds = Array.isArray(acknowledgment.messageIds) ? acknowledgment.messageIds.filter((value): value is string => typeof value === "string") : [];
        const originals = followupMessages(details, messageIds);
        const extra = [
            labeled(theme, "agentId", payload.agentId),
            labeled(theme, "taskId", payload.taskId),
            ...(typeof acknowledgment.ackId === "string" ? [labeled(theme, "ackId", acknowledgment.ackId)] : []),
            ...(messageIds.length ? [labeled(theme, "messageIds", messageIds.join(", "))] : []),
        ];
        const delivery = typeof details.deliveryState === "string" ? details.deliveryState : "acknowledged";
        if (originals.length) for (const original of originals) blocks.push(directionalBlock(from, to, "intake confirmed", delivery, original, extra));
        else blocks.push(directionalBlock(from, to, "intake confirmed", delivery, undefined, extra));
    }
    return blocks.length ? blocks : undefined;
}
function renderReportEvent(message: CompletionMessage, _options: { expanded: boolean }, theme: Theme, words?: readonly string[]): DirectionalBlock[] | undefined {
    const details = eventRecord(message, "report");
    if (!details) return undefined;
    const payload = details.payload;
    if (!validEventTarget(payload)) return undefined;
    const report = payload as Record<string, unknown>;
    if (typeof report.summary !== "string") return undefined;
    const identities = identityMap(details.identities);
    const identity = eventIdentity(payload.agentId, identities, words);
    identities.set(payload.agentId, identity);
    const from = party(details.fromEndpointId ?? `agent:${payload.agentId}`, identities, words);
    const to = party(details.toEndpointId, identities, words);
    const extra = [
        labeled(theme, "agentId", payload.agentId),
        labeled(theme, "taskId", payload.taskId),
        ...(typeof report.reportId === "string" ? [labeled(theme, "reportId", report.reportId)] : []),
        ...(typeof details.eventId === "string" ? [labeled(theme, "eventId", details.eventId)] : []),
    ];
    return [directionalBlock(from, to, "report", typeof details.deliveryState === "string" ? details.deliveryState : undefined, report.summary, extra)];
}

function agentIdFromEventValue(value: unknown, depth = 0): string | undefined {
    if (depth > 4 || !value || typeof value !== "object") return undefined;
    if (Array.isArray(value)) {
        for (const item of value) {
            const agentId = agentIdFromEventValue(item, depth + 1);
            if (agentId) return agentId;
        }
        return undefined;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.agentId === "string") return record.agentId;
    for (const key of ["payload", "payloads", "acknowledgments", "tasks", "pendingTasks", "sources", "frontier"] as const) {
        const agentId = agentIdFromEventValue(record[key], depth + 1);
        if (agentId) return agentId;
    }
    return undefined;
}

function fallbackEventAgentId(message: CompletionMessage): string | undefined {
    return agentIdFromEventValue(message.details);
}

export function renderMeshEventMessage(message: CompletionMessage, options: { expanded: boolean; outputPad?: number }, theme: Theme, words?: readonly string[]): Component {
    const payload = completionPayload(message);
    if (payload) {
        const blocks: DirectionalBlock[] = [{ header: theme.fg("accent", `completion · ${taskStateSummary(payload.tasks)} · ${payload.pendingTasks.length} pending`) }];
        blocks.push(...payload.tasks.map(task => completionTaskBlock(task, "completed", payload, theme, options.expanded, words)));
        blocks.push(...payload.pendingTasks.map(task => completionTaskBlock(task, "pending", payload, theme, options.expanded, words)));
        return eventCard(blocks, theme, options.expanded, options.outputPad ?? 0);
    }
    const intervention = renderInterventionEvent(message, options, theme, words);
    if (intervention) return new ReceivedFullTextCard(intervention, options.expanded, options.outputPad ?? 0);
    const report = renderReportEvent(message, options, theme, words);
    if (report) return new ReceivedFullTextCard(report, options.expanded, options.outputPad ?? 0);
    const event = renderAcknowledgmentEvent(message, options, theme, words);
    if (event) return eventCard(event, theme, options.expanded, options.outputPad ?? 0);
    const agentId = fallbackEventAgentId(message);
    const identity = agentId ? formatCompactAgentIdentity(displayIdentityForAgentId(agentId, words)) : undefined;
    const extra = [
        ...(options.expanded && agentId ? [labeled(theme, "agentId", agentId)] : []),
        ...(options.expanded && typeof message.content === "string" ? [previewText(message.content, 4, 512)] : []),
    ];
    return eventCard([{ header: theme.fg("muted", joinParts([identity, "mesh event · unresolved"])), extra }], theme, options.expanded, options.outputPad ?? 0);
}
