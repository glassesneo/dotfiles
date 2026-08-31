import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { mapConcurrent } from "./concurrency.ts";
import { endpointRecordKey, endpointRecordPath } from "./orchestration_binding.ts";
import { readOptionalJson, writeAtomicJson } from "./orchestration_json.ts";
import { meshDirectory } from "./orchestration_lock.ts";
import { isTerminalTask, type CompletionTarget, type TaskState } from "./orchestration_types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;

export type OrchestrationIndexClass = "agent-task-inbox" | "completion-queue" | "endpoint-events" | "endpoint-tasks";
export interface AgentTaskInboxReference { schemaVersion: 1; meshId: string; agentId: string; taskId: string; createdAt: string }
export interface CompletionQueueReference { schemaVersion: 1; meshId: string; endpointId: string; endpointSessionFile: string; bindingId: string; taskId: string; agentId: string; queuedAt: string }
export interface EndpointEventReference { schemaVersion: 1; meshId: string; endpointId: string; endpointSessionFile: string; bindingId: string; eventId: string; createdAt: string }
export interface EndpointTaskReference { schemaVersion: 1; meshId: string; endpointId: string; endpointSessionFile: string; bindingId: string; taskId: string; agentId: string; createdAt: string }
export type OrchestrationIndexReference = AgentTaskInboxReference | CompletionQueueReference | EndpointEventReference | EndpointTaskReference;
export interface OrchestrationIndexReadObserver { directoryRead(path: string): void }

type IndexIdentity = { agentId?: string; endpointId?: string; endpointSessionFile?: string; bindingId?: string; taskId?: string; eventId?: string };
type EndpointTarget = Required<Pick<CompletionTarget, "endpointId" | "endpointSessionFile" | "bindingId">>;

function id(value: unknown, label: string): string { if (typeof value !== "string" || !UUID.test(value)) throw new Error(`${label} must be a UUID`); return value; }
function text(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`); return value; }
function timestamp(value: unknown, label: string): string { const result = text(value, label); if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO timestamp`); return result; }
function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`); const raw = value as Record<string, unknown>; if (Object.keys(raw).length !== keys.length || keys.some(key => !(key in raw)) || Object.keys(raw).some(key => !keys.includes(key))) throw new Error(`${label} has invalid keys`); return raw; }
function same(value: string, expected: string | undefined, label: string): void { if (expected !== undefined && value !== expected) throw new Error(`${label} identity does not match path`); }
function indexRoot(stateRoot: string, meshId: string): string { return meshDirectory(stateRoot, id(meshId, "mesh ID")); }

/** Uses the endpoint's stable ID only, matching the endpoint record path key. */
export function endpointInboxKey(endpointId: string): string { return endpointRecordKey(text(endpointId, "endpoint ID")); }
export function workerTaskInboxDirectory(stateRoot: string, meshId: string, agentId: string): string { return join(indexRoot(stateRoot, meshId), "agents", id(agentId, "agent ID"), "task-inbox"); }
export function rootCompletionQueueDirectory(stateRoot: string, meshId: string): string { return join(indexRoot(stateRoot, meshId), "completion-queue"); }
export function endpointBindingInboxDirectory(stateRoot: string, meshId: string, target: EndpointTarget): string { return join(indexRoot(stateRoot, meshId), "endpoint-inboxes", endpointInboxKey(target.endpointId), id(target.bindingId, "binding ID")); }
function endpointInboxDirectory(stateRoot: string, meshId: string, target: EndpointTarget, kind: "events" | "tasks"): string { return join(endpointBindingInboxDirectory(stateRoot, meshId, target), kind); }

export function orchestrationIndexPath(stateRoot: string, meshId: string, kind: OrchestrationIndexClass, identity: IndexIdentity): string {
    if (kind === "agent-task-inbox") return join(workerTaskInboxDirectory(stateRoot, meshId, id(identity.agentId, "agent ID")), `${id(identity.taskId, "task ID")}.json`);
    if (kind === "completion-queue") return join(rootCompletionQueueDirectory(stateRoot, meshId), `${id(identity.taskId, "task ID")}.json`);
    const target: EndpointTarget = { endpointId: text(identity.endpointId, "endpoint ID"), endpointSessionFile: text(identity.endpointSessionFile, "endpoint session file"), bindingId: id(identity.bindingId, "binding ID") };
    return join(endpointInboxDirectory(stateRoot, meshId, target, kind === "endpoint-events" ? "events" : "tasks"), `${id(kind === "endpoint-events" ? identity.eventId : identity.taskId, kind === "endpoint-events" ? "event ID" : "task ID")}.json`);
}

export function validateOrchestrationIndexReference(kind: OrchestrationIndexClass, value: unknown, expected: IndexIdentity & { meshId: string }): OrchestrationIndexReference {
    const endpointKeys = ["schemaVersion", "meshId", "endpointId", "endpointSessionFile", "bindingId"];
    const keys = kind === "agent-task-inbox" ? ["schemaVersion", "meshId", "agentId", "taskId", "createdAt"] : kind === "completion-queue" ? [...endpointKeys, "taskId", "agentId", "queuedAt"] : kind === "endpoint-events" ? [...endpointKeys, "eventId", "createdAt"] : [...endpointKeys, "taskId", "agentId", "createdAt"];
    const raw = exact(value, keys, `${kind} reference`);
    if (raw.schemaVersion !== 1) throw new Error(`Unsupported ${kind} reference schemaVersion`);
    same(id(raw.meshId, `${kind} meshId`), expected.meshId, `${kind} mesh`);
    if (kind === "agent-task-inbox") {
        same(id(raw.agentId, `${kind} agentId`), expected.agentId, `${kind} agent`);
        same(id(raw.taskId, `${kind} taskId`), expected.taskId, `${kind} task`);
        timestamp(raw.createdAt, `${kind} createdAt`);
    } else {
        same(text(raw.endpointId, `${kind} endpointId`), expected.endpointId, `${kind} endpoint`);
        same(text(raw.endpointSessionFile, `${kind} endpointSessionFile`), expected.endpointSessionFile, `${kind} endpoint session`);
        same(id(raw.bindingId, `${kind} bindingId`), expected.bindingId, `${kind} binding`);
        if (kind === "endpoint-events") {
            same(id(raw.eventId, `${kind} eventId`), expected.eventId, `${kind} event`);
            timestamp(raw.createdAt, `${kind} createdAt`);
        } else {
            same(id(raw.taskId, `${kind} taskId`), expected.taskId, `${kind} task`);
            id(raw.agentId, `${kind} agentId`);
            timestamp(raw[kind === "completion-queue" ? "queuedAt" : "createdAt"], `${kind} ${kind === "completion-queue" ? "queuedAt" : "createdAt"}`);
        }
    }
    return value as OrchestrationIndexReference;
}

async function names(path: string, observer?: OrchestrationIndexReadObserver): Promise<string[]> { observer?.directoryRead(path); return readdir(path).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : Promise.reject(error)); }
async function persist(kind: OrchestrationIndexClass, stateRoot: string, meshId: string, reference: OrchestrationIndexReference, refresh = false): Promise<void> { const path = orchestrationIndexPath(stateRoot, meshId, kind, reference); const existing = await readOptionalJson(path); if (existing !== undefined) { validateOrchestrationIndexReference(kind, existing, { ...reference, meshId }); if (refresh) await writeAtomicJson(path, existing); return; } await writeAtomicJson(path, reference); }

export async function indexTaskSubmission(stateRoot: string, meshId: string, input: { agentId: string; taskId: string; createdAt: string; completion?: CompletionTarget }, refresh = false): Promise<void> {
    await Promise.all([
        persist("agent-task-inbox", stateRoot, meshId, { schemaVersion: 1, meshId, agentId: input.agentId, taskId: input.taskId, createdAt: input.createdAt }, refresh),
        ...(input.completion?.bindingId ? [persist("endpoint-tasks", stateRoot, meshId, { schemaVersion: 1, meshId, ...input.completion as EndpointTarget, taskId: input.taskId, agentId: input.agentId, createdAt: input.createdAt }, refresh)] : []),
    ]);
}

export async function indexTerminalTransition(stateRoot: string, meshId: string, input: { agentId: string; taskId: string; queuedAt: string; completion?: CompletionTarget }, refresh = false): Promise<void> {
    if (input.completion?.bindingId) await persist("completion-queue", stateRoot, meshId, { schemaVersion: 1, meshId, ...input.completion as EndpointTarget, taskId: input.taskId, agentId: input.agentId, queuedAt: input.queuedAt }, refresh);
}
export async function indexEventCreation(stateRoot: string, meshId: string, input: { endpointId: string; endpointSessionFile: string; bindingId: string; eventId: string; createdAt: string }, refresh = false): Promise<void> { await persist("endpoint-events", stateRoot, meshId, { schemaVersion: 1, meshId, ...input }, refresh); }

function referenceOrder(left: OrchestrationIndexReference, right: OrchestrationIndexReference): number { const leftTime = "queuedAt" in left ? left.queuedAt : left.createdAt; const rightTime = "queuedAt" in right ? right.queuedAt : right.createdAt; const leftId = "eventId" in left ? left.eventId : left.taskId; const rightId = "eventId" in right ? right.eventId : right.taskId; return leftTime.localeCompare(rightTime) || leftId.localeCompare(rightId); }
async function references<T extends OrchestrationIndexReference>(kind: OrchestrationIndexClass, stateRoot: string, meshId: string, directory: string, expected: IndexIdentity, observer?: OrchestrationIndexReadObserver): Promise<T[]> {
    const entries = (await names(directory, observer)).filter(name => name.endsWith(".json"));
    const values = await mapConcurrent(entries, 8, async name => {
        const identity = kind === "endpoint-events" ? { eventId: name.slice(0, -5) } : { taskId: name.slice(0, -5) };
        if (!UUID.test(Object.values(identity)[0]!)) return undefined;
        const value = await readOptionalJson(join(directory, name));
        if (value === undefined) return undefined;
        const reference = validateOrchestrationIndexReference(kind, value, { meshId, ...expected, ...identity }) as T;
        if (orchestrationIndexPath(stateRoot, meshId, kind, reference) !== join(directory, name)) throw new Error(`${kind} reference identity does not match path`);
        return reference;
    });
    return values.filter((value): value is T => value !== undefined).sort(referenceOrder);
}
export async function readAgentTaskInboxReferences(stateRoot: string, meshId: string, agentId: string, observer?: OrchestrationIndexReadObserver): Promise<AgentTaskInboxReference[]> { return references("agent-task-inbox", stateRoot, meshId, workerTaskInboxDirectory(stateRoot, meshId, agentId), { agentId }, observer); }
export async function readEndpointTaskReferences(stateRoot: string, meshId: string, target: EndpointTarget, observer?: OrchestrationIndexReadObserver): Promise<EndpointTaskReference[]> { return references("endpoint-tasks", stateRoot, meshId, endpointInboxDirectory(stateRoot, meshId, target, "tasks"), target, observer); }
export async function readEndpointEventReferences(stateRoot: string, meshId: string, target: EndpointTarget, observer?: OrchestrationIndexReadObserver): Promise<EndpointEventReference[]> { return references("endpoint-events", stateRoot, meshId, endpointInboxDirectory(stateRoot, meshId, target, "events"), target, observer); }
export async function readCompletionQueueReferences(stateRoot: string, meshId: string, observer?: OrchestrationIndexReadObserver): Promise<CompletionQueueReference[]> { return references("completion-queue", stateRoot, meshId, rootCompletionQueueDirectory(stateRoot, meshId), {}, observer); }
export async function removeOrchestrationIndexReference(stateRoot: string, meshId: string, kind: OrchestrationIndexClass, identity: IndexIdentity): Promise<void> { await rm(orchestrationIndexPath(stateRoot, meshId, kind, identity), { force: true }); }

interface TaskAuthority { agentId: string; createdAt: string; completion?: EndpointTarget; state?: TaskState; finishedAt?: string }
function completion(value: unknown): EndpointTarget | undefined { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const raw = value as Record<string, unknown>; try { return { endpointId: text(raw.endpointId, "completion endpoint ID"), endpointSessionFile: text(raw.endpointSessionFile, "completion session file"), bindingId: id(raw.bindingId, "completion binding ID") }; } catch { return undefined; } }
async function taskAuthority(stateRoot: string, meshId: string, taskId: string): Promise<TaskAuthority | undefined> {
    const directory = join(indexRoot(stateRoot, meshId), "tasks", taskId);
    const [request, status] = await Promise.all([readOptionalJson(join(directory, "request.json")), readOptionalJson(join(directory, "status.json"))]);
    if (!request || typeof request !== "object" || Array.isArray(request)) return undefined;
    const rawRequest = request as Record<string, unknown>;
    try {
        if (rawRequest.meshId !== meshId || rawRequest.taskId !== taskId) return undefined;
        const target = completion(rawRequest.completion);
        const authority: TaskAuthority = { agentId: id(rawRequest.agentId, "task agent ID"), createdAt: timestamp(rawRequest.createdAt, "task createdAt"), ...(target ? { completion: target } : {}) };
        if (!status || typeof status !== "object" || Array.isArray(status)) return authority;
        const rawStatus = status as Record<string, unknown>;
        if (rawStatus.meshId !== meshId || rawStatus.taskId !== taskId || rawStatus.agentId !== authority.agentId || !["created", "running", "succeeded", "failed", "stopped"].includes(String(rawStatus.state))) return authority;
        authority.state = rawStatus.state as TaskState;
        if (rawStatus.finishedAt !== undefined) authority.finishedAt = timestamp(rawStatus.finishedAt, "task finishedAt");
        return authority;
    } catch { return undefined; }
}
interface EventAuthority { endpointId: string; endpointSessionFile: string; bindingId: string; state: string; createdAt: string }
async function eventAuthority(stateRoot: string, meshId: string, eventId: string): Promise<EventAuthority | undefined> {
    const raw = await readOptionalJson(join(indexRoot(stateRoot, meshId), "events", `${eventId}.json`));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const event = raw as Record<string, unknown>;
    try { if (event.meshId !== meshId || event.eventId !== eventId || !["pending", "injected", "acknowledged"].includes(String(event.state))) return undefined; return { endpointId: text(event.endpointId, "event endpoint ID"), endpointSessionFile: text(event.endpointSessionFile, "event session file"), bindingId: id(event.endpointBindingId, "event binding ID"), state: String(event.state), createdAt: timestamp(event.createdAt, "event createdAt") }; } catch { return undefined; }
}
async function viableBinding(stateRoot: string, meshId: string, target: EndpointTarget): Promise<boolean> {
    const raw = await readOptionalJson(endpointRecordPath(stateRoot, meshId, target.endpointId));
    if (raw === undefined) return true;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const endpoint = raw as Record<string, unknown>;
    return endpoint.meshId === meshId && endpoint.endpointId === target.endpointId && endpoint.sessionFile === target.endpointSessionFile && endpoint.bindingId === target.bindingId && endpoint.online === true;
}

interface StoredReference { kind: OrchestrationIndexClass; path: string; reference: OrchestrationIndexReference }
async function indexReferenceFiles(stateRoot: string, meshId: string): Promise<Array<{ kind: OrchestrationIndexClass; path: string }>> {
    const root = indexRoot(stateRoot, meshId); const files: Array<{ kind: OrchestrationIndexClass; path: string }> = [];
    for (const agentId of (await names(join(root, "agents"))).filter(name => UUID.test(name))) for (const name of await names(workerTaskInboxDirectory(stateRoot, meshId, agentId))) if (name.endsWith(".json")) files.push({ kind: "agent-task-inbox", path: join(workerTaskInboxDirectory(stateRoot, meshId, agentId), name) });
    for (const name of await names(rootCompletionQueueDirectory(stateRoot, meshId))) if (name.endsWith(".json")) files.push({ kind: "completion-queue", path: join(rootCompletionQueueDirectory(stateRoot, meshId), name) });
    const endpointRoot = join(root, "endpoint-inboxes");
    for (const endpointKey of (await names(endpointRoot)).filter(name => SHA256.test(name))) for (const bindingId of (await names(join(endpointRoot, endpointKey))).filter(name => UUID.test(name))) for (const [kind, leaf] of [["endpoint-events", "events"], ["endpoint-tasks", "tasks"]] as const) for (const name of await names(join(endpointRoot, endpointKey, bindingId, leaf))) if (name.endsWith(".json")) files.push({ kind, path: join(endpointRoot, endpointKey, bindingId, leaf, name) });
    return files;
}
async function readStoredReference(stateRoot: string, meshId: string, item: { kind: OrchestrationIndexClass; path: string }): Promise<StoredReference | undefined> {
    try {
        const value = await readOptionalJson(item.path); if (value === undefined) return undefined;
        const name = item.path.split("/").at(-1)!; const identity = item.kind === "endpoint-events" ? { eventId: name.slice(0, -5) } : { taskId: name.slice(0, -5) };
        const reference = validateOrchestrationIndexReference(item.kind, value, { meshId, ...identity });
        if (orchestrationIndexPath(stateRoot, meshId, item.kind, reference) !== item.path) throw new Error("reference path is misplaced");
        return { ...item, reference };
    } catch { await rm(item.path, { force: true }); return undefined; }
}
async function pruneEmptyDirectories(path: string, stop: string): Promise<void> { let current = path; while (current !== stop && current.startsWith(stop)) { if ((await names(current)).length) return; await rm(current, { recursive: true, force: true }); current = current.slice(0, current.lastIndexOf("/")); } }
async function pruneEndpointInboxDirectories(stateRoot: string, meshId: string): Promise<void> {
    const endpointRoot = join(indexRoot(stateRoot, meshId), "endpoint-inboxes");
    for (const key of await names(endpointRoot)) for (const bindingId of await names(join(endpointRoot, key))) {
        const binding = join(endpointRoot, key, bindingId);
        await pruneEmptyDirectories(join(binding, "events"), endpointRoot);
        await pruneEmptyDirectories(join(binding, "tasks"), endpointRoot);
        await pruneEmptyDirectories(binding, endpointRoot);
    }
}

/** Rebuilds authoritative references, removes invalid evidence, and retains valid index-first crash evidence. */
export async function reconcileOrchestrationIndexes(stateRoot: string, meshId: string): Promise<{ created: number; removed: number }> {
    const root = indexRoot(stateRoot, meshId);
    await Promise.all([mkdir(join(root, "agents"), { recursive: true, mode: 0o700 }), mkdir(rootCompletionQueueDirectory(stateRoot, meshId), { recursive: true, mode: 0o700 }), mkdir(join(root, "endpoint-inboxes"), { recursive: true, mode: 0o700 })]);
    await rm(join(root, "indexes"), { recursive: true, force: true });
    let removed = 0;
    for (const item of await indexReferenceFiles(stateRoot, meshId)) {
        const stored = await readStoredReference(stateRoot, meshId, item); if (!stored) continue;
        const reference = stored.reference;
        let retain = true;
        if (stored.kind === "agent-task-inbox") { const inbox = reference as AgentTaskInboxReference; const task = await taskAuthority(stateRoot, meshId, inbox.taskId); retain = !task || task.agentId === inbox.agentId && (task.state === undefined || task.state === "created"); }
        else if (stored.kind === "endpoint-events") { const eventReference = reference as EndpointEventReference; const event = await eventAuthority(stateRoot, meshId, eventReference.eventId); const target: EndpointTarget = { endpointId: eventReference.endpointId, endpointSessionFile: eventReference.endpointSessionFile, bindingId: eventReference.bindingId }; retain = await viableBinding(stateRoot, meshId, target) && (!event || event.endpointId === target.endpointId && event.endpointSessionFile === target.endpointSessionFile && event.bindingId === target.bindingId && event.state !== "acknowledged"); }
        else { const taskReference = reference as CompletionQueueReference | EndpointTaskReference; const task = await taskAuthority(stateRoot, meshId, taskReference.taskId); const target: EndpointTarget = { endpointId: taskReference.endpointId, endpointSessionFile: taskReference.endpointSessionFile, bindingId: taskReference.bindingId }; const completion = task?.completion; retain = await viableBinding(stateRoot, meshId, target) && (!task || task.agentId === taskReference.agentId && completion?.endpointId === target.endpointId && completion.endpointSessionFile === target.endpointSessionFile && completion.bindingId === target.bindingId && (stored.kind === "completion-queue" || task.state === undefined || !isTerminalTask(task.state)));
        }
        if (!retain) { await rm(stored.path, { force: true }); removed += 1; }
    }
    let created = 0;
    for (const taskId of (await names(join(root, "tasks"))).filter(name => UUID.test(name))) {
        const task = await taskAuthority(stateRoot, meshId, taskId); if (!task) continue;
        if (task.state === "created") { await indexTaskSubmission(stateRoot, meshId, { agentId: task.agentId, taskId, createdAt: task.createdAt, ...(task.completion ? { completion: task.completion } : {}) }); created += 1; }
        else if (task.completion && await viableBinding(stateRoot, meshId, task.completion)) {
            if (task.state && isTerminalTask(task.state)) {
                if (!await assignedCompletion(stateRoot, meshId, taskId)) { await indexTerminalTransition(stateRoot, meshId, { agentId: task.agentId, taskId, queuedAt: task.finishedAt ?? task.createdAt, completion: task.completion }); created += 1; }
            } else { await persist("endpoint-tasks", stateRoot, meshId, { schemaVersion: 1, meshId, ...task.completion, taskId, agentId: task.agentId, createdAt: task.createdAt }); created += 1; }
        }
    }
    for (const name of (await names(join(root, "events"))).filter(value => UUID.test(value.replace(/\.json$/u, "")))) {
        const eventId = name.replace(/\.json$/u, ""); const event = await eventAuthority(stateRoot, meshId, eventId); if (!event || event.state === "acknowledged") continue;
        const target = { endpointId: event.endpointId, endpointSessionFile: event.endpointSessionFile, bindingId: event.bindingId }; if (!await viableBinding(stateRoot, meshId, target)) continue;
        await indexEventCreation(stateRoot, meshId, { ...target, eventId, createdAt: event.createdAt }); created += 1;
    }
    await pruneEndpointInboxDirectories(stateRoot, meshId);
    return { created, removed };
}

async function assignedCompletion(stateRoot: string, meshId: string, taskId: string): Promise<boolean> { const deliveries = join(indexRoot(stateRoot, meshId), "deliveries"); for (const name of (await names(deliveries)).filter(name => SHA256.test(name.replace(/\.json$/u, "")))) { const raw = await readOptionalJson<Record<string, unknown>>(join(deliveries, name)); const assignments = [...(Array.isArray(raw?.batches) ? raw.batches : []), ...(Array.isArray(raw?.receipts) ? raw.receipts : [])]; if (assignments.some(item => item && typeof item === "object" && Array.isArray((item as Record<string, unknown>).taskIds) && ((item as Record<string, unknown>).taskIds as unknown[]).includes(taskId))) return true; } return false; }
/** Removes retired references after first repairing malformed, misplaced, and obsolete-binding index evidence. */
export async function collectRetiredOrchestrationIndexReferences(stateRoot: string, meshId: string): Promise<number> {
    const reconciled = await reconcileOrchestrationIndexes(stateRoot, meshId); let removed = reconciled.removed;
    for (const item of await indexReferenceFiles(stateRoot, meshId)) {
        const stored = await readStoredReference(stateRoot, meshId, item); if (!stored) continue;
        const reference = stored.reference;
        let retired = false;
        if (stored.kind === "endpoint-events") { const event = await eventAuthority(stateRoot, meshId, (reference as EndpointEventReference).eventId); retired = event?.state === "acknowledged"; }
        else { const taskReference = reference as AgentTaskInboxReference | CompletionQueueReference | EndpointTaskReference; const task = await taskAuthority(stateRoot, meshId, taskReference.taskId); if (stored.kind === "agent-task-inbox") retired = Boolean(task && task.state !== undefined && task.state !== "created"); else if (stored.kind === "endpoint-tasks") retired = Boolean(task?.state && isTerminalTask(task.state)); else retired = Boolean(task?.state && isTerminalTask(task.state) && await assignedCompletion(stateRoot, meshId, taskReference.taskId)); }
        if (retired) { await rm(stored.path, { force: true }); removed += 1; }
    }
    await pruneEndpointInboxDirectories(stateRoot, meshId);
    return removed;
}
