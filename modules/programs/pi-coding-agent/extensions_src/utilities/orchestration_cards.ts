import type { AgentToolResult, Theme, ThemeColor, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
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
    formatCompactAgentIdentity,
    type AgentDisplayIdentity,
} from "./orchestration_identity.ts";
import type { SubmitDetails } from "./orchestration_projection.ts";
import { promptSummary, type AgentSnapshot, type AgentState, type TaskState } from "./orchestration_types.ts";

/** Subset of Pi ToolRenderContext used by mesh cards (not re-exported by the package). */
export type CardRenderContext = {
    args?: object;
    lastComponent: Component | undefined;
    expanded?: boolean;
    isError?: boolean;
};

export type SendCardArgs = { agent?: string; agentId?: string; profile?: string; message: string };
export type WaitCardArgs = { taskIds: string[] };
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
    if (!agent || !status || typeof agent.agentId !== "string" || typeof agent.role !== "string" || typeof status.state !== "string") return false;
    const task = record.task;
    if (task === undefined || task === null) return true;
    if (typeof task !== "object") return false;
    const taskRecord = task as Record<string, unknown>;
    const request = taskRecord.request as Record<string, unknown> | undefined;
    const taskStatus = taskRecord.status as Record<string, unknown> | undefined;
    return Boolean(request && taskStatus && typeof request.prompt === "string" && typeof taskStatus.state === "string");
}
function isSubmitDetails(value: unknown): value is SubmitDetails { return isRenderableAgentSnapshot(value) && Boolean((value as unknown as Record<string, unknown>).accounting); }
function isDisplayIdentity(value: unknown): value is AgentDisplayIdentity {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return typeof record.agentId === "string" && typeof record.handle === "string"
        && (record.role === undefined || typeof record.role === "string")
        && (record.profile === undefined || typeof record.profile === "string")
        && (record.roleDescription === undefined || typeof record.roleDescription === "string")
        && (record.model === undefined || typeof record.model === "string")
        && (record.thinkingLevel === undefined || typeof record.thinkingLevel === "string")
        && (record.harness === undefined || typeof record.harness === "string");
}
function identityFor(agentId: string, value?: unknown, words?: readonly string[]): AgentDisplayIdentity {
    return isDisplayIdentity(value) && value.agentId === agentId ? value : displayIdentityForAgentId(agentId, words);
}
function compactAgentLine(theme: Theme, snapshot: AgentSnapshot, words?: readonly string[]): string {
    const acceptance = snapshot.activity.acceptingTask ? theme.fg("success", "ACCEPTING") : theme.fg("muted", "NOT ACCEPTING");
    return joinParts([
        theme.bold(formatCompactAgentIdentity(displayIdentityForSnapshot(snapshot, words))),
        agentStateText(theme, snapshot.status.state),
        theme.fg("muted", `activity:${snapshot.activity.phase}`),
        acceptance,
        snapshot.task ? taskStateText(theme, snapshot.task.status.state) : undefined,
        theme.fg("muted", snapshot.task ? promptSummary(snapshot.task.request.prompt) : "No task"),
    ]);
}

function expandedAgentCard(theme: Theme, snapshot: AgentSnapshot, argsPrompt?: string, words?: readonly string[]): string {
    const task = snapshot.task;
    const identity = displayIdentityForSnapshot(snapshot, words);
    const lines = [
        labeled(theme, "handle", identity.handle),
        labeled(theme, "agentId", snapshot.agent.agentId),
        labeled(theme, "role", agentTypeText(theme, identity.role ?? "unresolved")),
        labeled(theme, "roleDescription", identity.roleDescription ?? "unavailable"),
        labeled(theme, "profile", identity.profile ?? "unresolved"),
        labeled(theme, "model", identity.model ?? "unavailable"),
        labeled(theme, "thinking", identity.thinkingLevel ?? "unavailable"),
        labeled(theme, "harness", identity.harness ?? "unavailable"),
        labeled(theme, "agentState", agentStateText(theme, snapshot.status.state)),
        labeled(theme, "activity", snapshot.activity.phase),
        labeled(theme, "acceptingTask", String(snapshot.activity.acceptingTask)),
        labeled(theme, "pendingMessages", snapshot.activity.pendingMessages === null ? "unknown" : String(snapshot.activity.pendingMessages)),
        labeled(theme, "contextHealth", snapshot.activity.context.health),
    ];
    if (snapshot.stop) {
        lines.push(labeled(theme, "stopState", snapshot.stop.state), labeled(theme, "stopSource", snapshot.stop.source), labeled(theme, "stopReason", previewText(snapshot.stop.reason, 4, 512)));
    }
    if (task) {
        lines.push(labeled(theme, "taskId", task.request.taskId), labeled(theme, "taskState", taskStateText(theme, task.status.state)), labeled(theme, "summary", promptSummary(task.request.prompt)), labeled(theme, "prompt", previewText(task.request.prompt, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)), labeled(theme, "createdAt", task.status.createdAt));
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
        if (!options.expanded) return textFromComponent(context.lastComponent, compactAgentLine(theme, snapshot, words));
        const args = argsRecord(context);
        const message = typeof args.message === "string" ? args.message : undefined;
        return textFromComponent(context.lastComponent, expandedAgentCard(theme, snapshot, message, words));
    } catch { return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context)); }
}

export function renderSendCall(args: SendCardArgs, theme: Theme, context: CardRenderContext): Component {
    const lines = [joinParts(["mesh_send", args.agentId !== undefined ? "existing agent" : "new agent"])];
    if (context.expanded) {
        if (args.agent) lines.push(labeled(theme, "requestedRole", agentTypeText(theme, args.agent)));
        if (args.profile) lines.push(labeled(theme, "requestedProfile", args.profile));
        if (args.agentId !== undefined) lines.push(labeled(theme, "agentId", args.agentId));
        lines.push(labeled(theme, "message", previewText(args.message, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)));
    }
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
export function renderGetCall(args: { taskId: string }, theme: Theme, context: CardRenderContext): Component {
    const lines = [joinParts(["mesh_get", "task"])];
    if (context.expanded) lines.push(labeled(theme, "taskId", args.taskId));
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
export function renderWaitCall(args: WaitCardArgs, theme: Theme, context: CardRenderContext): Component {
    const lines = [joinParts(["mesh_wait", `all ${args.taskIds.length} tasks`])];
    if (context.expanded) lines.push(labeled(theme, "taskIds", args.taskIds.join(", ")));
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
export function renderSendResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, words?: readonly string[]): Component {
    const disposition = (result.details as { disposition?: unknown } | undefined)?.disposition;
    if (disposition === "intervened") {
        const details = result.details as { agentId?: unknown; taskId?: unknown; sequence?: unknown; messageId?: unknown; deliveryState?: unknown; displayIdentity?: unknown };
        if (typeof details.agentId !== "string" || typeof details.taskId !== "string" || typeof details.sequence !== "number" || typeof details.messageId !== "string") return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
        const identity = identityFor(details.agentId, details.displayIdentity, words);
        const lines = [joinParts([formatCompactAgentIdentity(identity), "follow-up queued", `#${details.sequence}`])];
        if (options.expanded) {
            const args = argsRecord(context);
            lines.push(labeled(theme, "agentId", details.agentId), labeled(theme, "taskId", details.taskId), labeled(theme, "messageId", details.messageId), labeled(theme, "deliveryState", typeof details.deliveryState === "string" ? details.deliveryState : "unavailable"));
            if (typeof args.message === "string") lines.push(labeled(theme, "followUp", previewText(args.message, 4, 512)));
        }
        return textFromComponent(context.lastComponent, lines.join("\n"));
    }
    if (!isSubmitDetails(result.details) || !result.details.task) return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    return renderAgentResult(result, options, theme, context, words);
}
export function renderWaitResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, words?: readonly string[]): Component {
    const details = result.details as { tasks?: unknown } | undefined;
    if (!Array.isArray(details?.tasks) || !details.tasks.every(isRenderableAgentSnapshot)) return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    const snapshots = details.tasks as AgentSnapshot[];
    const lines = options.expanded
        ? snapshots.flatMap((snapshot, index) => [...(index > 0 ? [""] : []), expandedAgentCard(theme, snapshot, undefined, words)])
        : snapshots.map(snapshot => compactAgentLine(theme, snapshot, words));
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
export function renderStopResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, words?: readonly string[]): Component {
    return renderAgentResult(result, options, theme, context, words);
}

export function renderReportResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext): Component {
    const details = result.details as { reportId?: unknown; taskId?: unknown; state?: unknown; displayIdentity?: unknown } | undefined;
    if (typeof details?.reportId !== "string" || typeof details.taskId !== "string" || details.state !== "queued") return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    const identity = isDisplayIdentity(details.displayIdentity) ? details.displayIdentity : undefined;
    const lines = [identity ? joinParts([formatCompactAgentIdentity(identity), "report queued"]) : "report queued"];
    if (options.expanded) lines.push(labeled(theme, "taskId", details.taskId), labeled(theme, "reportId", details.reportId));
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
type CompletionMessage = { customType: string; content: unknown; details?: unknown };
type CompletionCardTask = { taskId: string; agentId: string; state: TaskState };
type CompletionCardPayload = { tasks: CompletionCardTask[]; pendingTasks: CompletionCardTask[]; identities: Map<string, AgentDisplayIdentity> };

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
    return pendingTasks ? { tasks, pendingTasks, identities: identityMap(details.identities) } : undefined;
}

function taskStateSummary(tasks: Array<{ state: TaskState }>): string {
    const order: TaskState[] = ["succeeded", "failed", "stopped"];
    const counts = new Map<TaskState, number>();
    for (const task of tasks) counts.set(task.state, (counts.get(task.state) ?? 0) + 1);
    return order.filter(state => counts.has(state)).map(state => `${counts.get(state)} ${state}`).join(" · ") || "0 completed";
}

function completionTaskLine(task: CompletionCardTask, kind: "completed" | "pending", identities: Map<string, AgentDisplayIdentity>, expanded: boolean, words?: readonly string[]): string {
    const identity = eventIdentity(task.agentId, identities, words);
    return expanded
        ? joinParts([kind, formatCompactAgentIdentity(identity), `taskId:${task.taskId}`, `agentId:${task.agentId}`, `state:${task.state}`])
        : joinParts([kind, formatCompactAgentIdentity(identity), `state:${task.state}`]);
}
function eventRecord(message: CompletionMessage, kind: string): Record<string, unknown> | undefined {
    const details = eventDetails(message);
    return details?.kind === kind ? details : undefined;
}
function validEventTarget(value: unknown): value is { agentId: string; taskId: string } {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).agentId === "string" && typeof (value as Record<string, unknown>).taskId === "string");
}
function renderInterventionEvent(message: CompletionMessage, options: { expanded: boolean }, theme: Theme, words?: readonly string[]): string | undefined {
    const details = eventRecord(message, "intervention");
    if (!details) return undefined;
    const payload = details.payload;
    if (!validEventTarget(payload)) return undefined;
    const event = payload as Record<string, unknown>;
    if (typeof event.sequence !== "number") return undefined;
    const identity = eventIdentity(payload.agentId, identityMap(details.identities), words);
    const lines = [joinParts([formatCompactAgentIdentity(identity), "follow-up received", `#${event.sequence}`])];
    if (options.expanded) {
        lines.push(labeled(theme, "agentId", payload.agentId), labeled(theme, "taskId", payload.taskId));
        if (typeof event.messageId === "string") lines.push(labeled(theme, "messageId", event.messageId));
        if (typeof details.eventId === "string") lines.push(labeled(theme, "eventId", details.eventId));
        if (typeof event.message === "string") lines.push(labeled(theme, "followUp", previewText(event.message, 4, 512)));
    }
    return lines.join("\n");
}
function renderAcknowledgmentEvent(message: CompletionMessage, options: { expanded: boolean }, theme: Theme, words?: readonly string[]): string | undefined {
    const details = eventRecord(message, "delivery-ack");
    if (!details || !Array.isArray(details.payloads)) return undefined;
    const identities = identityMap(details.identities); const lines: string[] = [];
    for (const payload of details.payloads) {
        if (!validEventTarget(payload)) return undefined;
        const acknowledgment = payload as Record<string, unknown>;
        if (typeof acknowledgment.acknowledgedThrough !== "number") return undefined;
        lines.push(joinParts([formatCompactAgentIdentity(eventIdentity(payload.agentId, identities, words)), `follow-up acknowledged through #${acknowledgment.acknowledgedThrough}`]));
        if (options.expanded) {
            lines.push(labeled(theme, "agentId", payload.agentId), labeled(theme, "taskId", payload.taskId));
            if (typeof acknowledgment.ackId === "string") lines.push(labeled(theme, "ackId", acknowledgment.ackId));
            if (Array.isArray(acknowledgment.messageIds)) lines.push(labeled(theme, "messageIds", acknowledgment.messageIds.filter((value): value is string => typeof value === "string").join(", ")));
        }
    }
    return lines.length ? lines.join("\n") : undefined;
}
function renderReportEvent(message: CompletionMessage, options: { expanded: boolean }, theme: Theme, words?: readonly string[]): string | undefined {
    const details = eventRecord(message, "report");
    if (!details) return undefined;
    const payload = details.payload;
    if (!validEventTarget(payload)) return undefined;
    const report = payload as Record<string, unknown>;
    if (typeof report.summary !== "string") return undefined;
    const identity = eventIdentity(payload.agentId, identityMap(details.identities), words);
    const lines = [joinParts([formatCompactAgentIdentity(identity), "report", previewText(report.summary, 2, 320)])];
    if (options.expanded) {
        lines.push(labeled(theme, "agentId", payload.agentId), labeled(theme, "taskId", payload.taskId));
        if (typeof report.reportId === "string") lines.push(labeled(theme, "reportId", report.reportId));
        if (typeof details.eventId === "string") lines.push(labeled(theme, "eventId", details.eventId));
        lines.push(labeled(theme, "summary", previewText(report.summary, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)));
    }
    return lines.join("\n");
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
    const fromDetails = agentIdFromEventValue(message.details);
    if (fromDetails || typeof message.content !== "string") return fromDetails;
    const jsonText = message.content.includes("\n") ? message.content.slice(message.content.indexOf("\n") + 1) : message.content;
    try { return agentIdFromEventValue(JSON.parse(jsonText)); }
    catch { return undefined; }
}

export function renderMeshEventMessage(message: CompletionMessage, options: { expanded: boolean; outputPad?: number }, theme: Theme, words?: readonly string[]): Component {
    const payload = completionPayload(message);
    if (payload) {
        const lines = [theme.fg("accent", `completion · ${taskStateSummary(payload.tasks)} · ${payload.pendingTasks.length} pending`)];
        lines.push(...payload.tasks.map(task => completionTaskLine(task, "completed", payload.identities, options.expanded, words)));
        lines.push(...payload.pendingTasks.map(task => completionTaskLine(task, "pending", payload.identities, options.expanded, words)));
        return new WidthSafeText(lines.join("\n"), options.outputPad ?? 0);
    }
    const event = renderInterventionEvent(message, options, theme, words) ?? renderAcknowledgmentEvent(message, options, theme, words) ?? renderReportEvent(message, options, theme, words);
    if (event) return new WidthSafeText(event, options.outputPad ?? 0);
    const agentId = fallbackEventAgentId(message);
    const identity = agentId ? formatCompactAgentIdentity(displayIdentityForAgentId(agentId, words)) : undefined;
    const lines = [joinParts([identity, "mesh event · unresolved"])];
    if (options.expanded && agentId) lines.push(labeled(theme, "agentId", agentId));
    if (options.expanded && typeof message.content === "string") lines.push(previewText(message.content, 4, 512));
    return new WidthSafeText(theme.fg("muted", lines.join("\n")), options.outputPad ?? 0);
}
