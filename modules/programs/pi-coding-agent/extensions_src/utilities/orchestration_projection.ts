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
export const MAX_COMPACT_TASK_RESULT_BYTES = 16 * 1024;
export type MeshOutputMode = "compact" | "full";

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
    fullOutputAvailable?: true;
};

export type MinimalSubmitResult = {
    agentId: string;
    taskId: string;
    agent: string;
    profile: string;
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
type ModelVisibleTaskResult = Omit<NonNullable<NonNullable<AgentSnapshot["task"]>["result"]>, "usage" | "turns"> & { usage: Usage | "unavailable"; turns: number | "unavailable" };
type ModelVisibleTask = Omit<NonNullable<AgentSnapshot["task"]>, "result"> & { result: ModelVisibleTaskResult | null };
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
    if (!rawSnapshot.task?.request.completion) throw new Error(`Mesh task ${projected.taskId} has no durable completion target`);
    return {
        agentId: projected.agentId,
        taskId: projected.taskId,
        agent: projected.agent,
        profile: rawSnapshot.agent.selectedProfile,
        agentState: projected.agentState,
        taskState: projected.taskState,
    };
}

type DebugAgentStatus = Omit<AgentStatus, "accountedTaskIds" | "agentUsage"> & { agentUsage: Usage | "unavailable" };

function modelVisibleTask(snapshot: AgentSnapshot): ModelVisibleTask | undefined {
    const task = snapshot.task;
    if (!task || snapshot.agent.capabilities.usage || !task.result) return task;
    return { ...task, result: { ...task.result, usage: "unavailable", turns: "unavailable" } };
}

function statusWithoutAccountingIds(status: AgentStatus, usageAvailable: boolean): DebugAgentStatus {
    const { accountedTaskIds: _ignored, agentUsage, ...rest } = status;
    return { ...rest, agentUsage: usageAvailable ? agentUsage : "unavailable" };
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
    task: ModelVisibleTask | undefined;
} {
    const snapshot = sanitizeSnapshot(rawSnapshot);
    return {
        agent: snapshot.agent,
        status: statusWithoutAccountingIds(snapshot.status, snapshot.agent.capabilities.usage),
        activity: snapshot.activity,
        stop: projectModelVisibleStop(snapshot.stop),
        task: modelVisibleTask(snapshot),
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
        const losslessTaskIdentityList = key === "tasks" || key === "pendingTasks";
        const selected = !losslessTaskIdentityList && value.length > MAX_STRUCTURAL_ITEMS
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

function finalizeMarkers(markers: Iterable<MarkerState>, fullOutputAvailableOnTruncation: boolean): void {
    for (const marker of markers) {
        if (marker.truncated) {
            marker.target.outputTruncated = true;
            if (fullOutputAvailableOnTruncation) marker.target.fullOutputAvailable = true;
        } else if (marker.hadProperty) marker.target.outputTruncated = marker.original;
        else delete marker.target.outputTruncated;
    }
}

/** Deterministically cap one terminal task's encoded output and error fields. */
export function projectMeshRetrievalTask(rawSnapshot: AgentSnapshot, outputMode: MeshOutputMode): MinimalAgentTask {
    const projected = projectMinimalAgentTask(rawSnapshot);
    if (outputMode === "full" || projected.output === undefined && projected.error === undefined) return projected;
    const resultFields = () => ({
        ...(projected.output !== undefined ? { output: projected.output } : {}),
        ...(projected.error !== undefined ? { error: projected.error } : {}),
    });
    if (utf8Bytes(JSON.stringify(resultFields())) <= MAX_COMPACT_TASK_RESULT_BYTES) return projected;

    const originals = [projected.output, projected.error].filter((value): value is string => value !== undefined);
    const baseline = JSON.stringify({
        ...(projected.output !== undefined ? { output: "" } : {}),
        ...(projected.error !== undefined ? { error: "" } : {}),
        outputTruncated: true,
        fullOutputAvailable: true,
    });
    const remaining = Math.max(0, MAX_COMPACT_TASK_RESULT_BYTES - utf8Bytes(baseline));
    const costs = originals.map(value => jsonStringContentBytes(value));
    const cap = fairContentCap(costs, remaining);
    let index = 0;
    if (projected.output !== undefined) projected.output = truncateToJsonBudget(projected.output, Math.min(costs[index++]!, cap));
    if (projected.error !== undefined) projected.error = truncateToJsonBudget(projected.error, Math.min(costs[index]!, cap));
    projected.outputTruncated = true;
    projected.fullOutputAvailable = true;
    return projected;
}

/**
 * Serialize model-visible JSON within Pi's aggregate 50KB / 2000-line budget.
 * Uses one clone and an encoded-byte budget; only the final bounded clone is serialized at full fidelity.
 */
export function serializeModelVisibleJson(value: unknown, options: { fullOutputAvailableOnTruncation?: boolean } = {}): string {
    const estimatedBytes = estimatedJsonBytes(value, MAX_MODEL_VISIBLE_BYTES);
    if (estimatedBytes !== undefined && estimatedBytes <= MAX_MODEL_VISIBLE_BYTES) {
        const text = JSON.stringify(value);
        if (!exceedsModelVisibleLimit(text)) return text;
    }

    const markers = new Map<Record<string, unknown>, MarkerState>();
    const sites: ContentSite[] = [];
    let clone: unknown;
    clone = buildBudgetClone(value, undefined, next => { clone = next; }, undefined, sites, markers, true);
    for (const marker of markers.values()) {
        marker.target.outputTruncated = true;
        if (options.fullOutputAvailableOnTruncation) marker.target.fullOutputAvailable = true;
    }

    const baseText = JSON.stringify(clone);
    if (!exceedsModelVisibleLimit(baseText)) {
        const remaining = Math.max(0, MAX_MODEL_VISIBLE_BYTES - utf8Bytes(baseText));
        const cap = fairContentCap(sites.map(site => site.cost), remaining);
        for (const site of sites) {
            if (site.apply(Math.min(site.cost, cap))) site.marker.truncated = true;
        }
        finalizeMarkers(markers.values(), options.fullOutputAvailableOnTruncation === true);
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
        ...(options.fullOutputAvailableOnTruncation ? { fullOutputAvailable: true as const } : {}),
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

type CompletionTaskIdentity = { taskId: string; agentId: string; state: "succeeded" | "failed" | "stopped" };
type PendingTaskIdentity = { taskId: string; agentId: string; state: "created" | "running" };
type CompletionSource = { eventId: string; batchId: string; settledAt: string; tasks: CompletionTaskIdentity[] };
type CompletionFrontier = { observedAt: string; pendingTasks: PendingTaskIdentity[] };

function exactRecord(value: unknown, keys: readonly string[], label: string, optionalKeys: readonly string[] = []): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label);
    const raw = value as Record<string, unknown>;
    const allowedKeys = new Set([...keys, ...optionalKeys]);
    if (keys.some(key => !(key in raw)) || Object.keys(raw).some(key => !allowedKeys.has(key))) throw new Error(label);
    return raw;
}
function validateTaskIdentity(value: unknown, eventId: string, pending: false): CompletionTaskIdentity;
function validateTaskIdentity(value: unknown, eventId: string, pending: true): PendingTaskIdentity;
function validateTaskIdentity(value: unknown, eventId: string, pending: boolean): CompletionTaskIdentity | PendingTaskIdentity {
    const raw = exactRecord(value, ["taskId", "agentId", "state"], `Malformed mesh completion event ${eventId}`);
    if (typeof raw.taskId !== "string" || !EVENT_ID.test(raw.taskId) || typeof raw.agentId !== "string" || !EVENT_ID.test(raw.agentId)) throw new Error(`Malformed mesh completion event ${eventId}`);
    if (pending ? raw.state !== "created" && raw.state !== "running" : raw.state !== "succeeded" && raw.state !== "failed" && raw.state !== "stopped") throw new Error(`Malformed mesh completion event ${eventId}`);
    return raw as CompletionTaskIdentity | PendingTaskIdentity;
}
function validateSource(value: unknown): CompletionSource {
    const raw = exactRecord(value, ["eventId", "batchId", "settledAt", "tasks"], "Malformed mesh completion source");
    if (typeof raw.eventId !== "string" || !EVENT_ID.test(raw.eventId) || typeof raw.batchId !== "string" || !EVENT_ID.test(raw.batchId) || typeof raw.settledAt !== "string" || !Number.isFinite(Date.parse(raw.settledAt)) || !Array.isArray(raw.tasks) || !raw.tasks.length) throw new Error("Malformed mesh completion source");
    const tasks = raw.tasks.map(task => validateTaskIdentity(task, raw.eventId as string, false));
    if (new Set(tasks.map(task => task.taskId)).size !== tasks.length) throw new Error(`Malformed mesh completion event ${String(raw.eventId)}`);
    return { eventId: raw.eventId, batchId: raw.batchId, settledAt: raw.settledAt, tasks } as CompletionSource;
}
function validateFrontier(value: unknown): CompletionFrontier {
    const raw = exactRecord(value, ["observedAt", "pendingTasks"], "Malformed mesh completion frontier");
    if (typeof raw.observedAt !== "string" || !Number.isFinite(Date.parse(raw.observedAt)) || !Array.isArray(raw.pendingTasks)) throw new Error("Malformed mesh completion frontier");
    const pendingTasks = raw.pendingTasks.map(task => validateTaskIdentity(task, "frontier", true));
    if (new Set(pendingTasks.map(task => task.taskId)).size !== pendingTasks.length) throw new Error("Malformed mesh completion frontier");
    return { observedAt: raw.observedAt, pendingTasks };
}

export function projectMeshCompletionContext<T>(messages: readonly T[], receivedTaskIds: ReadonlySet<string>): { messages: T[]; eventIds: string[] } {
    const sourceIdentities = new Map<string, string>();
    const sources: CompletionSource[] = [];
    const completed = new Map<string, CompletionTaskIdentity>();
    const completionIndexes = new Set<number>();
    let latestFrontier: CompletionFrontier | undefined;

    for (const [index, value] of messages.entries()) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const message = value as Record<string, unknown>;
        const details = message.details && typeof message.details === "object" && !Array.isArray(message.details) ? message.details as Record<string, unknown> : undefined;
        if (message.customType !== "mesh-event" || details?.kind !== "completion") continue;
        completionIndexes.add(index);
        const raw = exactRecord(details, ["kind", "sources", "frontier"], "Malformed mesh completion bundle in model context", ["identities"]);
        if (raw.kind !== "completion" || !Array.isArray(raw.sources) || !raw.sources.length) throw new Error("Malformed mesh completion bundle in model context");
        for (const valueSource of raw.sources) {
            const source = validateSource(valueSource);
            const identity = canonicalJson(source);
            const existing = sourceIdentities.get(source.eventId);
            if (existing !== undefined) {
                if (existing !== identity) throw new Error(`Conflicting duplicate mesh completion event ${source.eventId}`);
                continue;
            }
            sourceIdentities.set(source.eventId, identity);
            sources.push(source);
            for (const task of source.tasks) {
                const prior = completed.get(task.taskId);
                if (prior && canonicalJson(prior) !== canonicalJson(task)) throw new Error(`Conflicting duplicate mesh completion task ${task.taskId}`);
                completed.set(task.taskId, task);
            }
        }
        latestFrontier = validateFrontier(raw.frontier);
    }

    const eventIds = sources.map(source => source.eventId);
    if (!completionIndexes.size) return { messages: [...messages], eventIds };
    const residualTasks = [...completed.values()].filter(task => !receivedTaskIds.has(task.taskId));
    const completedIds = new Set(completed.keys());
    const pendingTasks = (latestFrontier?.pendingTasks ?? []).filter(task => !completedIds.has(task.taskId) && !receivedTaskIds.has(task.taskId));
    const lastCompletionIndex = Math.max(...completionIndexes);
    const projected: T[] = [];
    for (const [index, value] of messages.entries()) {
        if (!completionIndexes.has(index)) { projected.push(value); continue; }
        if (index !== lastCompletionIndex || residualTasks.length === 0 && pendingTasks.length === 0) continue;
        const original = value as unknown as Record<string, unknown>;
        const frontier = { observedAt: latestFrontier!.observedAt, pendingTasks };
        projected.push({ ...original, content: JSON.stringify({ tasks: residualTasks, pendingTasks }), details: { kind: "completion", sources, frontier } } as T);
    }
    return { messages: projected, eventIds };
}
