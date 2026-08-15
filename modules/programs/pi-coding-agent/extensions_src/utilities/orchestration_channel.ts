import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "./agent_types.ts";
import { writeAtomicJson } from "./orchestration_json.ts";
import { assertExpectedEndpointBindingUnlocked, hasExpectedEndpointBindingUnlocked } from "./orchestration_binding.ts";
import { meshDirectory, withMeshLock } from "./orchestration_lock.ts";
import { CHANNEL_KEYS, TASK_STATES, isTerminalTask, type ChannelKey, type CompletionBatch, type CompletionLedger, type CompletionReceipt, type CompletionReceiptToolName, type CompletionRoute, type TaskState } from "./orchestration_types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const RECEIPT_TOOLS: readonly CompletionReceiptToolName[] = ["mesh_get", "mesh_wait", "mesh_channel"];

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

export interface OpenChannelSummary {
    channel: ChannelKey;
    terminal: number;
    total: number;
}

export interface CompletionReceiptCreationResult {
    receipt?: CompletionReceipt;
    created: boolean;
    receivedTaskIds: string[];
}

export interface PersistedCompletionReceiptEvidence {
    toolCallId: string;
    toolName: CompletionReceiptToolName;
    receivedTaskIds: string[];
    claimedTaskIds: string[];
}

export interface CompletionReceiptInput {
    endpointId: string;
    endpointSessionFile: string;
    claimantSessionFile: string;
    toolCallId: string;
    toolName: CompletionReceiptToolName;
    canonicalArguments: unknown;
    taskIds: string[];
    maxTasksPerMesh: number;
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

function uuid(value: unknown, label: string): string {
    const result = text(value, label);
    if (!UUID.test(result)) throw new Error(`${label} must be a UUID`);
    return result;
}

function timestamp(value: unknown, label: string): string {
    const result = text(value, label);
    if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO timestamp`);
    return result;
}

function exactKeys(raw: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string): void {
    if (required.some(key => !(key in raw)) || Object.keys(raw).some(key => !required.includes(key) && !optional.includes(key))) throw new Error(`${label} has invalid keys`);
}

function taskIds(value: unknown, label: string, allowEmpty = false): string[] {
    if (!Array.isArray(value) || !allowEmpty && value.length < 1) throw new Error(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
    const result = value.map(item => uuid(item, label));
    if (new Set(result).size !== result.length) throw new Error(`${label} must not contain duplicates`);
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
    exactKeys(raw, required, ["channel", "eventId"], "completion batch");
    uuid(raw.batchId, "completion batchId");
    if (raw.disposition !== "event" && raw.disposition !== "flush" || raw.route !== "direct" && raw.route !== "channel") throw new Error("completion batch disposition or route is invalid");
    taskIds(raw.taskIds, "completion batch taskIds");
    timestamp(raw.settledAt, "completion batch settledAt");
    if (raw.route === "channel") validateChannelKey(raw.channel, "completion batch channel");
    else if (raw.channel !== undefined) throw new Error("direct completion batch must not contain channel");
    if (raw.disposition === "event") uuid(raw.eventId, "event completion batch eventId");
    else if (raw.eventId !== undefined) throw new Error("flush completion batch must not contain eventId");
    return value as CompletionBatch;
}

function validateReceipt(value: unknown): CompletionReceipt {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("completion receipt must be an object");
    const raw = value as Record<string, unknown>;
    exactKeys(raw, ["receiptId", "claimantSessionFile", "toolCallId", "toolName", "argumentsDigest", "taskIds", "receivedAt"], [], "completion receipt");
    uuid(raw.receiptId, "completion receiptId");
    text(raw.claimantSessionFile, "completion receipt claimantSessionFile");
    text(raw.toolCallId, "completion receipt toolCallId");
    if (!RECEIPT_TOOLS.includes(raw.toolName as CompletionReceiptToolName)) throw new Error("completion receipt toolName is invalid");
    if (typeof raw.argumentsDigest !== "string" || !SHA256.test(raw.argumentsDigest)) throw new Error("completion receipt argumentsDigest is invalid");
    taskIds(raw.taskIds, "completion receipt taskIds");
    timestamp(raw.receivedAt, "completion receipt receivedAt");
    return value as CompletionReceipt;
}

function validateLedger(value: unknown, meshId: string, endpointId?: string, endpointSessionFile?: string): CompletionLedger {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("completion ledger must be an object");
    const raw = value as Record<string, unknown>;
    const common = ["schemaVersion", "meshId", "endpointId", "endpointSessionFile", "batches", "updatedAt"];
    if (raw.schemaVersion === 1) exactKeys(raw, common, [], "completion ledger");
    else if (raw.schemaVersion === 2) exactKeys(raw, [...common, "receipts"], [], "completion ledger");
    else throw new Error("completion ledger is invalid");
    if (raw.meshId !== meshId) throw new Error("completion ledger is invalid");
    if (endpointId !== undefined && raw.endpointId !== endpointId || endpointSessionFile !== undefined && raw.endpointSessionFile !== endpointSessionFile) throw new Error("completion ledger identity does not match path");
    const normalizedEndpointId = text(raw.endpointId, "completion ledger endpointId");
    const normalizedSessionFile = text(raw.endpointSessionFile, "completion ledger endpointSessionFile");
    const updatedAt = timestamp(raw.updatedAt, "completion ledger updatedAt");
    if (!Array.isArray(raw.batches)) throw new Error("completion ledger batches must be an array");
    const batches = raw.batches.map(validateBatch);
    const receipts = raw.schemaVersion === 1 ? [] : Array.isArray(raw.receipts) ? raw.receipts.map(validateReceipt) : (() => { throw new Error("completion ledger receipts must be an array"); })();
    const batchTaskIds = batches.flatMap(batch => batch.taskIds);
    const receiptTaskIds = receipts.flatMap(receipt => receipt.taskIds);
    if (new Set(batchTaskIds).size !== batchTaskIds.length) throw new Error("completion ledger assigns a task more than once");
    if (new Set(receiptTaskIds).size !== receiptTaskIds.length) throw new Error("completion ledger receives a task more than once");
    if (new Set(receipts.map(receipt => receipt.receiptId)).size !== receipts.length) throw new Error("completion ledger repeats a receipt ID");
    const retryKeys = receipts.map(receipt => `${receipt.claimantSessionFile}\0${receipt.toolCallId}`);
    if (new Set(retryKeys).size !== retryKeys.length) throw new Error("completion ledger repeats a receipt tool call");
    return { schemaVersion: 2, meshId, endpointId: normalizedEndpointId, endpointSessionFile: normalizedSessionFile, batches, receipts, updatedAt };
}

function emptyLedger(meshId: string, endpointId: string, endpointSessionFile: string): CompletionLedger {
    return { schemaVersion: 2, meshId, endpointId, endpointSessionFile, batches: [], receipts: [], updatedAt: new Date().toISOString() };
}

function assertLedgerBudget(ledger: CompletionLedger, maxTasksPerMesh: number): void {
    const distinct = new Set([...ledger.batches.flatMap(batch => batch.taskIds), ...ledger.receipts.flatMap(receipt => receipt.taskIds)]);
    if (distinct.size > maxTasksPerMesh) throw new Error(`Completion ledger exceeds mesh task budget (${maxTasksPerMesh})`);
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

function matchesRoute(task: CompletionTask, ledger: CompletionLedger, route?: CompletionRoute): boolean {
    return task.completion.endpointId === ledger.endpointId
        && task.completion.endpointSessionFile === ledger.endpointSessionFile
        && (route === undefined || task.completion.mode === route.mode && (route.mode === "direct" || task.completion.mode === "channel" && task.completion.channel === route.channel));
}

function unassignedTasks(tasks: readonly CompletionTask[], ledger: CompletionLedger, route?: CompletionRoute): CompletionTask[] {
    const assigned = new Set(ledger.batches.flatMap(batch => batch.taskIds));
    const received = new Set(ledger.receipts.flatMap(receipt => receipt.taskIds));
    return tasks.filter(task => !assigned.has(task.taskId) && !received.has(task.taskId) && matchesRoute(task, ledger, route));
}

function unreceivedTasks(tasks: readonly CompletionTask[], ledger: CompletionLedger, route?: CompletionRoute): CompletionTask[] {
    const received = new Set(ledger.receipts.flatMap(receipt => receipt.taskIds));
    return tasks.filter(task => !received.has(task.taskId) && matchesRoute(task, ledger, route));
}

export interface CompletionSettlement {
    ledgersPersisted: boolean;
    eventBatches: Array<{ ledger: CompletionLedger; batch: CompletionBatch; tasks: CompletionTask[]; openChannels: OpenChannelSummary[] }>;
}

function openChannelSummaries(tasks: readonly CompletionTask[], ledger: CompletionLedger): OpenChannelSummary[] {
    return CHANNEL_KEYS.flatMap(channel => {
        const route = { endpointId: ledger.endpointId, endpointSessionFile: ledger.endpointSessionFile, mode: "channel" as const, channel };
        const cohort = unassignedTasks(tasks, ledger, route);
        if (!cohort.length) return [];
        const terminal = cohort.filter(task => isTerminalTask(task.state)).length;
        if (terminal >= cohort.length) throw new Error(`Completion channel ${channel} remained settleable after settlement`);
        return [{ channel, terminal, total: cohort.length }];
    });
}

/** Caller must hold the mesh lock. Persists event IDs before any event file is materialized. */
export async function settleCompletionDeliveriesUnlocked(stateRoot: string, meshId: string, maxTasksPerMesh: number): Promise<CompletionSettlement> {
    const tasks = await completionTasksUnlocked(stateRoot, meshId);
    const eventBatches: CompletionSettlement["eventBatches"] = [];
    let ledgersPersisted = false;
    for (const identity of await ledgerIdentitiesUnlocked(stateRoot, meshId, tasks)) {
        if (!await hasExpectedEndpointBindingUnlocked(stateRoot, meshId, identity)) continue;
        let ledger = await readCompletionLedger(stateRoot, meshId, identity.endpointId, identity.endpointSessionFile) ?? emptyLedger(meshId, identity.endpointId, identity.endpointSessionFile);
        let changed = false;
        for (const task of unassignedTasks(tasks, ledger, { ...identity, mode: "direct" }).filter(task => isTerminalTask(task.state))) {
            const settledAt = new Date().toISOString();
            ledger = { ...ledger, batches: [...ledger.batches, { batchId: randomUUID(), disposition: "event", route: "direct", taskIds: [task.taskId], settledAt, eventId: randomUUID() }], updatedAt: settledAt };
            changed = true;
        }
        const channels = new Set(tasks.filter(task => matchesRoute(task, ledger) && task.completion.mode === "channel").map(task => (task.completion as Extract<CompletionRoute, { mode: "channel" }>).channel));
        for (const channel of channels) {
            const cohort = unassignedTasks(tasks, ledger, { ...identity, mode: "channel", channel });
            if (cohort.length && cohort.every(task => isTerminalTask(task.state))) {
                const settledAt = new Date().toISOString();
                ledger = { ...ledger, batches: [...ledger.batches, { batchId: randomUUID(), disposition: "event", route: "channel", channel, taskIds: cohort.map(task => task.taskId), settledAt, eventId: randomUUID() }], updatedAt: settledAt };
                changed = true;
            }
        }
        assertLedgerBudget(ledger, maxTasksPerMesh);
        if (changed) {
            await writeAtomicJson(completionLedgerPath(stateRoot, meshId, identity.endpointId, identity.endpointSessionFile), ledger);
            ledgersPersisted = true;
        }
        const openChannels = openChannelSummaries(tasks, ledger);
        for (const batch of ledger.batches.filter(batch => batch.disposition === "event")) {
            const batchTasks = tasks.filter(task => batch.taskIds.includes(task.taskId));
            if (batchTasks.length === batch.taskIds.length) eventBatches.push({ ledger, batch, tasks: batchTasks, openChannels });
        }
    }
    return { ledgersPersisted, eventBatches };
}

function argumentsDigest(value: unknown): string {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

async function createCompletionReceiptUnlocked(stateRoot: string, meshId: string, input: CompletionReceiptInput, tasks?: readonly CompletionTask[]): Promise<CompletionReceiptCreationResult> {
    await assertExpectedEndpointBindingUnlocked(stateRoot, meshId, input);
    text(input.claimantSessionFile, "completion receipt claimantSessionFile");
    text(input.toolCallId, "completion receipt toolCallId");
    if (!RECEIPT_TOOLS.includes(input.toolName)) throw new Error("completion receipt toolName is invalid");
    if (!Number.isInteger(input.maxTasksPerMesh) || input.maxTasksPerMesh < 1) throw new Error("maxTasksPerMesh must be a positive integer");
    const requestedIds = taskIds(input.taskIds, "completion receipt taskIds");
    if (requestedIds.length > 16) throw new Error("completion receipt accepts at most 16 tasks");
    let ledger = await readCompletionLedger(stateRoot, meshId, input.endpointId, input.endpointSessionFile) ?? emptyLedger(meshId, input.endpointId, input.endpointSessionFile);
    const digest = argumentsDigest(input.canonicalArguments);
    const existing = ledger.receipts.find(receipt => receipt.claimantSessionFile === input.claimantSessionFile && receipt.toolCallId === input.toolCallId);
    if (existing && (existing.toolName !== input.toolName || existing.argumentsDigest !== digest)) throw new Error(`${input.toolName} retry reused toolCallId with different arguments`);
    const currentTasks = tasks ?? await completionTasksUnlocked(stateRoot, meshId);
    const byId = new Map(currentTasks.map(task => [task.taskId, task]));
    for (const taskId of existing?.taskIds ?? requestedIds) {
        const task = byId.get(taskId);
        if (!task || task.completion.endpointId !== input.endpointId || task.completion.endpointSessionFile !== input.endpointSessionFile) throw new Error(`Task ${taskId} is not routed to the caller endpoint session`);
        if (!isTerminalTask(task.state)) throw new Error(`Task ${taskId} is not terminal`);
    }
    if (existing) return { receipt: existing, created: false, receivedTaskIds: [] };
    const received = new Set(ledger.receipts.flatMap(receipt => receipt.taskIds));
    const newlyReceived = requestedIds.filter(taskId => !received.has(taskId));
    if (!newlyReceived.length) return { created: false, receivedTaskIds: [] };
    const receivedAt = new Date().toISOString();
    const receipt: CompletionReceipt = { receiptId: randomUUID(), claimantSessionFile: input.claimantSessionFile, toolCallId: input.toolCallId, toolName: input.toolName, argumentsDigest: digest, taskIds: newlyReceived, receivedAt };
    ledger = { ...ledger, receipts: [...ledger.receipts, receipt], updatedAt: receivedAt };
    assertLedgerBudget(ledger, input.maxTasksPerMesh);
    await writeAtomicJson(completionLedgerPath(stateRoot, meshId, input.endpointId, input.endpointSessionFile), ledger);
    return { receipt, created: true, receivedTaskIds: newlyReceived };
}

/** Atomically revalidates caller binding and terminal task state, then receipts only tasks not already received. */
export async function createCompletionReceipt(stateRoot: string, meshId: string, input: CompletionReceiptInput): Promise<CompletionReceiptCreationResult> {
    return withMeshLock(stateRoot, meshId, () => createCompletionReceiptUnlocked(stateRoot, meshId, input));
}

/** Removes only the named provisional receipt. Callers must rollback only a result whose `created` field was true. */
export async function rollbackCompletionReceipt(stateRoot: string, meshId: string, input: { endpointId: string; endpointSessionFile: string; receiptId: string }): Promise<boolean> {
    return withMeshLock(stateRoot, meshId, async () => {
        const receiptId = uuid(input.receiptId, "completion receiptId");
        const ledger = await readCompletionLedger(stateRoot, meshId, input.endpointId, input.endpointSessionFile);
        if (!ledger || !ledger.receipts.some(receipt => receipt.receiptId === receiptId)) return false;
        const updatedAt = new Date().toISOString();
        await writeAtomicJson(completionLedgerPath(stateRoot, meshId, input.endpointId, input.endpointSessionFile), { ...ledger, receipts: ledger.receipts.filter(receipt => receipt.receiptId !== receiptId), updatedAt });
        return true;
    });
}

/** Removes receipts for this claimant session that have no persisted tool-result receipt ID. */
export async function reconcileCompletionReceipts(stateRoot: string, meshId: string, input: { endpointId: string; endpointSessionFile: string; claimantSessionFile: string; persistedReceipts: ReadonlyMap<string, readonly PersistedCompletionReceiptEvidence[]> }): Promise<{ removedReceiptIds: string[] }> {
    return withMeshLock(stateRoot, meshId, async () => {
        await assertExpectedEndpointBindingUnlocked(stateRoot, meshId, input);
        text(input.claimantSessionFile, "completion receipt claimantSessionFile");
        for (const receiptId of input.persistedReceipts.keys()) uuid(receiptId, "persisted completion receiptId");
        const ledger = await readCompletionLedger(stateRoot, meshId, input.endpointId, input.endpointSessionFile);
        if (!ledger) return { removedReceiptIds: [] };
        const committed = (receipt: CompletionReceipt): boolean => (input.persistedReceipts.get(receipt.receiptId) ?? []).some(evidence => evidence.toolCallId === receipt.toolCallId && evidence.toolName === receipt.toolName && (evidence.receivedTaskIds.length === 0 || canonicalJson(evidence.receivedTaskIds) === canonicalJson(receipt.taskIds)) && evidence.claimedTaskIds.every(taskId => receipt.taskIds.includes(taskId)));
        const removed = ledger.receipts.filter(receipt => receipt.claimantSessionFile === input.claimantSessionFile && !committed(receipt));
        if (!removed.length) return { removedReceiptIds: [] };
        const removedIds = new Set(removed.map(receipt => receipt.receiptId));
        const updatedAt = new Date().toISOString();
        await writeAtomicJson(completionLedgerPath(stateRoot, meshId, input.endpointId, input.endpointSessionFile), { ...ledger, receipts: ledger.receipts.filter(receipt => !removedIds.has(receipt.receiptId)), updatedAt });
        return { removedReceiptIds: removed.map(receipt => receipt.receiptId) };
    });
}

export async function inspectCompletionChannels(stateRoot: string, meshId: string, input: { endpointId: string; endpointSessionFile: string; channel?: ChannelKey }): Promise<CompletionChannelProjection[]> {
    return withMeshLock(stateRoot, meshId, async () => {
        const tasks = await completionTasksUnlocked(stateRoot, meshId);
        const ledger = await readCompletionLedger(stateRoot, meshId, input.endpointId, input.endpointSessionFile) ?? emptyLedger(meshId, input.endpointId, input.endpointSessionFile);
        const channels = input.channel ? [validateChannelKey(input.channel)] : CHANNEL_KEYS;
        return channels.map(channel => {
            const route = { endpointId: input.endpointId, endpointSessionFile: input.endpointSessionFile, mode: "channel" as const, channel };
            const current = unreceivedTasks(tasks, ledger, route);
            return { channel, tasks: current, terminal: current.filter(task => isTerminalTask(task.state)).length, total: current.length };
        }).filter(projection => input.channel !== undefined || projection.total > 0);
    });
}

export interface CompletionChannelFlushResult extends CompletionReceiptCreationResult { tasks: CompletionTask[] }

/** Selects the oldest 16 unreceived terminal channel tasks and receipts them in the same mesh-lock transaction. */
export async function flushCompletionChannelWithReceipt(stateRoot: string, meshId: string, input: Omit<CompletionReceiptInput, "toolName" | "taskIds"> & { channel: ChannelKey }): Promise<CompletionChannelFlushResult> {
    return withMeshLock(stateRoot, meshId, async () => {
        const channel = validateChannelKey(input.channel);
        await assertExpectedEndpointBindingUnlocked(stateRoot, meshId, input);
        const tasks = await completionTasksUnlocked(stateRoot, meshId);
        const ledger = await readCompletionLedger(stateRoot, meshId, input.endpointId, input.endpointSessionFile) ?? emptyLedger(meshId, input.endpointId, input.endpointSessionFile);
        const existing = ledger.receipts.find(receipt => receipt.claimantSessionFile === input.claimantSessionFile && receipt.toolCallId === input.toolCallId);
        const route = { endpointId: input.endpointId, endpointSessionFile: input.endpointSessionFile, mode: "channel" as const, channel };
        const terminal = existing
            ? existing.taskIds.map(taskId => tasks.find(task => task.taskId === taskId)).filter((task): task is CompletionTask => task !== undefined)
            : unreceivedTasks(tasks, ledger, route).filter(task => isTerminalTask(task.state)).slice(0, 16);
        if (!terminal.length && !existing) return { tasks: [], created: false, receivedTaskIds: [] };
        const receipt = await createCompletionReceiptUnlocked(stateRoot, meshId, { ...input, toolName: "mesh_channel", taskIds: existing?.taskIds ?? terminal.map(task => task.taskId) }, tasks);
        return { tasks: terminal, ...receipt };
    });
}
