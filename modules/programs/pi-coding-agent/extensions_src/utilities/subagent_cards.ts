import type { AgentToolResult, Theme, ThemeColor, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import {
    AGENT_STATE_BADGES,
    TASK_STATE_BADGES,
    WAIT_OUTCOME_BADGES,
    assignNatureHandles,
    formatStateBadge,
    formatTaskStateBadge,
    formatWaitOutcomeBadge,
    profileColorRole,
} from "./subagent_display_tree.ts";
import type { SubmitDetails, WaitDetails } from "./subagent_projection.ts";
import type { AgentSnapshot, AgentState, TaskState } from "./subagent_types.ts";

/** Subset of Pi ToolRenderContext used by subagent cards (not re-exported by the package). */
export type CardRenderContext = {
    args?: Record<string, unknown>;
    lastComponent: Component | undefined;
    expanded?: boolean;
};

const COLLAPSED_PROMPT_LINES = 2;
const COLLAPSED_PROMPT_CHARS = 240;
const COLLAPSED_OUTPUT_LINES = 3;
const COLLAPSED_OUTPUT_CHARS = 360;
const EXPANDED_OUTPUT_LINES = 40;
const EXPANDED_OUTPUT_CHARS = 4_000;

function shortId(id: string): string {
    return id.slice(0, 8);
}

function previewText(value: string, maxLines: number, maxChars: number): string {
    const lines = value.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").split("\n");
    const kept = lines.slice(0, maxLines).join("\n");
    const chars = Array.from(kept);
    if (chars.length <= maxChars && lines.length <= maxLines) return kept;
    return `${chars.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}

function joinParts(parts: Array<string | undefined>): string {
    return parts.filter((part): part is string => Boolean(part && part.length > 0)).join(" · ");
}

function textFromComponent(last: Component | undefined, text: string): Text {
    if (last && typeof (last as Text).setText === "function" && typeof (last as Text).render === "function") {
        (last as Text).setText(text);
        return last as Text;
    }
    // Outer ToolExecution Box owns padding; avoid doubling default Text padding.
    return new Text(text, 0, 0);
}

function handleFor(agentId: string, handles?: Map<string, string>, words?: readonly string[]): string {
    return handles?.get(agentId) ?? assignNatureHandles([agentId], words).get(agentId) ?? shortId(agentId);
}

function styleBadge(theme: Theme, role: ThemeColor, text: string): string {
    return theme.fg(role, text);
}

function agentStateText(theme: Theme, state: AgentState): string {
    const badge = AGENT_STATE_BADGES[state];
    return styleBadge(theme, badge.role, formatStateBadge(state));
}

function taskStateText(theme: Theme, state: TaskState): string {
    const badge = TASK_STATE_BADGES[state];
    return styleBadge(theme, badge.role, formatTaskStateBadge(state));
}

function waitOutcomeText(theme: Theme, kind: keyof typeof WAIT_OUTCOME_BADGES): string {
    const badge = WAIT_OUTCOME_BADGES[kind];
    return styleBadge(theme, badge.role, formatWaitOutcomeBadge(kind));
}

function profileText(theme: Theme, profile: string): string {
    return theme.fg(profileColorRole(profile), profile);
}

function isAgentSnapshot(value: unknown): value is AgentSnapshot {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    const agent = record.agent;
    const status = record.status;
    return Boolean(
        agent && typeof agent === "object"
        && status && typeof status === "object"
        && typeof (agent as { agentId?: unknown }).agentId === "string"
        && typeof (status as { state?: unknown }).state === "string",
    );
}

/** Accept only snapshots whose nested task shape is safe to render. */
function isRenderableAgentSnapshot(value: unknown): value is AgentSnapshot {
    if (!isAgentSnapshot(value)) return false;
    const task = (value as { task?: unknown }).task;
    if (task === undefined || task === null) return true;
    if (typeof task !== "object") return false;
    const record = task as Record<string, unknown>;
    const request = record.request;
    const status = record.status;
    if (!request || typeof request !== "object") return false;
    if (!status || typeof status !== "object") return false;
    if (typeof (request as { purpose?: unknown }).purpose !== "string") return false;
    if (typeof (status as { state?: unknown }).state !== "string") return false;
    return true;
}

function isTerminalRenderedTask(snapshot: AgentSnapshot): boolean {
    const state = snapshot.task?.status.state;
    return state === "succeeded" || state === "failed" || state === "stopped";
}

function isWaitDetails(value: unknown): value is WaitDetails {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return (record.condition === "any" || record.condition === "all")
        && typeof record.timeoutSeconds === "number"
        && Array.isArray(record.agents);
}

function isSubmitDetails(value: unknown): value is SubmitDetails {
    if (!isRenderableAgentSnapshot(value)) return false;
    const record = value as unknown as Record<string, unknown>;
    const outcome = record.waitOutcome;
    return Boolean(record.accounting && typeof record.accounting === "object")
        && (record.waitSeconds === undefined || typeof record.waitSeconds === "number")
        && (outcome === undefined || outcome === "completed" || outcome === "timeout");
}

function snapshotPrompt(snapshot: AgentSnapshot, argsPrompt?: string): string | undefined {
    return snapshot.task?.request.prompt ?? argsPrompt;
}

function collapsedAgentCard(theme: Theme, snapshot: AgentSnapshot, argsPrompt?: string, handles?: Map<string, string>): string {
    const handle = theme.bold(handleFor(snapshot.agent.agentId, handles));
    const profile = profileText(theme, snapshot.agent.profile);
    const agentState = agentStateText(theme, snapshot.status.state);
    const taskState = snapshot.task ? taskStateText(theme, snapshot.task.status.state) : undefined;
    const line1 = joinParts([handle, profile, agentState, taskState]);
    const purpose = snapshot.task?.request.purpose ?? snapshot.agent.purpose;
    const prompt = snapshotPrompt(snapshot, argsPrompt);
    const lines = [line1, theme.fg("muted", purpose)];
    if (prompt) lines.push(theme.fg("dim", previewText(prompt, COLLAPSED_PROMPT_LINES, COLLAPSED_PROMPT_CHARS)));
    const result = snapshot.task?.result;
    if (result && snapshot.task && (snapshot.task.status.state === "succeeded" || snapshot.task.status.state === "failed" || snapshot.task.status.state === "stopped")) {
        if (result.error) lines.push(theme.fg("error", previewText(result.error, COLLAPSED_OUTPUT_LINES, COLLAPSED_OUTPUT_CHARS)));
        else if (result.output) lines.push(theme.fg("dim", previewText(result.output, COLLAPSED_OUTPUT_LINES, COLLAPSED_OUTPUT_CHARS)));
    }
    return lines.join("\n");
}

function labeled(theme: Theme, label: string, value: string): string {
    return `${theme.fg("muted", `${label}:`)} ${value}`;
}

function expandedAgentCard(theme: Theme, snapshot: AgentSnapshot, argsPrompt?: string, handles?: Map<string, string>): string {
    const task = snapshot.task;
    const prompt = snapshotPrompt(snapshot, argsPrompt) ?? "";
    const lines = [
        labeled(theme, "handle", handleFor(snapshot.agent.agentId, handles)),
        labeled(theme, "agentId", snapshot.agent.agentId),
        labeled(theme, "profile", profileText(theme, snapshot.agent.profile)),
        labeled(theme, "agentState", agentStateText(theme, snapshot.status.state)),
        labeled(theme, "purpose", task?.request.purpose ?? snapshot.agent.purpose),
    ];
    if (task) {
        lines.push(labeled(theme, "taskId", task.request.taskId));
        lines.push(labeled(theme, "taskState", taskStateText(theme, task.status.state)));
        lines.push(labeled(theme, "prompt", prompt));
        lines.push(labeled(theme, "createdAt", task.status.createdAt));
        if (task.status.startedAt) lines.push(labeled(theme, "startedAt", task.status.startedAt));
        if (task.status.finishedAt) lines.push(labeled(theme, "finishedAt", task.status.finishedAt));
        if (task.interventions.length > 0) {
            lines.push(labeled(theme, "interventions", String(task.interventions.length)));
            for (const intervention of task.interventions) {
                lines.push(`  ${theme.fg("dim", `#${intervention.sequence} ${intervention.deliveryMode}: ${previewText(intervention.text, 2, 200)}`)}`);
            }
        }
        if (task.result) {
            if (task.result.error) lines.push(labeled(theme, "error", previewText(task.result.error, EXPANDED_OUTPUT_LINES, EXPANDED_OUTPUT_CHARS)));
            if (task.result.output) lines.push(labeled(theme, "output", previewText(task.result.output, EXPANDED_OUTPUT_LINES, EXPANDED_OUTPUT_CHARS)));
            lines.push(labeled(theme, "usage", `${task.result.usage.totalTokens} tokens · $${task.result.usage.cost.total.toFixed(4)}`));
            lines.push(labeled(theme, "turns", String(task.result.turns)));
        }
        lines.push(labeled(theme, "path", task.directory));
    } else {
        if (prompt) lines.push(labeled(theme, "prompt", prompt));
    }
    if (snapshot.status.childSessionFile) lines.push(labeled(theme, "sessionFile", snapshot.status.childSessionFile));
    lines.push(labeled(theme, "agentUsage", `${snapshot.status.agentUsage.totalTokens} tokens · $${snapshot.status.agentUsage.cost.total.toFixed(4)}`));
    return lines.join("\n");
}

function legacyNotice(theme: Theme, expanded: boolean, payload: unknown): string {
    const notice = theme.fg("warning", "Legacy subagent result — expand for raw payload");
    if (!expanded) return notice;
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    return `${notice}\n${theme.fg("dim", raw ?? String(payload))}`;
}

function malformedNotice(theme: Theme, expanded: boolean, payload: unknown): string {
    const notice = theme.fg("error", "Malformed subagent result — expand for raw payload");
    if (!expanded) return notice;
    let raw: string;
    try { raw = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2); }
    catch { raw = String(payload); }
    return `${notice}\n${theme.fg("dim", raw)}`;
}

function memberFallback(theme: Theme, expanded: boolean, payload: unknown): string {
    const content = typeof payload === "string" ? payload : (() => {
        try { return JSON.stringify(payload); }
        catch { return String(payload); }
    })();
    if (content.includes("\"agentId\"") || content.includes("\"reason\"") || content.includes("\"agents\"")) {
        return legacyNotice(theme, expanded, payload);
    }
    return malformedNotice(theme, expanded, payload);
}

function debugExpanded(theme: Theme, snapshot: AgentSnapshot, handles?: Map<string, string>): string {
    const lines = [
        theme.fg("warning", "DEBUG"),
        expandedAgentCard(theme, snapshot, undefined, handles),
        labeled(theme, "bridgeReady", String(snapshot.status.bridgeReady)),
        labeled(theme, "activeTaskId", snapshot.status.activeTaskId ?? "none"),
        labeled(theme, "latestTaskId", snapshot.status.latestTaskId ?? "none"),
        labeled(theme, "cwd", snapshot.agent.cwd),
        labeled(theme, "tmux", `${snapshot.agent.tmux.sessionName} ${snapshot.agent.tmux.windowId} ${snapshot.agent.tmux.paneId}`),
    ];
    if (snapshot.status.exitReason) lines.push(labeled(theme, "exitReason", snapshot.status.exitReason));
    return lines.join("\n");
}

function callPromptText(theme: Theme, prompt: string, expanded: boolean): string {
    return theme.fg("dim", expanded ? prompt : previewText(prompt, COLLAPSED_PROMPT_LINES, COLLAPSED_PROMPT_CHARS));
}

export function renderSubmitCall(
    args: { profile?: string; agentId?: string; purpose: string; prompt: string; waitSeconds?: number },
    theme: Theme,
    context: CardRenderContext,
): Component {
    const title = theme.fg("accent", "subagent_submit");
    const target = args.profile !== undefined
        ? joinParts(["1 new agent", profileText(theme, args.profile)])
        : joinParts(["1 existing agent", args.agentId ? shortId(args.agentId) : undefined]);
    const wait = args.waitSeconds === undefined ? theme.fg("muted", "immediate") : theme.fg("muted", `wait ${args.waitSeconds}s`);
    const body = [
        joinParts([target, wait, theme.fg("muted", args.purpose)]),
        callPromptText(theme, args.prompt, context.expanded === true),
    ].join("\n");
    return textFromComponent(context.lastComponent, `${title} — ${body}`);
}

export function renderGetCall(
    args: { agentId: string; taskId?: string; debug?: boolean },
    theme: Theme,
    context: CardRenderContext,
): Component {
    const title = theme.fg("accent", "subagent_get");
    const taskPart = args.taskId
        ? `specified task ${shortId(args.taskId)}`
        : "active/latest task";
    const debugBadge = args.debug === true ? theme.fg("warning", "DEBUG") : undefined;
    const body = joinParts([shortId(args.agentId), taskPart, debugBadge]);
    return textFromComponent(context.lastComponent, `${title} — ${body}`);
}

export function renderWaitCall(
    args: { taskIds: string[]; condition: "any" | "all"; timeoutSeconds: number },
    theme: Theme,
    context: CardRenderContext,
): Component {
    const title = theme.fg("accent", "subagent_wait");
    const body = joinParts([
        args.condition,
        `${args.taskIds.length} task${args.taskIds.length === 1 ? "" : "s"}`,
        `${args.timeoutSeconds}s`,
    ]);
    return textFromComponent(context.lastComponent, `${title} — ${body}`);
}

export function renderStopCall(
    args: { agentId: string },
    theme: Theme,
    context: CardRenderContext,
): Component {
    const title = theme.fg("accent", "subagent_stop");
    const body = joinParts(["1 agent", shortId(args.agentId)]);
    return textFromComponent(context.lastComponent, `${title} — ${body}`);
}

function renderSingleResult(
    result: AgentToolResult<unknown>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: CardRenderContext,
    argsPrompt?: string,
    debug?: boolean,
    words?: readonly string[],
): Component {
    try {
        const details = result.details;
        if (!isRenderableAgentSnapshot(details)) {
            const contentText = result.content.map(part => "text" in part ? part.text : "").join("\n");
            const text = contentText.includes("\"agentId\"") || contentText.includes("\"reason\"")
                ? legacyNotice(theme, options.expanded, contentText || details)
                : malformedNotice(theme, options.expanded, details ?? contentText);
            return textFromComponent(context.lastComponent, text);
        }
        const snapshot = details;
        const handles = assignNatureHandles([snapshot.agent.agentId], words);
        if (options.expanded) {
            const text = debug === true ? debugExpanded(theme, snapshot, handles) : expandedAgentCard(theme, snapshot, argsPrompt, handles);
            return textFromComponent(context.lastComponent, text);
        }
        const card = collapsedAgentCard(theme, snapshot, argsPrompt, handles);
        const header = debug === true ? `${theme.fg("warning", "DEBUG")}\n${card}` : card;
        return textFromComponent(context.lastComponent, header);
    } catch {
        return textFromComponent(context.lastComponent, malformedNotice(theme, options.expanded, result.details));
    }
}

export function renderAgentToolResult(
    result: AgentToolResult<unknown>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: CardRenderContext,
    argsPrompt?: string,
    debug?: boolean,
    words?: readonly string[],
): Component {
    return renderSingleResult(result, options, theme, context, argsPrompt, debug, words);
}

export function renderSubmitResult(
    result: AgentToolResult<unknown>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: CardRenderContext,
    words?: readonly string[],
): Component {
    try {
        const details = result.details;
        if (!isSubmitDetails(details)) {
            const contentText = result.content.map(part => "text" in part ? part.text : "").join("\n");
            const text = contentText.includes("\"agentId\"")
                ? legacyNotice(theme, options.expanded, contentText || details)
                : malformedNotice(theme, options.expanded, details ?? contentText);
            return textFromComponent(context.lastComponent, text);
        }
        const target = context.args?.profile !== undefined ? "NEW PROFILED AGENT" : "EXISTING AGENT";
        const waitRequested = details.waitSeconds !== undefined || context.args?.waitSeconds !== undefined;
        const state = !waitRequested
            ? theme.fg("success", "SUBMITTED")
            : options.isPartial || details.waitOutcome === undefined
                ? waitOutcomeText(theme, "waiting")
                : waitOutcomeText(theme, details.waitOutcome);
        const handles = assignNatureHandles([details.agent.agentId], words);
        const argsPrompt = typeof context.args?.prompt === "string" ? context.args.prompt : undefined;
        const card = options.expanded
            ? expandedAgentCard(theme, details, argsPrompt, handles)
            : collapsedAgentCard(theme, details, argsPrompt, handles);
        return textFromComponent(context.lastComponent, `${state} · ${target}\n${card}`);
    } catch {
        return textFromComponent(context.lastComponent, malformedNotice(theme, options.expanded, result.details));
    }
}

export function renderWaitResult(
    result: AgentToolResult<unknown>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: CardRenderContext,
    words?: readonly string[],
): Component {
    try {
        const details = result.details;
        if (!isWaitDetails(details)) {
            const contentText = result.content.map(part => "text" in part ? part.text : "").join("\n");
            const text = contentText.includes("\"reason\"") || contentText.includes("\"agents\"")
                ? legacyNotice(theme, options.expanded, contentText || details)
                : malformedNotice(theme, options.expanded, details ?? contentText);
            return textFromComponent(context.lastComponent, text);
        }

        const done = details.agents.filter(agent => isRenderableAgentSnapshot(agent) && isTerminalRenderedTask(agent)).length;
        const total = details.agents.length;
        const kind = options.isPartial || details.outcome === undefined
            ? "waiting"
            : details.outcome === "timeout"
                ? "timeout"
                : "completed";
        const heading = `${waitOutcomeText(theme, kind)} · ${done}/${total} complete · ${details.condition} · ${details.timeoutSeconds}s`;
        const agentIds = details.agents.flatMap(agent => isRenderableAgentSnapshot(agent) ? [agent.agent.agentId] : []);
        const handles = assignNatureHandles(agentIds, words);
        const cards = details.agents.map(snapshot => {
            if (!isRenderableAgentSnapshot(snapshot)) return memberFallback(theme, options.expanded, snapshot);
            try {
                return options.expanded
                    ? expandedAgentCard(theme, snapshot, undefined, handles)
                    : collapsedAgentCard(theme, snapshot, undefined, handles);
            } catch {
                return memberFallback(theme, options.expanded, snapshot);
            }
        });
        return textFromComponent(context.lastComponent, [heading, ...cards].join("\n\n"));
    } catch {
        return textFromComponent(context.lastComponent, malformedNotice(theme, options.expanded, result.details));
    }
}
