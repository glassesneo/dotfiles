import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomicJson } from "./orchestration_json.ts";
import { assertExpectedEndpointBindingUnlocked, hasExpectedEndpointBindingUnlocked } from "./orchestration_binding.ts";
import { meshDirectory, withMeshLock } from "./orchestration_lock.ts";
import { CHANNEL_KEYS, TASK_STATES, isTerminalTask, type ChannelKey, type CompletionBatch, type CompletionLedger, type CompletionRoute, type TaskState } from "./orchestration_types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface CompletionTask {
    taskId: string;
    agentId: string;
    state: TaskState;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    completion: CompletionRoute;
}

export interface CompletionChannelProjection {
    channel: ChannelKey;
    tasks: CompletionTask[];
    terminal: number;
    total: number;
}

function deliveryKey(endpointId: string, endpointSessionFile: string): string {
    return createHash("sha256").update(`${endpointId}\0${endpointSessionFile}`).digest("hex");
}

export function completionLedgerPath(stateRoot: string, meshId: string, endpointId: string, endpointSessionFile: string): string {
    return join(meshDirectory(stateRoot, meshId), "deliveries", `${deliveryKey(endpointId, endpointSessionFile)}.json`);
}

async function optionalJson(path: string): Promise<unknown> {
    return readFile(path, "utf8").then(text => JSON.parse(text) as unknown).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : Promise.reject(error));
}

function text(value: unknown, label: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
    return value;
}

function timestamp(value: unknown, label: string): string {
    const result = text(value, label);
    if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO timestamp`);
    return result;
}

export function validateChannelKey(value: unknown, label = "channel"): ChannelKey {
    if (typeof value !== "string" || !CHANNEL_KEYS.includes(value as ChannelKey)) throw new Error(`${label} must be A-Z`);
    return value as ChannelKey;
}

export function validateCompletionRoute(value: unknown, requesterEndpointId?: string): CompletionRoute {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("task completion route must be an object");
    const raw = value as Record<string, unknown>;
    const required = ["endpointId", "endpointSessionFile", "mode"];
    const allowed = raw.mode === "channel" ? [...required, "channel"] : required;
    if (required.some(key => !(key in raw)) || Object.keys(raw).some(key => !allowed.includes(key))) throw new Error("task completion route has invalid keys");
    const endpointId = text(raw.endpointId, "task completion endpointId");
    const endpointSessionFile = text(raw.endpointSessionFile, "task completion endpointSessionFile");
    if (requesterEndpointId !== undefined && endpointId !== requesterEndpointId) throw new Error("task completion endpoint must match requester endpoint");
    if (raw.mode === "direct") return { endpointId, endpointSessionFile, mode: "direct" };
    if (raw.mode === "channel") return { endpointId, endpointSessionFile, mode: "channel", channel: validateChannelKey(raw.channel, "task completion channel") };
    throw new Error("task completion mode is invalid");
}

function validateBatch(value: unknown): CompletionBatch {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("completion batch must be an object");
    const raw = value as Record<string, unknown>;
    const required = ["batchId", "disposition", "route", "taskIds", "settledAt"];
    const optional = ["channel", "eventId"];
    if (required.some(key => !(key in raw)) || Object.keys(raw).some(key => !required.includes(key) && !optional.includes(key))) throw new Error("completion batch has invalid keys");
    if (!UUID.test(text(raw.batchId, "completion batchId"))) throw new Error("completion batchId must be a UUID");
    if (raw.disposition !== "event" && raw.disposition !== "flush" || raw.route !== "direct" && raw.route !== "channel") throw new Error("completion batch disposition or route is invalid");
    if (!Array.isArray(raw.taskIds) || raw.taskIds.length < 1 || raw.taskIds.some(taskId => typeof taskId !== "string" || !UUID.test(taskId))) throw new Error("completion batch taskIds are invalid");
    if (new Set(raw.taskIds).size !== raw.taskIds.length) throw new Error("completion batch taskIds must not contain duplicates");
    timestamp(raw.settledAt, "completion batch settledAt");
    if (raw.route === "channel") validateChannelKey(raw.channel, "completion batch channel");
    else if (raw.channel !== undefined) throw new Error("direct completion batch must not contain channel");
    if (raw.disposition === "event") { if (typeof raw.eventId !== "string" || !UUID.test(raw.eventId)) throw new Error("event completion batch requires eventId"); }
    else if (raw.eventId !== undefined) throw new Error("flush completion batch must not contain eventId");
    return value as CompletionBatch;
}

function validateLedger(value: unknown, meshId: string, endpointId?: string, endpointSessionFile?: string): CompletionLedger {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("completion ledger must be an object");
    const raw = value as Record<string, unknown>;
    const keys = ["schemaVersion", "meshId", "endpointId", "endpointSessionFile", "batches", "updatedAt"];
    if (Object.keys(raw).some(key => !keys.includes(key)) || keys.some(key => !(key in raw)) || raw.schemaVersion !== 1 || raw.meshId !== meshId) throw new Error("completion ledger is invalid");
    if (endpointId !== undefined && raw.endpointId !== endpointId || endpointSessionFile !== undefined && raw.endpointSessionFile !== endpointSessionFile) throw new Error("completion ledger identity does not match path");
    text(raw.endpointId, "completion ledger endpointId"); text(raw.endpointSessionFile, "completion ledger endpointSessionFile"); timestamp(raw.updatedAt, "completion ledger updatedAt");
    if (!Array.isArray(raw.batches)) throw new Error("completion ledger batches must be an array");
    const batches = raw.batches.map(validateBatch);
    const taskIds = batches.flatMap(batch => batch.taskIds);
    if (new Set(taskIds).size !== taskIds.length) throw new Error("completion ledger settles a task more than once");
    return value as CompletionLedger;
}

export async function readCompletionLedger(stateRoot: string, meshId: string, endpointId: string, endpointSessionFile: string): Promise<CompletionLedger | undefined> {
    const value = await optionalJson(completionLedgerPath(stateRoot, meshId, endpointId, endpointSessionFile));
    return value === undefined ? undefined : validateLedger(value, meshId, endpointId, endpointSessionFile);
}

async function completionTasksUnlocked(stateRoot: string, meshId: string): Promise<CompletionTask[]> {
    const tasksDirectory = join(meshDirectory(stateRoot, meshId), "tasks");
    const names = await readdir(tasksDirectory).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : Promise.reject(error));
    const tasks = await Promise.all(names.filter(name => UUID.test(name)).map(async taskId => {
        const directory = join(tasksDirectory, taskId);
        const requestValue = await optionalJson(join(directory, "request.json"));
        if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) return undefined;
        const request = requestValue as Record<string, unknown>;
        if (request.schemaVersion !== 2 || request.completion === undefined) return undefined;
        if (request.taskId !== taskId || typeof request.agentId !== "string" || !UUID.test(request.agentId) || typeof request.requesterEndpointId !== "string") throw new Error("routed task request identity is invalid");
        const statusValue = await optionalJson(join(directory, "status.json"));
        if (!statusValue || typeof statusValue !== "object" || Array.isArray(statusValue)) return undefined;
        const status = statusValue as Record<string, unknown>;
        if (status.taskId !== taskId || status.agentId !== request.agentId || typeof status.state !== "string" || !TASK_STATES.includes(status.state as TaskState)) throw new Error("routed task status is invalid");
        const createdAt = timestamp(status.createdAt, "routed task createdAt");
        const startedAt = status.startedAt === undefined ? undefined : timestamp(status.startedAt, "routed task startedAt");
        const finishedAt = status.finishedAt === undefined ? undefined : timestamp(status.finishedAt, "routed task finishedAt");
        return { taskId, agentId: request.agentId, state: status.state as TaskState, createdAt, ...(startedAt ? { startedAt } : {}), ...(finishedAt ? { finishedAt } : {}), completion: validateCompletionRoute(request.completion, request.requesterEndpointId) } satisfies CompletionTask;
    }));
    return tasks.filter((task): task is CompletionTask => task !== undefined).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.taskId.localeCompare(b.taskId));
}

async function ledgerIdentitiesUnlocked(stateRoot: string, meshId: string, tasks: readonly CompletionTask[]): Promise<Array<{ endpointId: string; endpointSessionFile: string }>> {
    const identities = new Map<string, { endpointId: string; endpointSessionFile: string }>();
    for (const task of tasks) identities.set(deliveryKey(task.completion.endpointId, task.completion.endpointSessionFile), { endpointId: task.completion.endpointId, endpointSessionFile: task.completion.endpointSessionFile });
    const directory = join(meshDirectory(stateRoot, meshId), "deliveries");
    const names = await readdir(directory).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : Promise.reject(error));
    for (const name of names.filter(name => /^[0-9a-f]{64}\.json$/u.test(name))) {
        const value = validateLedger(await optionalJson(join(directory, name)), meshId);
        const expected = `${deliveryKey(value.endpointId, value.endpointSessionFile)}.json`;
        if (name !== expected) throw new Error("completion ledger identity does not match path");
        identities.set(name.slice(0, -5), value);
    }
    return [...identities.values()];
}

function currentTasks(tasks: readonly CompletionTask[], ledger: CompletionLedger, route?: CompletionRoute): CompletionTask[] {
    const settled = new Set(ledger.batches.flatMap(batch => batch.taskIds));
    return tasks.filter(task => !settled.has(task.taskId)
        && task.completion.endpointId === ledger.endpointId
        && task.completion.endpointSessionFile === ledger.endpointSessionFile
        && (route === undefined || task.completion.mode === route.mode && (route.mode === "direct" || task.completion.mode === "channel" && task.completion.channel === route.channel)));
}

export interface CompletionSettlement {
    ledgersPersisted: boolean;
    eventBatches: Array<{ ledger: CompletionLedger; batch: CompletionBatch; tasks: CompletionTask[] }>;
}

/** Caller must hold the mesh lock. Persists event IDs before any event file is materialized. */
export async function settleCompletionDeliveriesUnlocked(stateRoot: string, meshId: string, maxTasksPerMesh: number): Promise<CompletionSettlement> {
    const tasks = await completionTasksUnlocked(stateRoot, meshId);
    const eventBatches: CompletionSettlement["eventBatches"] = [];
    let ledgersPersisted = false;
    for (const identity of await ledgerIdentitiesUnlocked(stateRoot, meshId, tasks)) {
        if (!await hasExpectedEndpointBindingUnlocked(stateRoot, meshId, identity)) continue;
        let ledger = await readCompletionLedger(stateRoot, meshId, identity.endpointId, identity.endpointSessionFile) ?? { schemaVersion: 1, meshId, ...identity, batches: [], updatedAt: new Date().toISOString() };
        let changed = false;
        const settled = new Set(ledger.batches.flatMap(batch => batch.taskIds));
        for (const task of tasks.filter(task => task.completion.endpointId === identity.endpointId && task.completion.endpointSessionFile === identity.endpointSessionFile && task.completion.mode === "direct" && !settled.has(task.taskId) && isTerminalTask(task.state))) {
            const settledAt = new Date().toISOString();
            ledger = { ...ledger, batches: [...ledger.batches, { batchId: randomUUID(), disposition: "event", route: "direct", taskIds: [task.taskId], settledAt, eventId: randomUUID() }], updatedAt: settledAt };
            settled.add(task.taskId); changed = true;
        }
        const channels = new Set(tasks.filter(task => task.completion.endpointId === identity.endpointId && task.completion.endpointSessionFile === identity.endpointSessionFile && task.completion.mode === "channel").map(task => (task.completion as Extract<CompletionRoute, { mode: "channel" }>).channel));
        for (const channel of channels) {
            const cohort = tasks.filter(task => !settled.has(task.taskId) && task.completion.endpointId === identity.endpointId && task.completion.endpointSessionFile === identity.endpointSessionFile && task.completion.mode === "channel" && task.completion.channel === channel);
            if (cohort.length && cohort.every(task => isTerminalTask(task.state))) {
                const settledAt = new Date().toISOString();
                ledger = { ...ledger, batches: [...ledger.batches, { batchId: randomUUID(), disposition: "event", route: "channel", channel, taskIds: cohort.map(task => task.taskId), settledAt, eventId: randomUUID() }], updatedAt: settledAt };
                for (const task of cohort) settled.add(task.taskId); changed = true;
            }
        }
        if (ledger.batches.length > maxTasksPerMesh) throw new Error(`Completion ledger exceeds mesh task budget (${maxTasksPerMesh})`);
        if (changed) { await writeAtomicJson(completionLedgerPath(stateRoot, meshId, identity.endpointId, identity.endpointSessionFile), ledger); ledgersPersisted = true; }
        for (const batch of ledger.batches.filter(batch => batch.disposition === "event")) {
            const batchTasks = tasks.filter(task => batch.taskIds.includes(task.taskId));
            if (batchTasks.length === batch.taskIds.length) eventBatches.push({ ledger, batch, tasks: batchTasks });
        }
    }
    return { ledgersPersisted, eventBatches };
}

export async function inspectCompletionChannels(stateRoot: string, meshId: string, input: { endpointId: string; endpointSessionFile: string; channel?: ChannelKey }): Promise<CompletionChannelProjection[]> {
    return withMeshLock(stateRoot, meshId, async () => {
        const tasks = await completionTasksUnlocked(stateRoot, meshId);
        const ledger = await readCompletionLedger(stateRoot, meshId, input.endpointId, input.endpointSessionFile) ?? { schemaVersion: 1, meshId, endpointId: input.endpointId, endpointSessionFile: input.endpointSessionFile, batches: [], updatedAt: new Date().toISOString() };
        const channels = input.channel ? [validateChannelKey(input.channel)] : CHANNEL_KEYS;
        return channels.map(channel => {
            const route = { endpointId: input.endpointId, endpointSessionFile: input.endpointSessionFile, mode: "channel" as const, channel };
            const current = currentTasks(tasks, ledger, route);
            return { channel, tasks: current, terminal: current.filter(task => isTerminalTask(task.state)).length, total: current.length };
        }).filter(projection => input.channel !== undefined || projection.total > 0);
    });
}

export async function flushCompletionChannel(stateRoot: string, meshId: string, input: { endpointId: string; endpointSessionFile: string; channel: ChannelKey; maxTasksPerMesh: number }): Promise<CompletionTask[]> {
    return withMeshLock(stateRoot, meshId, async () => {
        const channel = validateChannelKey(input.channel);
        await assertExpectedEndpointBindingUnlocked(stateRoot, meshId, input);
        const tasks = await completionTasksUnlocked(stateRoot, meshId);
        let ledger = await readCompletionLedger(stateRoot, meshId, input.endpointId, input.endpointSessionFile) ?? { schemaVersion: 1 as const, meshId, endpointId: input.endpointId, endpointSessionFile: input.endpointSessionFile, batches: [], updatedAt: new Date().toISOString() };
        const route = { endpointId: input.endpointId, endpointSessionFile: input.endpointSessionFile, mode: "channel" as const, channel };
        const terminal = currentTasks(tasks, ledger, route).filter(task => isTerminalTask(task.state));
        if (!terminal.length) return [];
        const settledAt = new Date().toISOString();
        ledger = { ...ledger, batches: [...ledger.batches, { batchId: randomUUID(), disposition: "flush", route: "channel", channel, taskIds: terminal.map(task => task.taskId), settledAt }], updatedAt: settledAt };
        if (ledger.batches.length > input.maxTasksPerMesh) throw new Error(`Completion ledger exceeds mesh task budget (${input.maxTasksPerMesh})`);
        await writeAtomicJson(completionLedgerPath(stateRoot, meshId, input.endpointId, input.endpointSessionFile), ledger);
        return terminal;
    });
}
