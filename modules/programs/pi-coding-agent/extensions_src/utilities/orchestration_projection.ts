import type { Usage } from "@earendil-works/pi-ai";
import { canonicalJson } from "./agent_types.ts";
import {
    isTerminalTask,
    promptSummary,
    type AgentSnapshot,
    type AgentState,
    type AgentStatus,
    type TaskState,
} from "./orchestration_types.ts";

export const MAX_MODEL_VISIBLE_BYTES = 50 * 1024;
export const MAX_MODEL_VISIBLE_LINES = 2000;

export type ModelVisibleStop = {
    stopRequestId: string;
    state: NonNullable<AgentSnapshot["stop"]>["state"];
    source: NonNullable<AgentSnapshot["stop"]>["source"];
    reason: string;
    requestedAt: string;
    updatedAt: string;
    terminatingAt: string | null;
    confirmedAt: string | null;
    failedAt: string | null;
    failureCategory: string | null;
};

export type MinimalAgentTask = {
    agentId: string;
    taskId?: string;
    agent: string;
    summary: string;
    agentState: AgentState;
    activity: AgentSnapshot["activity"];
    stop: ModelVisibleStop | null;
    taskState?: TaskState;
    output?: string;
    error?: string;
    outputTruncated?: true;
};

export type MinimalSubmitResult = {
    agentId: string;
    taskId: string;
    agent: string;
    profile: string;
    route: "direct" | `channel ${string}`;
    agentState: AgentState;
    taskState: TaskState;
};

export type RetrievalAccounting = {
    usage?: Usage;
    claimedTaskIds: string[];
    receiptIds: string[];
    receivedTaskIds: string[];
};

export type AgentToolDetails = AgentSnapshot & {
    accounting: RetrievalAccounting;
};

export type SubmitDetails = AgentToolDetails;
/** Hide provisional task results until the task status is terminal. */
export function sanitizeSnapshot(snapshot: AgentSnapshot): AgentSnapshot {
    const task = snapshot.task && !isTerminalTask(snapshot.task.status.state) && snapshot.task.result
        ? { ...snapshot.task, result: null }
        : snapshot.task;
    return { ...snapshot, task };
}

export function projectModelVisibleStop(stop: AgentSnapshot["stop"]): ModelVisibleStop | null {
    if (!stop) return null;
    return {
        stopRequestId: stop.stopRequestId,
        state: stop.state,
        source: stop.source,
        reason: stop.reason,
        requestedAt: stop.requestedAt,
        updatedAt: stop.updatedAt,
        terminatingAt: stop.terminatingAt ?? null,
        confirmedAt: stop.confirmedAt ?? null,
        failedAt: stop.failedAt ?? null,
        failureCategory: stop.failureCategory ?? null,
    };
}

export function projectMinimalAgentTask(rawSnapshot: AgentSnapshot): MinimalAgentTask {
    const snapshot = sanitizeSnapshot(rawSnapshot);
    const task = snapshot.task;
    const projected: MinimalAgentTask = {
        agentId: snapshot.agent.agentId,
        agent: snapshot.agent.agent,
        summary: task ? promptSummary(task.request.prompt) : "No task",
        agentState: snapshot.status.state,
        activity: snapshot.activity,
        stop: projectModelVisibleStop(snapshot.stop),
    };
    if (task) {
        projected.taskId = task.request.taskId;
        projected.taskState = task.status.state;
        if (task.result && isTerminalTask(task.status.state)) {
            if (task.result.output) projected.output = task.result.output;
            if (task.result.error) projected.error = task.result.error;
        }
    }
    return projected;
}

export function projectMinimalSubmitResult(
    rawSnapshot: AgentSnapshot,
): MinimalSubmitResult {
    const projected = projectMinimalAgentTask(rawSnapshot);
    if (!projected.taskId || !projected.taskState) throw new Error(`Mesh agent ${projected.agentId} has no submitted task`);
    const completion = rawSnapshot.task?.request.completion;
    if (!completion) throw new Error(`Mesh task ${projected.taskId} has no durable completion route`);
    return {
        agentId: projected.agentId,
        taskId: projected.taskId,
        agent: projected.agent,
        profile: rawSnapshot.agent.selectedProfile,
        route: completion.mode === "direct" ? "direct" : `channel ${completion.channel}`,
        agentState: projected.agentState,
        taskState: projected.taskState,
    };
}

type DebugAgentStatus = Omit<AgentStatus, "accountedTaskIds">;

function statusWithoutAccountingIds(status: AgentStatus): DebugAgentStatus {
    const { accountedTaskIds: _ignored, ...rest } = status;
    return rest;
}

/**
 * Full sanitized agent/status/task snapshot for abnormal-state diagnosis.
 * Omits accounting bookkeeping IDs from model-visible debug content.
 */
export function projectDebugSnapshot(rawSnapshot: AgentSnapshot): {
    agent: AgentSnapshot["agent"];
    status: DebugAgentStatus;
    activity: AgentSnapshot["activity"];
    stop: ModelVisibleStop | null;
    task: AgentSnapshot["task"];
} {
    const snapshot = sanitizeSnapshot(rawSnapshot);
    return {
        agent: snapshot.agent,
        status: statusWithoutAccountingIds(snapshot.status),
        activity: snapshot.activity,
        stop: projectModelVisibleStop(snapshot.stop),
        task: snapshot.task,
    };
}

function utf8Bytes(text: string): number {
    return Buffer.byteLength(text, "utf8");
}

function countLines(text: string): number {
    if (text.length === 0) return 0;
    let lines = 1;
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code === 10) lines += 1;
        else if (code === 13) {
            lines += 1;
            if (text.charCodeAt(index + 1) === 10) index += 1;
        }
    }
    return lines;
}

export function exceedsModelVisibleLimit(text: string): boolean {
    return utf8Bytes(text) > MAX_MODEL_VISIBLE_BYTES || countLines(text) > MAX_MODEL_VISIBLE_LINES;
}

const CANONICAL_STRING_KEYS = new Set([
    "agentId", "taskId", "agentState", "taskState", "state", "outcome", "condition",
]);
const MAX_STRUCTURAL_ITEMS = 128;

type MarkerState = {
    target: Record<string, unknown>;
    hadProperty: boolean;
    original: unknown;
    truncated: boolean;
};

type ContentSite = {
    cost: number;
    apply: (budget: number) => boolean;
    marker: MarkerState;
};

function markerFor(target: Record<string, unknown>, markers: Map<Record<string, unknown>, MarkerState>): MarkerState {
    let marker = markers.get(target);
    if (!marker) {
        marker = {
            target,
            hadProperty: Object.hasOwn(target, "outputTruncated"),
            original: target.outputTruncated,
            truncated: false,
        };
        markers.set(target, marker);
    }
    return marker;
}

function jsonCharacterWidth(value: string, index: number): number {
    const code = value.charCodeAt(index);
    return code >= 0xD800 && code <= 0xDBFF
        && index + 1 < value.length
        && value.charCodeAt(index + 1) >= 0xDC00
        && value.charCodeAt(index + 1) <= 0xDFFF
        ? 2
        : 1;
}

function jsonCharacterBytes(value: string, index: number, width: number): number {
    const code = value.charCodeAt(index);
    if (width === 2) return 4;
    if (code === 0x22 || code === 0x5C || code === 0x08 || code === 0x0C
        || code === 0x0A || code === 0x0D || code === 0x09) return 2;
    if (code < 0x20 || (code >= 0xD800 && code <= 0xDFFF)) return 6;
    if (code < 0x80) return 1;
    if (code < 0x800) return 2;
    return 3;
}

function jsonStringContentBytes(value: string, limit = Number.POSITIVE_INFINITY): number {
    let bytes = 0;
    for (let index = 0; index < value.length;) {
        const width = jsonCharacterWidth(value, index);
        bytes += jsonCharacterBytes(value, index, width);
        if (bytes > limit) return limit + 1;
        index += width;
    }
    return bytes;
}

function truncateToJsonBudget(value: string, maxContentBytes: number): string {
    const fullCost = jsonStringContentBytes(value);
    if (fullCost <= maxContentBytes) return value;
    const ellipsisBytes = 3;
    if (maxContentBytes < ellipsisBytes) return "";
    let end = 0;
    let used = 0;
    while (end < value.length) {
        const width = jsonCharacterWidth(value, end);
        const cost = jsonCharacterBytes(value, end, width);
        if (used + cost + ellipsisBytes > maxContentBytes) break;
        used += cost;
        end += width;
    }
    return `${value.slice(0, end)}…`;
}

function jsonStringArrayExtraBytes(values: readonly string[]): number {
    let bytes = 0;
    for (let index = 0; index < values.length; index += 1) {
        bytes += (index === 0 ? 0 : 1) + 2 + jsonStringContentBytes(values[index]!);
    }
    return bytes;
}

function truncateStringArray(values: readonly string[], budget: number): string[] {
    const result: string[] = [];
    let used = 0;
    for (const value of values) {
        const separatorBytes = result.length === 0 ? 0 : 1;
        const itemOverhead = separatorBytes + 2;
        const fullCost = jsonStringContentBytes(value);
        if (used + itemOverhead + fullCost <= budget) {
            result.push(value);
            used += itemOverhead + fullCost;
            continue;
        }
        const available = budget - used - itemOverhead;
        if (available >= utf8Bytes("…")) result.push(truncateToJsonBudget(value, available));
        break;
    }
    return result;
}

function estimatedJsonBytes(value: unknown, limit: number): number | undefined {
    if (value === null) return 4;
    if (typeof value === "string") return 2 + jsonStringContentBytes(value, limit);
    if (typeof value === "number") return utf8Bytes(JSON.stringify(value));
    if (typeof value === "boolean") return value ? 4 : 5;
    if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return undefined;
    if (typeof value === "bigint") return utf8Bytes(JSON.stringify(value));
    if (Array.isArray(value)) {
        let bytes = 2;
        for (let index = 0; index < value.length; index += 1) {
            if (index > 0) bytes += 1;
            bytes += estimatedJsonBytes(value[index], limit - bytes) ?? 4;
            if (bytes > limit) return limit + 1;
        }
        return bytes;
    }
    let bytes = 2;
    let included = 0;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const childBytes = estimatedJsonBytes(child, limit - bytes);
        if (childBytes === undefined) continue;
        if (included > 0) bytes += 1;
        bytes += 3 + jsonStringContentBytes(key, limit - bytes) + childBytes;
        included += 1;
        if (bytes > limit) return limit + 1;
    }
    return bytes;
}

function buildBudgetClone(
    value: unknown,
    key: string | undefined,
    setValue: (next: unknown) => void,
    markerTarget: Record<string, unknown> | undefined,
    sites: ContentSite[],
    markers: Map<Record<string, unknown>, MarkerState>,
    root = false,
): unknown {
    if (typeof value === "string") {
        if (key !== undefined && CANONICAL_STRING_KEYS.has(key)) return value;
        if (!markerTarget) return value;
        const marker = markerFor(markerTarget, markers);
        const original = value;
        sites.push({
            cost: jsonStringContentBytes(original, MAX_MODEL_VISIBLE_BYTES),
            apply: budget => {
                const next = truncateToJsonBudget(original, budget);
                setValue(next);
                return next !== original;
            },
            marker,
        });
        return "";
    }
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
        if (value.every(item => typeof item === "string") && markerTarget) {
            const original = value as string[];
            const marker = markerFor(markerTarget, markers);
            sites.push({
                cost: Math.min(jsonStringArrayExtraBytes(original), MAX_MODEL_VISIBLE_BYTES + 1),
                apply: budget => {
                    const next = truncateStringArray(original, budget);
                    setValue(next);
                    return next.length !== original.length || next.some((item, index) => item !== original[index]);
                },
                marker,
            });
            return [];
        }
        const selected = key !== "tasks" && value.length > MAX_STRUCTURAL_ITEMS
            ? value.slice(0, MAX_STRUCTURAL_ITEMS)
            : value;
        if (selected.length !== value.length && markerTarget) markerFor(markerTarget, markers).truncated = true;
        const clone: unknown[] = [];
        for (let index = 0; index < selected.length; index += 1) {
            clone[index] = buildBudgetClone(
                selected[index],
                undefined,
                next => { clone[index] = next; },
                markerTarget,
                sites,
                markers,
            );
        }
        return clone;
    }

    const source = value as Record<string, unknown>;
    const clone: Record<string, unknown> = {};
    if (Object.hasOwn(source, "outputTruncated")) clone.outputTruncated = source.outputTruncated;
    const entries = Object.entries(source);
    const selected = !root && entries.length > MAX_STRUCTURAL_ITEMS
        ? entries.slice(0, MAX_STRUCTURAL_ITEMS)
        : entries;
    if (selected.length !== entries.length && markerTarget) markerFor(markerTarget, markers).truncated = true;
    for (const [childKey, child] of selected) {
        clone[childKey] = buildBudgetClone(
            child,
            childKey,
            next => { clone[childKey] = next; },
            clone,
            sites,
            markers,
        );
    }
    return clone;
}

function fairContentCap(costs: readonly number[], budget: number): number {
    let low = 0;
    let high = Math.max(0, ...costs, 0);
    let best = 0;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        let required = 0;
        for (const cost of costs) {
            required += Math.min(cost, mid);
            if (required > budget) break;
        }
        if (required <= budget) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return best;
}

function finalizeMarkers(markers: Iterable<MarkerState>): void {
    for (const marker of markers) {
        if (marker.truncated) marker.target.outputTruncated = true;
        else if (marker.hadProperty) marker.target.outputTruncated = marker.original;
        else delete marker.target.outputTruncated;
    }
}

/**
 * Serialize model-visible JSON within Pi's aggregate 50KB / 2000-line budget.
 * Uses one clone and an encoded-byte budget; only the final bounded clone is serialized at full fidelity.
 */
export function serializeModelVisibleJson(value: unknown): string {
    const estimatedBytes = estimatedJsonBytes(value, MAX_MODEL_VISIBLE_BYTES);
    if (estimatedBytes !== undefined && estimatedBytes <= MAX_MODEL_VISIBLE_BYTES) {
        const text = JSON.stringify(value);
        if (!exceedsModelVisibleLimit(text)) return text;
    }

    const markers = new Map<Record<string, unknown>, MarkerState>();
    const sites: ContentSite[] = [];
    let clone: unknown;
    clone = buildBudgetClone(value, undefined, next => { clone = next; }, undefined, sites, markers, true);
    for (const marker of markers.values()) marker.target.outputTruncated = true;

    const baseText = JSON.stringify(clone);
    if (!exceedsModelVisibleLimit(baseText)) {
        const remaining = Math.max(0, MAX_MODEL_VISIBLE_BYTES - utf8Bytes(baseText));
        const cap = fairContentCap(sites.map(site => site.cost), remaining);
        for (const site of sites) {
            if (site.apply(Math.min(site.cost, cap))) site.marker.truncated = true;
        }
        finalizeMarkers(markers.values());
        const bounded = JSON.stringify(clone);
        if (!exceedsModelVisibleLimit(bounded)) return bounded;
        return baseText;
    }

    const agentId = typeof (value as { agentId?: unknown })?.agentId === "string"
        ? (value as { agentId: string }).agentId
        : typeof (value as { agent?: { agentId?: unknown } })?.agent?.agentId === "string"
            ? (value as { agent: { agentId: string } }).agent.agentId
            : undefined;
    return JSON.stringify({
        truncated: true as const,
        outputTruncated: true as const,
        ...(agentId ? { agentId } : {}),
        preview: "Structure exceeds the model-visible JSON budget",
    });
}

export function omitUndefined<T extends Record<string, unknown>>(value: T): T {
    const next = { ...value };
    for (const key of Object.keys(next)) {
        if (next[key] === undefined) delete next[key];
    }
    return next;
}

const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function receiptIdsFromToolResults(messages: readonly unknown[]): string[] {
    const receiptIds = new Set<string>();
    for (const value of messages) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const message = value as Record<string, unknown>;
        if (message.role !== "toolResult" || !message.details || typeof message.details !== "object" || Array.isArray(message.details)) continue;
        const accounting = (message.details as Record<string, unknown>).accounting;
        if (!accounting || typeof accounting !== "object" || Array.isArray(accounting)) continue;
        const ids = (accounting as Record<string, unknown>).receiptIds;
        if (!Array.isArray(ids)) continue;
        for (const id of ids) if (typeof id === "string" && EVENT_ID.test(id)) receiptIds.add(id);
    }
    return [...receiptIds];
}

export function projectMeshCompletionContext<T>(messages: readonly T[], receivedTaskIds: ReadonlySet<string>): { messages: T[]; eventIds: string[] } {
    const projected: T[] = [];
    const eventIds: string[] = [];
    const identities = new Map<string, string>();
    for (const value of messages) {
        if (!value || typeof value !== "object" || Array.isArray(value)) { projected.push(value); continue; }
        const message = value as Record<string, unknown>;
        const details = message.details && typeof message.details === "object" && !Array.isArray(message.details) ? message.details as Record<string, unknown> : undefined;
        if (message.customType !== "mesh-event" || details?.kind !== "completion") { projected.push(value); continue; }
        const eventId = details.eventId;
        const payload = details.payload;
        if (typeof eventId !== "string" || !EVENT_ID.test(eventId) || !payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Malformed mesh completion event in model context");
        const completion = payload as Record<string, unknown>;
        if (completion.eventId !== eventId || completion.route !== "direct" && completion.route !== "channel" || completion.route === "channel" && (typeof completion.channel !== "string" || !/^[A-Z]$/u.test(completion.channel)) || completion.route === "direct" && completion.channel !== undefined || typeof completion.batchId !== "string" || !EVENT_ID.test(completion.batchId) || typeof completion.settledAt !== "string" || !Number.isFinite(Date.parse(completion.settledAt)) || !Array.isArray(completion.tasks) || completion.tasks.length < 1) throw new Error(`Malformed mesh completion event ${eventId}`);
        const tasks = completion.tasks.map(task => {
            if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error(`Malformed mesh completion event ${eventId}`);
            const record = task as Record<string, unknown>;
            if (typeof record.taskId !== "string" || !EVENT_ID.test(record.taskId) || record.state !== "succeeded" && record.state !== "failed" && record.state !== "stopped") throw new Error(`Malformed mesh completion event ${eventId}`);
            for (const key of ["createdAt", "startedAt", "finishedAt"] as const) if (record[key] !== undefined && (typeof record[key] !== "string" || !Number.isFinite(Date.parse(record[key] as string)))) throw new Error(`Malformed mesh completion event ${eventId}`);
            return record;
        });
        if (new Set(tasks.map(task => task.taskId)).size !== tasks.length) throw new Error(`Malformed mesh completion event ${eventId}`);
        const identity = canonicalJson(payload);
        const existing = identities.get(eventId);
        if (existing !== undefined) {
            if (existing !== identity) throw new Error(`Conflicting duplicate mesh completion event ${eventId}`);
            continue;
        }
        identities.set(eventId, identity);
        eventIds.push(eventId);
        const residual = tasks.filter(task => !receivedTaskIds.has(task.taskId as string));
        if (!residual.length) continue;
        const nextPayload = { ...completion, tasks: residual };
        const nextDetails = { ...details, payload: nextPayload };
        projected.push({ ...message, content: `[mesh-event ${eventId}] completion\n${serializeModelVisibleJson(nextPayload)}`, details: nextDetails } as T);
    }
    return { messages: projected, eventIds };
}
