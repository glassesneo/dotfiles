import type { AgentToolResult, Theme, ThemeColor, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import {
    AGENT_STATE_BADGES,
    TASK_STATE_BADGES,
    agentColorRole,
    assignNatureHandles,
    formatStateBadge,
    formatTaskStateBadge,
} from "./orchestration_display_tree.ts";
import type { SubmitDetails } from "./orchestration_projection.ts";
import { MESH_PEER_TOOL_NAMES } from "./orchestration_pi.ts";
import { promptSummary, type AgentSnapshot, type AgentState, type ChannelKey, type TaskState } from "./orchestration_types.ts";

/** Subset of Pi ToolRenderContext used by mesh cards (not re-exported by the package). */
export type CardRenderContext = {
    args?: object;
    lastComponent: Component | undefined;
    expanded?: boolean;
    isError?: boolean;
};

export type SubmitCardArgs = { agent?: string; agentId?: string; profile?: string; prompt: string; channel?: ChannelKey };
export type ChannelCardArgs = { action: "inspect" | "flush"; channel?: ChannelKey };
export type SignalCardArgs = { receiver: string; delivery: "steer" | "followUp"; taskIds?: string[]; topic: string; text: string };
export type ChannelCardTask = { taskId: string; agentId: string; agent: string; agentState: AgentState; state: TaskState };
export type ChannelCardProjection = { channel: ChannelKey; terminal: number; total: number; tasks: ChannelCardTask[] };

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
function handleFor(agentId: string, handles?: Map<string, string>, words?: readonly string[]): string { return handles?.get(agentId) ?? assignNatureHandles([agentId], words).get(agentId) ?? "agent"; }

function compactAgentLine(theme: Theme, snapshot: AgentSnapshot, handles?: Map<string, string>): string {
    const acceptance = snapshot.activity.acceptingTask ? theme.fg("success", "ACCEPTING") : theme.fg("muted", "NOT ACCEPTING");
    return joinParts([
        theme.bold(handleFor(snapshot.agent.agentId, handles)),
        agentTypeText(theme, snapshot.agent.role),
        agentStateText(theme, snapshot.status.state),
        theme.fg("muted", `activity:${snapshot.activity.phase}`),
        acceptance,
        snapshot.task ? taskStateText(theme, snapshot.task.status.state) : undefined,
        theme.fg("muted", snapshot.task ? promptSummary(snapshot.task.request.prompt) : "No task"),
    ]);
}

function expandedAgentCard(theme: Theme, snapshot: AgentSnapshot, argsPrompt?: string, handles?: Map<string, string>): string {
    const task = snapshot.task;
    const lines = [
        labeled(theme, "handle", handleFor(snapshot.agent.agentId, handles)),
        labeled(theme, "agentId", snapshot.agent.agentId),
        labeled(theme, "role", agentTypeText(theme, snapshot.agent.role)),
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
            lines.push(labeled(theme, "turns", String(task.result.turns)), labeled(theme, "usage", `${task.result.usage.totalTokens} tokens · $${task.result.usage.cost.total.toFixed(4)}`), labeled(theme, "resultStartedAt", task.result.startedAt), labeled(theme, "resultFinishedAt", task.result.finishedAt));
        }
        lines.push(labeled(theme, "path", task.directory));
    } else {
        lines.push(labeled(theme, "summary", "No task"));
        if (argsPrompt) lines.push(labeled(theme, "prompt", previewText(argsPrompt, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)));
    }
    if (snapshot.status.childSessionFile) lines.push(labeled(theme, "sessionFile", snapshot.status.childSessionFile));
    lines.push(labeled(theme, "agentUsage", `${snapshot.status.agentUsage.totalTokens} tokens · $${snapshot.status.agentUsage.cost.total.toFixed(4)}`));
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

function renderAgentResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, words?: readonly string[], heading?: string, debug = false): Component {
    try {
        if (!isRenderableAgentSnapshot(result.details)) throw new Error("invalid snapshot");
        const snapshot = result.details;
        const handles = assignNatureHandles([snapshot.agent.agentId], words);
        if (!options.expanded) return textFromComponent(context.lastComponent, [heading, compactAgentLine(theme, snapshot, handles)].filter(Boolean).join("\n"));
        const args = argsRecord(context);
        const prompt = typeof args.prompt === "string" ? args.prompt : undefined;
        const body = expandedAgentCard(theme, snapshot, prompt, handles);
        const debugBody = debug ? `${theme.fg("warning", "DEBUG")}\n${body}\n${labeled(theme, "cwd", snapshot.agent.cwd)}\n${labeled(theme, "tmux", `${snapshot.agent.tmux.sessionName} ${snapshot.agent.tmux.windowId} ${snapshot.agent.tmux.paneId}`)}` : body;
        return textFromComponent(context.lastComponent, [heading, debugBody].filter(Boolean).join("\n"));
    } catch { return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context)); }
}

function submitSelector(args: SubmitCardArgs, theme: Theme): string {
    if (args.agent !== undefined) return `agent ${agentTypeText(theme, args.agent)}`;
    if (args.profile !== undefined) return `profile ${args.profile}`;
    const id = args.agentId ?? "missing";
    return `agentId ${Array.from(id).slice(0, 8).join("")}${Array.from(id).length > 8 ? "…" : ""}`;
}
function routeText(channel: ChannelKey | undefined): string { return channel ? `channel ${channel}` : "direct"; }

export function renderSubmitCall(args: SubmitCardArgs, theme: Theme, context: CardRenderContext): Component {
    const lines = [joinParts(["mesh_submit", submitSelector(args, theme), routeText(args.channel)])];
    if (context.expanded) {
        if (args.agentId) lines.push(labeled(theme, "agentId", args.agentId));
        lines.push(labeled(theme, "prompt", previewText(args.prompt, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)));
    }
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
export function renderGetCall(args: { agentId?: string; taskId?: string; debug?: boolean }, theme: Theme, context: CardRenderContext): Component {
    const lines = [`mesh_get · ${args.taskId ? "task" : "agent"}${args.debug ? " · DEBUG" : ""}`];
    if (context.expanded) { if (args.agentId) lines.push(labeled(theme, "agentId", args.agentId)); if (args.taskId) lines.push(labeled(theme, "taskId", args.taskId)); }
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
export function renderStopCall(args: { agentId?: string; taskId?: string; reason?: string }, theme: Theme, context: CardRenderContext): Component {
    const lines = [`mesh_stop · ${args.taskId ? "task" : "agent"}`];
    if (context.expanded) { lines.push(labeled(theme, args.taskId ? "taskId" : "agentId", args.taskId ?? args.agentId ?? "missing")); if (args.reason) lines.push(labeled(theme, "reason", previewText(args.reason, 4, 512))); }
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
export function renderChannelCall(args: ChannelCardArgs, theme: Theme, context: CardRenderContext): Component {
    const lines = [joinParts(["mesh_channel", args.action, args.channel ? `channel ${args.channel}` : "active channels"])];
    if (context.expanded && args.channel) lines.push(labeled(theme, "channel", args.channel));
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
function compactReceiver(receiver: string): string { return receiver === "parent" || receiver === "root" ? receiver : Array.from(receiver).length > 12 ? `${Array.from(receiver).slice(0, 8).join("")}…` : receiver; }
export function renderSignalCall(args: SignalCardArgs, theme: Theme, context: CardRenderContext): Component {
    const lines = [joinParts(["mesh_signal", compactReceiver(args.receiver), args.delivery, args.topic])];
    if (context.expanded) {
        lines.push(labeled(theme, "receiver", args.receiver));
        if (args.taskIds) lines.push(labeled(theme, "taskIds", args.taskIds.join(", ")));
        lines.push(labeled(theme, "text", previewText(args.text, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)));
    }
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
export function renderEnableCall(_args: object, _theme: Theme, context: CardRenderContext): Component { return textFromComponent(context.lastComponent, "mesh_enable · activate all peer tools"); }

export function renderAgentToolResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, _argsPrompt?: string, debug?: boolean, words?: readonly string[]): Component { return renderAgentResult(result, options, theme, context, words, undefined, debug); }
export function renderSubmitResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, words?: readonly string[]): Component {
    if (!isSubmitDetails(result.details) || !result.details.task) return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    const completion = result.details.task.request.completion;
    const route = completion?.mode === "channel" ? `channel ${completion.channel}` : "direct";
    const heading = joinParts(["mesh_submit", route, `agent ${result.details.status.state}`, `task ${result.details.task.status.state}`]);
    return renderAgentResult(result, options, theme, context, words, heading);
}
export function renderStopResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, words?: readonly string[]): Component {
    const snapshot = isRenderableAgentSnapshot(result.details) ? result.details : undefined;
    const disposition = snapshot ? (snapshot as unknown as { stopDisposition?: string }).stopDisposition : undefined;
    const target = argsRecord(context).taskId !== undefined ? "task" : "agent";
    const state = target === "task"
        ? disposition === "stopped-now" ? "stopped" : disposition === "stop-pending" ? "cancellation completed" : "already terminal"
        : snapshot?.stop?.state === "confirmed" ? "stopped" : disposition === "stop-pending" && (snapshot?.stop?.state === "requested" || snapshot?.stop?.state === "terminating" || snapshot?.status.state === "stopping") ? "stop pending" : disposition === "stopped-now" ? "stopped" : "already terminal";
    return renderAgentResult(result, options, theme, context, words, `${target} · ${state}`);
}

function isChannelTask(value: unknown): value is ChannelCardTask {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return typeof item.taskId === "string" && typeof item.agentId === "string" && typeof item.agent === "string" && typeof item.agentState === "string" && typeof item.state === "string";
}
function isChannelProjection(value: unknown): value is ChannelCardProjection {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return typeof item.channel === "string" && typeof item.terminal === "number" && typeof item.total === "number" && Array.isArray(item.tasks) && item.tasks.every(isChannelTask);
}
function channelTaskLine(theme: Theme, task: ChannelCardTask, expanded: boolean): string {
    const compact = joinParts([agentTypeText(theme, task.agent), `task ${taskStateText(theme, task.state)}`, `agent ${agentStateText(theme, task.agentState)}`]);
    return expanded ? `${compact}\n  ${labeled(theme, "taskId", task.taskId)}\n  ${labeled(theme, "agentId", task.agentId)}` : compact;
}
export function renderChannelResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext): Component {
    const details = result.details as Record<string, unknown> | undefined;
    let channels: ChannelCardProjection[] | undefined;
    if (details && Array.isArray(details.channels) && details.channels.every(isChannelProjection)) channels = details.channels;
    else if (details && isChannelProjection(details.channelResult)) channels = [details.channelResult];
    if (!channels) return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    const lines = channels.length ? channels.flatMap(channel => [
        `channel ${channel.channel} · ${channel.terminal}/${channel.total} terminal`,
        ...channel.tasks.map(task => channelTaskLine(theme, task, options.expanded)),
    ]) : ["no active channels"];
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
export function renderSignalResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext): Component {
    const details = result.details as { eventId?: unknown } | undefined;
    if (typeof details?.eventId !== "string") return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    const lines = ["signal queued"];
    const args = context.args as SignalCardArgs | undefined;
    if (options.expanded) { if (args?.receiver) lines.push(labeled(theme, "receiver", args.receiver)); lines.push(labeled(theme, "eventId", details.eventId)); }
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
export function renderEnableResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext): Component {
    const details = result.details as { enabled?: unknown; activeTools?: unknown } | undefined;
    if (!details || details.enabled !== true || !Array.isArray(details.activeTools) || !details.activeTools.every(tool => typeof tool === "string")) return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    const active = new Set(details.activeTools as string[]);
    const enabled = MESH_PEER_TOOL_NAMES.filter(tool => active.has(tool)).length;
    const lines = [enabled === MESH_PEER_TOOL_NAMES.length ? "all peer tools active" : `peer tools incomplete (${enabled}/${MESH_PEER_TOOL_NAMES.length} active)`];
    if (options.expanded) lines.push(labeled(theme, "activeTools", details.activeTools.join(", ")));
    return textFromComponent(context.lastComponent, lines.join("\n"));
}

type CompletionMessage = { customType: string; content: unknown; details?: unknown };
function completionPayload(message: CompletionMessage): { route: "direct" | "channel"; channel?: string; tasks: Array<{ taskId: string; state: TaskState; createdAt?: string; startedAt?: string; finishedAt?: string }> } | undefined {
    const details = message.details as Record<string, unknown> | undefined;
    const payload = details?.payload as Record<string, unknown> | undefined;
    if (details?.kind !== "completion" || !payload || payload.route !== "direct" && payload.route !== "channel" || !Array.isArray(payload.tasks)) return undefined;
    const tasks = payload.tasks.filter((task): task is { taskId: string; state: TaskState; createdAt?: string; startedAt?: string; finishedAt?: string } => {
        if (!task || typeof task !== "object") return false;
        const record = task as Record<string, unknown>;
        return typeof record.taskId === "string" && typeof record.state === "string";
    });
    if (tasks.length !== payload.tasks.length) return undefined;
    return { route: payload.route, ...(typeof payload.channel === "string" ? { channel: payload.channel } : {}), tasks };
}
function taskStateSummary(tasks: Array<{ state: TaskState }>): string {
    const order: TaskState[] = ["succeeded", "failed", "stopped", "running", "created"];
    const counts = new Map<TaskState, number>();
    for (const task of tasks) counts.set(task.state, (counts.get(task.state) ?? 0) + 1);
    return order.filter(state => counts.has(state)).map(state => `${counts.get(state)} ${state}`).join(" · ") || "0 tasks";
}
export function renderMeshEventMessage(message: CompletionMessage, options: { expanded: boolean; outputPad?: number }, theme: Theme): Component {
    const payload = completionPayload(message);
    if (!payload) return new WidthSafeText(theme.fg("muted", typeof message.content === "string" ? message.content : "mesh event"), options.outputPad ?? 0);
    const route = payload.route === "channel" ? `channel ${payload.channel ?? "?"} completion` : "direct completion";
    const lines = [theme.fg("accent", `${route} · ${taskStateSummary(payload.tasks)}`)];
    if (options.expanded) for (const task of payload.tasks) lines.push(joinParts([`taskId: ${task.taskId}`, `state: ${task.state}`, task.finishedAt ? `finishedAt: ${task.finishedAt}` : undefined]));
    return new WidthSafeText(lines.join("\n"), options.outputPad ?? 0);
}
