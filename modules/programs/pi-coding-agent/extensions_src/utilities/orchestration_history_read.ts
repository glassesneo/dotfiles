import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    agentIdFromEndpoint,
    displayIdentityForAgentId,
    displayIdentityForSnapshot,
    formatPartyLabel,
    isRootEndpointId,
    NATURE_HANDLE_WORDS,
    previewHistoryText,
    type AgentDisplayIdentity,
} from "./orchestration_identity.ts";
import { validateMeshEvent, type MeshEvent } from "./orchestration_events.ts";
import { meshPaths, listMeshTasks, readAgentSnapshot, readTask, taskPaths } from "./orchestration_store.ts";
import { isTerminalTask, type TaskSnapshot, type TaskState } from "./orchestration_types.ts";

const EVENT_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/iu;
const TASK_DIR = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type ChildHistoryKind = "request" | "completion" | "intervention" | "report" | "delivery-ack" | "signal";
export type ChildHistoryBodyKind = "task-prompt" | "task-result" | "event";
export type HistoryDeliveryState = MeshEvent["state"];

export interface HistoryParty {
    endpointId: string;
    label: string;
    agentId?: string;
}

export interface ChildHistoryBodyRef {
    kind: ChildHistoryBodyKind;
    id: string;
    taskId?: string;
}

export interface ChildHistoryItem {
    id: string;
    taskId?: string;
    at: string;
    kind: ChildHistoryKind;
    from: HistoryParty;
    to: HistoryParty;
    purpose?: string;
    taskState?: TaskState;
    deliveryState?: HistoryDeliveryState;
    preview: string;
    truncated: boolean;
    bodyRef: ChildHistoryBodyRef;
}

export interface ChildHistoryList {
    items: ChildHistoryItem[];
    unavailableCount: number;
    loadFailed: boolean;
}

export const HISTORY_FULL_PATH_HINT = "mesh → child → h";

async function names(directory: string, predicate: (name: string) => boolean): Promise<string[]> {
    const listed = await readdir(directory).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : Promise.reject(error));
    return listed.filter(predicate);
}

function partyFromEndpoint(
    endpointId: string,
    identities: Map<string, AgentDisplayIdentity>,
    words: readonly string[],
): HistoryParty {
    if (isRootEndpointId(endpointId)) return { endpointId, label: "root" };
    const agentId = agentIdFromEndpoint(endpointId);
    if (!agentId) return { endpointId, label: endpointId };
    const identity = identities.get(agentId) ?? displayIdentityForAgentId(agentId, words);
    return { endpointId, label: formatPartyLabel(identity, identity.handle), agentId };
}

async function loadIdentities(
    stateRoot: string,
    meshId: string,
    agentIds: Iterable<string>,
    words: readonly string[],
): Promise<Map<string, AgentDisplayIdentity>> {
    const identities = new Map<string, AgentDisplayIdentity>();
    for (const agentId of new Set(agentIds)) {
        try {
            identities.set(agentId, displayIdentityForSnapshot(await readAgentSnapshot(stateRoot, meshId, agentId), words));
        } catch {
            identities.set(agentId, displayIdentityForAgentId(agentId, words));
        }
    }
    return identities;
}

function completionTasks(event: MeshEvent): Array<{ taskId: string; agentId: string; state: TaskState }> {
    const tasks = event.payload.tasks;
    if (!Array.isArray(tasks)) return [];
    return tasks.flatMap(value => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const record = value as Record<string, unknown>;
        if (typeof record.taskId !== "string" || typeof record.agentId !== "string" || typeof record.state !== "string") return [];
        return [{ taskId: record.taskId, agentId: record.agentId, state: record.state as TaskState }];
    });
}

function stringIds(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

function signalTaskIds(event: MeshEvent): string[] {
    return stringIds(event.payload.taskIds);
}

function payloadTaskId(event: MeshEvent): string | undefined {
    return typeof event.payload.taskId === "string" ? event.payload.taskId : undefined;
}

function payloadAgentId(event: MeshEvent): string | undefined {
    return typeof event.payload.agentId === "string" ? event.payload.agentId : undefined;
}

function eventRelatedToChild(event: MeshEvent, childAgentId: string, childEndpoint: string, tasks: ReadonlyMap<string, TaskSnapshot>): boolean {
    const relatedTaskIds = payloadTaskId(event) ? [payloadTaskId(event)!] : signalTaskIds(event);
    return payloadAgentId(event) === childAgentId
        || event.endpointId === childEndpoint
        || event.senderEndpointId === childEndpoint
        || relatedTaskIds.some(taskId => tasks.has(taskId));
}

function taskResultBody(task: TaskSnapshot): string {
    if (!task.result) return "";
    const output = task.result.output;
    const error = task.result.error ?? "";
    if (output && error) return `${output}\n${error}`;
    return error || output;
}

function ackBody(event: MeshEvent, originals: readonly MeshEvent[]): string {
    const through = event.payload.acknowledgedThrough;
    const messageIds = stringIds(event.payload.messageIds);
    const messages = originals.flatMap(original => typeof original.payload.message === "string" && original.payload.message ? [original.payload.message] : []);
    return [`Follow-up intake confirmed through #${String(through)}`, ...messages, messageIds.join(", ")].filter(Boolean).join("\n");
}

function eventBody(event: MeshEvent, task?: TaskSnapshot, originals: readonly MeshEvent[] = []): string {
    if (event.kind === "intervention" && typeof event.payload.message === "string") return event.payload.message;
    if (event.kind === "report" && typeof event.payload.summary === "string") return event.payload.summary;
    if (event.kind === "signal") {
        const topic = typeof event.payload.topic === "string" ? event.payload.topic : "";
        const text = typeof event.payload.text === "string" ? event.payload.text : "";
        return [topic, text].filter(Boolean).join("\n");
    }
    if (event.kind === "delivery-ack") return ackBody(event, originals);
    if (event.kind === "completion" && task) return taskResultBody(task);
    return "";
}

function sortItems(items: ChildHistoryItem[]): ChildHistoryItem[] {
    return items.sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id) || left.kind.localeCompare(right.kind));
}

function itemForPreview(kind: ChildHistoryKind, body: string, extra: Omit<ChildHistoryItem, "preview" | "truncated" | "kind">): ChildHistoryItem {
    const preview = previewHistoryText(body);
    return { ...extra, kind, preview: preview.preview, truncated: preview.truncated };
}

async function peekTaskAgentId(stateRoot: string, meshId: string, taskId: string): Promise<string | undefined> {
    try {
        const raw = JSON.parse(await readFile(taskPaths(stateRoot, meshId, taskId).request, "utf8")) as Record<string, unknown>;
        return typeof raw.agentId === "string" ? raw.agentId : undefined;
    } catch {
        return undefined;
    }
}

function ackGroups(event: MeshEvent, originalsById: ReadonlyMap<string, MeshEvent>, tasks: ReadonlyMap<string, TaskSnapshot>): Array<{
    id: string;
    taskId?: string;
    purpose?: string;
    taskState?: TaskState;
    originals: MeshEvent[];
    toEndpointId: string;
}> {
    const messageIds = stringIds(event.payload.messageIds);
    const originals = messageIds.flatMap(id => {
        const original = originalsById.get(id);
        return original ? [original] : [];
    });
    if (originals.length === 0) {
        const taskId = payloadTaskId(event);
        const task = taskId ? tasks.get(taskId) : undefined;
        return [{ id: event.eventId, taskId, purpose: task?.request.purpose, taskState: task?.status.state, originals: [], toEndpointId: event.endpointId }];
    }
    const grouped = new Map<string, MeshEvent[]>();
    for (const original of originals) {
        const taskId = payloadTaskId(original);
        const key = `${taskId ?? ""}:${original.senderEndpointId}`;
        const group = grouped.get(key) ?? [];
        group.push(original);
        grouped.set(key, group);
    }
    return [...grouped.entries()].map(([key, group]) => {
        const taskId = payloadTaskId(group[0]!);
        const known = taskId && tasks.has(taskId) ? tasks.get(taskId) : undefined;
        const split = grouped.size > 1;
        return {
            id: split ? `${event.eventId}:${key}` : event.eventId,
            taskId: known?.request.taskId,
            purpose: known?.request.purpose,
            taskState: known?.status.state,
            originals: group,
            toEndpointId: group[0]!.senderEndpointId,
        };
    });
}

export async function listChildHistory(
    stateRoot: string,
    meshId: string,
    childAgentId: string,
    words: readonly string[] = NATURE_HANDLE_WORDS,
): Promise<ChildHistoryList> {
    let unavailableCount = 0;
    const childEndpoint = `agent:${childAgentId}`;
    let listedTasks: TaskSnapshot[];
    let eventNames: string[];
    try {
        [listedTasks, eventNames] = await Promise.all([
            listMeshTasks(stateRoot, meshId),
            names(meshPaths(stateRoot, meshId).events, name => EVENT_FILE.test(name)),
        ]);
    } catch {
        return { items: [], unavailableCount: 0, loadFailed: true };
    }

    let taskNames: string[] = [];
    try { taskNames = await names(meshPaths(stateRoot, meshId).tasks, name => TASK_DIR.test(name)); }
    catch { /* listedTasks already failed or succeeded independently */ }

    const listedIds = new Set(listedTasks.map(task => task.request.taskId));
    for (const taskId of taskNames) {
        if (listedIds.has(taskId)) continue;
        const owner = await peekTaskAgentId(stateRoot, meshId, taskId);
        // Unknown ownership is incomplete evidence, not proof of an empty history.
        if (owner === undefined || owner === childAgentId) unavailableCount += 1;
    }

    const tasks = new Map<string, TaskSnapshot>();
    for (const task of listedTasks) {
        if (task.request.agentId !== childAgentId) continue;
        tasks.set(task.request.taskId, task);
        if (isTerminalTask(task.status.state) && !task.result) unavailableCount += 1;
    }

    const events: MeshEvent[] = [];
    for (const name of eventNames) {
        try {
            const event = validateMeshEvent(JSON.parse(await readFile(join(meshPaths(stateRoot, meshId).events, name), "utf8")), meshId);
            if (name.toLowerCase() !== `${event.eventId}.json`.toLowerCase()) {
                unavailableCount += 1;
                continue;
            }
            events.push(event);
        } catch {
            unavailableCount += 1;
        }
    }

    const identityIds = new Set<string>([childAgentId]);
    for (const task of tasks.values()) {
        if (task.request.requesterAgentId) identityIds.add(task.request.requesterAgentId);
        const requester = agentIdFromEndpoint(task.request.requesterEndpointId);
        if (requester) identityIds.add(requester);
    }
    for (const event of events) {
        const payloadAgent = payloadAgentId(event);
        if (payloadAgent) identityIds.add(payloadAgent);
        const sender = agentIdFromEndpoint(event.senderEndpointId);
        if (sender) identityIds.add(sender);
        const target = agentIdFromEndpoint(event.endpointId);
        if (target) identityIds.add(target);
        for (const task of completionTasks(event)) identityIds.add(task.agentId);
    }
    const identities = await loadIdentities(stateRoot, meshId, identityIds, words);
    const childParty = partyFromEndpoint(childEndpoint, identities, words);
    const items: ChildHistoryItem[] = [];
    const completionByTask = new Map<string, MeshEvent>();

    for (const event of events) {
        if (event.kind !== "completion") continue;
        for (const task of completionTasks(event)) {
            if (task.agentId === childAgentId) {
                completionByTask.set(task.taskId, event);
                if (!tasks.has(task.taskId) && !taskNames.includes(task.taskId)) unavailableCount += 1;
            }
        }
    }

    for (const task of tasks.values()) {
        const requester = partyFromEndpoint(task.request.requesterEndpointId, identities, words);
        items.push(itemForPreview("request", task.request.prompt, {
            id: `${task.request.taskId}:request`,
            taskId: task.request.taskId,
            at: task.request.createdAt,
            from: requester,
            to: childParty,
            purpose: task.request.purpose,
            taskState: task.status.state,
            bodyRef: { kind: "task-prompt", id: task.request.taskId, taskId: task.request.taskId },
        }));
        if (!isTerminalTask(task.status.state)) continue;
        const completionEvent = completionByTask.get(task.request.taskId);
        items.push(itemForPreview("completion", taskResultBody(task), {
            id: `${task.request.taskId}:completion`,
            taskId: task.request.taskId,
            at: task.status.finishedAt ?? task.result?.finishedAt ?? task.request.createdAt,
            from: childParty,
            to: requester,
            purpose: task.request.purpose,
            taskState: task.status.state,
            ...(completionEvent ? { deliveryState: completionEvent.state } : {}),
            bodyRef: { kind: "task-result", id: task.request.taskId, taskId: task.request.taskId },
        }));
    }

    const interventionsById = new Map<string, MeshEvent>();
    for (const event of events) {
        if (event.kind === "intervention") interventionsById.set(event.eventId, event);
    }

    for (const event of events) {
        if (event.kind === "completion") continue;
        if (!eventRelatedToChild(event, childAgentId, childEndpoint, tasks)) continue;

        const from = partyFromEndpoint(event.senderEndpointId, identities, words);
        if (event.kind === "delivery-ack") {
            unavailableCount += stringIds(event.payload.messageIds).filter(id => !interventionsById.has(id) && !eventNames.includes(`${id}.json`)).length;
            for (const group of ackGroups(event, interventionsById, tasks)) {
                items.push(itemForPreview("delivery-ack", ackBody(event, group.originals), {
                    id: group.id,
                    ...(group.taskId ? { taskId: group.taskId } : {}),
                    at: event.createdAt,
                    from,
                    to: partyFromEndpoint(group.toEndpointId, identities, words),
                    ...(group.purpose ? { purpose: group.purpose } : {}),
                    ...(group.taskState ? { taskState: group.taskState } : {}),
                    deliveryState: event.state,
                    bodyRef: { kind: "event", id: event.eventId, ...(group.taskId ? { taskId: group.taskId } : {}) },
                }));
            }
            continue;
        }

        if (event.kind === "signal") {
            const knownTaskIds = signalTaskIds(event).filter(taskId => tasks.has(taskId));
            const targets = knownTaskIds.length > 0 ? knownTaskIds : [undefined];
            for (const taskId of targets) {
                const task = taskId ? tasks.get(taskId) : undefined;
                const split = knownTaskIds.length > 1;
                items.push(itemForPreview("signal", eventBody(event, task), {
                    id: split && taskId ? `${event.eventId}:${taskId}` : event.eventId,
                    ...(taskId ? { taskId } : {}),
                    at: event.createdAt,
                    from,
                    to: partyFromEndpoint(event.endpointId, identities, words),
                    ...(task?.request.purpose ? { purpose: task.request.purpose } : {}),
                    ...(task ? { taskState: task.status.state } : {}),
                    deliveryState: event.state,
                    bodyRef: { kind: "event", id: event.eventId, ...(taskId ? { taskId } : {}) },
                }));
            }
            continue;
        }

        const taskId = payloadTaskId(event);
        const task = taskId ? tasks.get(taskId) : undefined;
        items.push(itemForPreview(event.kind, eventBody(event, task), {
            id: event.eventId,
            taskId,
            at: event.createdAt,
            from,
            to: partyFromEndpoint(event.endpointId, identities, words),
            purpose: task?.request.purpose,
            taskState: task?.status.state,
            deliveryState: event.state,
            bodyRef: { kind: "event", id: event.eventId, taskId },
        }));
    }

    return { items: sortItems(items), unavailableCount, loadFailed: false };
}

export async function readChildHistoryBody(
    stateRoot: string,
    meshId: string,
    ref: ChildHistoryBodyRef,
): Promise<string> {
    if (ref.kind === "task-prompt") {
        const task = await readTask(stateRoot, meshId, ref.id);
        return task.request.prompt;
    }
    if (ref.kind === "task-result") {
        const task = await readTask(stateRoot, meshId, ref.id);
        if (!task.result) throw new Error("Task result is unavailable");
        return taskResultBody(task);
    }
    const event = validateMeshEvent(JSON.parse(await readFile(join(meshPaths(stateRoot, meshId).events, `${ref.id}.json`), "utf8")), meshId);
    if (event.kind === "delivery-ack") {
        const originals: MeshEvent[] = [];
        for (const messageId of stringIds(event.payload.messageIds)) {
            try {
                originals.push(validateMeshEvent(JSON.parse(await readFile(join(meshPaths(stateRoot, meshId).events, `${messageId}.json`), "utf8")), meshId));
            } catch {
                continue;
            }
        }
        const wanted = ref.taskId;
        const matched = wanted ? originals.filter(original => payloadTaskId(original) === wanted) : originals;
        return ackBody(event, matched.length > 0 ? matched : originals);
    }
    const task = event.kind === "completion" && ref.taskId
        ? await readTask(stateRoot, meshId, ref.taskId).catch(() => undefined)
        : undefined;
    return eventBody(event, task);
}
