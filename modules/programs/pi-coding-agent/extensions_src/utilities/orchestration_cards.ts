import type { AgentToolResult, Theme, ThemeColor, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import {
    AGENT_STATE_BADGES,
    TASK_STATE_BADGES,
    WAIT_OUTCOME_BADGES,
    agentColorRole,
    assignNatureHandles,
    formatStateBadge,
    formatTaskStateBadge,
    formatWaitOutcomeBadge,
} from "./orchestration_display_tree.ts";
import type { SubmitDetails, WaitDetails } from "./orchestration_projection.ts";
import { MESH_PEER_TOOL_NAMES } from "./orchestration_pi.ts";
import { promptSummary, type AgentSnapshot, type AgentState, type TaskState } from "./orchestration_types.ts";

/** Subset of Pi ToolRenderContext used by mesh cards (not re-exported by the package). */
export type CardRenderContext = {
    args?: object;
    lastComponent: Component | undefined;
    expanded?: boolean;
    isError?: boolean;
};

const COLLAPSED_ERROR_CHARS = 240;
const EXPANDED_TEXT_LINES = 40;
const EXPANDED_TEXT_CHARS = 4_000;
const RAW_PAYLOAD_LINES = 40;
const RAW_PAYLOAD_CHARS = 4_000;

function previewText(value: string, maxLines: number, maxChars: number): string {
    const lines = value.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").split("\n");
    const kept = lines.slice(0, maxLines).join("\n");
    const chars = Array.from(kept);
    if (chars.length <= maxChars && lines.length <= maxLines) return kept;
    return `${chars.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}

function joinParts(parts: Array<string | undefined>): string {
    return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

function textFromComponent(last: Component | undefined, text: string): Text {
    if (last && typeof (last as Text).setText === "function" && typeof (last as Text).render === "function") {
        (last as Text).setText(text);
        return last as Text;
    }
    return new Text(text, 0, 0);
}

function argsRecord(context: CardRenderContext): Record<string, unknown> {
    return context.args as Record<string, unknown> | undefined ?? {};
}

function labeled(theme: Theme, label: string, value: string): string {
    return `${theme.fg("muted", `${label}:`)} ${value}`;
}

function styleBadge(theme: Theme, role: ThemeColor, text: string): string {
    return theme.fg(role, text);
}

function agentStateText(theme: Theme, state: AgentState): string {
    return styleBadge(theme, AGENT_STATE_BADGES[state].role, formatStateBadge(state));
}

function taskStateText(theme: Theme, state: TaskState): string {
    return styleBadge(theme, TASK_STATE_BADGES[state].role, formatTaskStateBadge(state));
}

function waitOutcomeText(theme: Theme, kind: keyof typeof WAIT_OUTCOME_BADGES): string {
    return styleBadge(theme, WAIT_OUTCOME_BADGES[kind].role, formatWaitOutcomeBadge(kind));
}

function agentTypeText(theme: Theme, agent: string): string {
    return theme.fg(agentColorRole(agent), agent);
}

function isRenderableAgentSnapshot(value: unknown): value is AgentSnapshot {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    const agent = record.agent as Record<string, unknown> | undefined;
    const status = record.status as Record<string, unknown> | undefined;
    if (!agent || !status || typeof agent.agentId !== "string" || typeof agent.agent !== "string" || typeof status.state !== "string") return false;
    const task = record.task;
    if (task === undefined || task === null) return true;
    if (typeof task !== "object") return false;
    const taskRecord = task as Record<string, unknown>;
    const request = taskRecord.request as Record<string, unknown> | undefined;
    const taskStatus = taskRecord.status as Record<string, unknown> | undefined;
    return Boolean(request && taskStatus && typeof request.prompt === "string" && typeof taskStatus.state === "string");
}

function isSubmitDetails(value: unknown): value is SubmitDetails {
    return isRenderableAgentSnapshot(value) && Boolean((value as unknown as Record<string, unknown>).accounting);
}

function isWaitDetails(value: unknown): value is WaitDetails {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return (record.condition === "any" || record.condition === "all") && Array.isArray(record.agents);
}

function isTerminalRenderedTask(snapshot: AgentSnapshot): boolean {
    return snapshot.task?.status.state === "succeeded" || snapshot.task?.status.state === "failed" || snapshot.task?.status.state === "stopped";
}

function handleFor(agentId: string, handles?: Map<string, string>, words?: readonly string[]): string {
    return handles?.get(agentId) ?? assignNatureHandles([agentId], words).get(agentId) ?? "agent";
}

function compactAgentLine(theme: Theme, snapshot: AgentSnapshot, handles?: Map<string, string>): string {
    return joinParts([
        theme.bold(handleFor(snapshot.agent.agentId, handles)),
        agentTypeText(theme, snapshot.agent.agent),
        agentStateText(theme, snapshot.status.state),
        snapshot.task ? taskStateText(theme, snapshot.task.status.state) : undefined,
        theme.fg("muted", snapshot.task ? promptSummary(snapshot.task.request.prompt) : "No task"),
    ]);
}

function expandedAgentCard(theme: Theme, snapshot: AgentSnapshot, argsPrompt?: string, handles?: Map<string, string>): string {
    const task = snapshot.task;
    const lines = [
        labeled(theme, "handle", handleFor(snapshot.agent.agentId, handles)),
        labeled(theme, "agentId", snapshot.agent.agentId),
        labeled(theme, "role", agentTypeText(theme, snapshot.agent.agent)),
        labeled(theme, "agentState", agentStateText(theme, snapshot.status.state)),
    ];
    if (task) {
        lines.push(labeled(theme, "taskId", task.request.taskId));
        lines.push(labeled(theme, "taskState", taskStateText(theme, task.status.state)));
        lines.push(labeled(theme, "summary", promptSummary(task.request.prompt)));
        lines.push(labeled(theme, "prompt", previewText(task.request.prompt, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)));
        lines.push(labeled(theme, "createdAt", task.status.createdAt));
        if (task.status.startedAt) lines.push(labeled(theme, "startedAt", task.status.startedAt));
        if (task.status.finishedAt) lines.push(labeled(theme, "finishedAt", task.status.finishedAt));
        if (task.interventions.length > 0) {
            lines.push(labeled(theme, "interventions", String(task.interventions.length)));
            for (const intervention of task.interventions) lines.push(`  #${intervention.sequence} ${intervention.deliveryMode}: ${previewText(intervention.text, 2, 200)}`);
        }
        if (task.result) {
            if (task.result.error) lines.push(labeled(theme, "error", previewText(task.result.error, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)));
            if (task.result.output) lines.push(labeled(theme, "output", previewText(task.result.output, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)));
            lines.push(labeled(theme, "turns", String(task.result.turns)));
            lines.push(labeled(theme, "usage", `${task.result.usage.totalTokens} tokens · $${task.result.usage.cost.total.toFixed(4)}`));
            lines.push(labeled(theme, "resultStartedAt", task.result.startedAt));
            lines.push(labeled(theme, "resultFinishedAt", task.result.finishedAt));
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

function rawText(payload: unknown): string {
    try { return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) ?? String(payload); }
    catch { return String(payload); }
}

function malformedNotice(theme: Theme, expanded: boolean, payload: unknown): string {
    const notice = theme.fg("error", "Malformed mesh result — expand for bounded raw payload");
    return expanded ? `${notice}\n${theme.fg("dim", previewText(rawText(payload), RAW_PAYLOAD_LINES, RAW_PAYLOAD_CHARS))}` : notice;
}

function resultPayload(result: AgentToolResult<unknown>): unknown {
    const content = result.content.map(part => "text" in part ? part.text : "").filter(Boolean).join("\n");
    return result.details ?? content;
}

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
    } catch {
        return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    }
}

function taskCall(operation: string, args: { agent?: string; agentId?: string; prompt: string }, theme: Theme, context: CardRenderContext): Component {
    const target = args.agent !== undefined ? joinParts(["new agent", agentTypeText(theme, args.agent)]) : "reused agent";
    const lines = [`${operation} · ${target}`];
    if (context.expanded) {
        if (args.agentId) lines.push(labeled(theme, "agentId", args.agentId));
        lines.push(labeled(theme, "prompt", previewText(args.prompt, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)));
    }
    return textFromComponent(context.lastComponent, lines.join("\n"));
}

export function renderRunCall(args: { agent?: string; agentId?: string; prompt: string }, theme: Theme, context: CardRenderContext): Component { return taskCall("mesh_run", args, theme, context); }
export function renderSubmitCall(args: { agent?: string; agentId?: string; prompt: string }, theme: Theme, context: CardRenderContext): Component { return taskCall("mesh_submit", args, theme, context); }

export function renderGetCall(args: { agentId?: string; taskId?: string; debug?: boolean }, theme: Theme, context: CardRenderContext): Component {
    const lines = [`mesh_get · ${args.taskId ? "task" : "agent"}${args.debug ? " · DEBUG" : ""}`];
    if (context.expanded) {
        if (args.agentId) lines.push(labeled(theme, "agentId", args.agentId));
        if (args.taskId) lines.push(labeled(theme, "taskId", args.taskId));
    }
    return textFromComponent(context.lastComponent, lines.join("\n"));
}

export function renderWaitCall(args: { taskIds: string[]; condition: "any" | "all" }, theme: Theme, context: CardRenderContext): Component {
    const lines = [`mesh_wait · ${args.condition} · ${args.taskIds.length} tasks`];
    if (context.expanded) lines.push(labeled(theme, "taskIds", args.taskIds.join(", ")));
    return textFromComponent(context.lastComponent, lines.join("\n"));
}

export function renderStopCall(args: { agentId?: string; taskId?: string }, theme: Theme, context: CardRenderContext): Component {
    const lines = [`mesh_stop · ${args.taskId ? "task" : "agent"}`];
    if (context.expanded) lines.push(labeled(theme, args.taskId ? "taskId" : "agentId", args.taskId ?? args.agentId ?? "missing"));
    return textFromComponent(context.lastComponent, lines.join("\n"));
}

export type RouteCardArgs = { action: "watch" | "signal"; receiver: string; delivery: "steer" | "followUp"; taskIds?: string[]; condition?: "any" | "all"; topic?: string; text?: string };
function compactReceiver(receiver: string): string {
    if (receiver === "parent" || receiver === "root") return receiver;
    return Array.from(receiver).length > 12 ? `${Array.from(receiver).slice(0, 8).join("")}…` : receiver;
}
export function renderRouteCall(args: RouteCardArgs, theme: Theme, context: CardRenderContext): Component {
    const receiver = compactReceiver(args.receiver);
    const summary = args.action === "watch"
        ? joinParts(["mesh_route", "watch", receiver, args.delivery, args.condition, `${args.taskIds?.length ?? 0} tasks`])
        : joinParts(["mesh_route", "signal", receiver, args.delivery, args.topic]);
    const lines = [summary];
    if (context.expanded) {
        lines.push(labeled(theme, "receiver", args.receiver));
        if (args.taskIds) lines.push(labeled(theme, "taskIds", args.taskIds.join(", ")));
        if (args.text) lines.push(labeled(theme, "text", previewText(args.text, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)));
    }
    return textFromComponent(context.lastComponent, lines.join("\n"));
}

export function renderEnableCall(_args: object, _theme: Theme, context: CardRenderContext): Component {
    return textFromComponent(context.lastComponent, "mesh_enable · activate all peer tools");
}

export function renderAgentToolResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, _argsPrompt?: string, debug?: boolean, words?: readonly string[]): Component {
    return renderAgentResult(result, options, theme, context, words, undefined, debug);
}

export function renderRunResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, words?: readonly string[]): Component {
    return renderAgentResult(result, options, theme, context, words);
}

export function renderSubmitResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, words?: readonly string[]): Component {
    if (!isSubmitDetails(result.details)) return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    return renderAgentResult(result, options, theme, context, words);
}

export function renderStopResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, words?: readonly string[]): Component {
    const disposition = isRenderableAgentSnapshot(result.details) ? (result.details as unknown as { stopDisposition?: string }).stopDisposition : undefined;
    const target = argsRecord(context).taskId !== undefined ? "task" : "agent";
    const state = disposition === "stopped-now" ? "stopped" : disposition === "stop-pending" ? "cancellation completed" : "already terminal";
    return renderAgentResult(result, options, theme, context, words, `${target} · ${state}`);
}

export function renderWaitResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext, words?: readonly string[]): Component {
    try {
        if (!isWaitDetails(result.details)) throw new Error("invalid wait details");
        const details = result.details;
        const terminal = details.agents.filter(agent => isRenderableAgentSnapshot(agent) && isTerminalRenderedTask(agent)).length;
        const kind = options.isPartial || details.outcome === undefined ? "waiting" : "completed";
        const heading = `${waitOutcomeText(theme, kind)} · ${details.condition} · ${terminal}/${details.agents.length} terminal`;
        const ids = details.agents.flatMap(agent => isRenderableAgentSnapshot(agent) ? [agent.agent.agentId] : []);
        const handles = assignNatureHandles(ids, words);
        const members = details.agents.map(agent => {
            if (!isRenderableAgentSnapshot(agent)) return malformedNotice(theme, options.expanded, agent);
            try { return options.expanded ? expandedAgentCard(theme, agent, undefined, handles) : compactAgentLine(theme, agent, handles); }
            catch { return malformedNotice(theme, options.expanded, agent); }
        });
        return textFromComponent(context.lastComponent, [heading, ...members].join(options.expanded ? "\n\n" : "\n"));
    } catch {
        return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    }
}

function routeDetails(value: unknown): value is { watchId?: string; eventId?: string } {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return typeof record.watchId === "string" || typeof record.eventId === "string";
}

export function renderRouteResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext): Component {
    if (!routeDetails(result.details)) return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    const args = context.args as RouteCardArgs | undefined;
    const action = args?.action ?? (result.details.watchId ? "watch" : "signal");
    const state = action === "watch" ? "accepted" : "queued";
    const lines = [state];
    if (options.expanded) {
        if (args?.receiver) lines.push(labeled(theme, "receiver", args.receiver));
        if (result.details.watchId) lines.push(labeled(theme, "watchId", result.details.watchId));
        if (result.details.eventId) lines.push(labeled(theme, "eventId", result.details.eventId));
        if (args?.taskIds) lines.push(labeled(theme, "taskIds", args.taskIds.join(", ")));
        if (args?.text) lines.push(labeled(theme, "text", previewText(args.text, EXPANDED_TEXT_LINES, EXPANDED_TEXT_CHARS)));
    }
    return textFromComponent(context.lastComponent, lines.join("\n"));
}

export function renderEnableResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme, context: CardRenderContext): Component {
    const details = result.details as { enabled?: unknown; activeTools?: unknown } | undefined;
    if (!details || details.enabled !== true || !Array.isArray(details.activeTools) || !details.activeTools.every(tool => typeof tool === "string")) return textFromComponent(context.lastComponent, resultProblem(result, options, theme, context));
    const active = new Set(details.activeTools as string[]);
    const enabled = MESH_PEER_TOOL_NAMES.filter(tool => active.has(tool)).length;
    const allActive = enabled === MESH_PEER_TOOL_NAMES.length;
    const lines = [allActive ? "all peer tools active" : `peer tools incomplete (${enabled}/${MESH_PEER_TOOL_NAMES.length} active)`];
    if (options.expanded) lines.push(labeled(theme, "activeTools", details.activeTools.join(", ")));
    return textFromComponent(context.lastComponent, lines.join("\n"));
}
