import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "./agent_types.ts";
import { assertExpectedEndpointBindingUnlocked, hasExpectedEndpointBindingUnlocked } from "./orchestration_binding.ts";
import { writeAtomicJson } from "./orchestration_json.ts";
import { meshDirectory, withMeshLock } from "./orchestration_lock.ts";
import { TASK_STATES, isTerminalTask, type CompletionBatch, type CompletionLedger, type CompletionReceipt, type CompletionReceiptToolName, type CompletionTarget, type TaskState } from "./orchestration_types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const RECEIPT_TOOLS: readonly CompletionReceiptToolName[] = ["mesh_get", "mesh_wait"];

export interface CompletionTask {
    taskId: string;
    agentId: string;
    state: TaskState;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    completion: CompletionTarget;
    suppressCompletion: boolean;
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

function taskIds(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.length < 1) throw new Error(`${label} must be a non-empty array`);
    const result = value.map(item => uuid(item, label));
    if (new Set(result).size !== result.length) throw new Error(`${label} must not contain duplicates`);
    return result;
}

/** Validates the channel-free endpoint/session completion target. */
export function validateCompletionTarget(value: unknown, requesterEndpointId?: string): CompletionTarget {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("task completion target must be an object");
    const raw = value as Record<string, unknown>;
    exactKeys(raw, ["endpointId", "endpointSessionFile"], [], "task completion target");
    const endpointId = text(raw.endpointId, "task completion endpointId");
    const endpointSessionFile = text(raw.endpointSessionFile, "task completion endpointSessionFile");
    if (requesterEndpointId !== undefined && endpointId !== requesterEndpointId) throw new Error("task completion endpoint must match requester endpoint");
    return { endpointId, endpointSessionFile };
}

function validateBatch(value: unknown): CompletionBatch {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("completion batch must be an object");
    const raw = value as Record<string, unknown>;
    exactKeys(raw, ["batchId", "taskIds", "settledAt", "eventId"], [], "completion batch");
    uuid(raw.batchId, "completion batchId");
    taskIds(raw.taskIds, "completion batch taskIds");
    timestamp(raw.settledAt, "completion batch settledAt");
    uuid(raw.eventId, "completion batch eventId");
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
    exactKeys(raw, ["schemaVersion", "meshId", "endpointId", "endpointSessionFile", "batches", "receipts", "updatedAt"], [], "completion ledger");
    if (raw.schemaVersion !== 3 || raw.meshId !== meshId) throw new Error("Unsupported completion ledger schemaVersion");
    if (endpointId !== undefined && raw.endpointId !== endpointId || endpointSessionFile !== undefined && raw.endpointSessionFile !== endpointSessionFile) throw new Error("completion ledger identity does not match path");
    const normalizedEndpointId = text(raw.endpointId, "completion ledger endpointId");
    const normalizedSessionFile = text(raw.endpointSessionFile, "completion ledger endpointSessionFile");
    const updatedAt = timestamp(raw.updatedAt, "completion ledger updatedAt");
    if (!Array.isArray(raw.batches) || !Array.isArray(raw.receipts)) throw new Error("completion ledger batches and receipts must be arrays");
    const batches = raw.batches.map(validateBatch);
    const receipts = raw.receipts.map(validateReceipt);
    const batchTaskIds = batches.flatMap(batch => batch.taskIds);
    const receiptTaskIds = receipts.flatMap(receipt => receipt.taskIds);
    if (new Set(batchTaskIds).size !== batchTaskIds.length) throw new Error("completion ledger assigns a task more than once");
    if (new Set(receiptTaskIds).size !== receiptTaskIds.length) throw new Error("completion ledger receives a task more than once");
    if (new Set(receipts.map(receipt => receipt.receiptId)).size !== receipts.length) throw new Error("completion ledger repeats a receipt ID");
    const retryKeys = receipts.map(receipt => `${receipt.claimantSessionFile}\0${receipt.toolCallId}`);
    if (new Set(retryKeys).size !== retryKeys.length) throw new Error("completion ledger repeats a receipt tool call");
    return { schemaVersion: 3, meshId, endpointId: normalizedEndpointId, endpointSessionFile: normalizedSessionFile, batches, receipts, updatedAt };
}

function emptyLedger(meshId: string, endpointId: string, endpointSessionFile: string): CompletionLedger {
    return { schemaVersion: 3, meshId, endpointId, endpointSessionFile, batches: [], receipts: [], updatedAt: new Date().toISOString() };
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
    const directory = join(meshDirectory(stateRoot, meshId), "tasks");
    const names = await readdir(directory).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : Promise.reject(error));
    const tasks = await Promise.all(names.filter(name => UUID.test(name)).map(async taskId => {
        const taskDirectory = join(directory, taskId);
        const requestValue = await optionalJson(join(taskDirectory, "request.json"));
        if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) return undefined;
        const request = requestValue as Record<string, unknown>;
        if (request.schemaVersion !== 3) throw new Error("Unsupported task request schemaVersion");
        if (request.completion === undefined) return undefined;
        if (request.taskId !== taskId || typeof request.agentId !== "string" || !UUID.test(request.agentId) || typeof request.requesterEndpointId !== "string") throw new Error("completion task request identity is invalid");
        const [statusValue, cancellationValue, stopValue] = await Promise.all([optionalJson(join(taskDirectory, "status.json")), optionalJson(join(meshDirectory(stateRoot, meshId), "tasks", taskId, "cancel.json")), optionalJson(join(meshDirectory(stateRoot, meshId), "agents", request.agentId, "stop.json"))]);
        if (!statusValue || typeof statusValue !== "object" || Array.isArray(statusValue)) return undefined;
        const status = statusValue as Record<string, unknown>;
        if (status.taskId !== taskId || status.agentId !== request.agentId || typeof status.state !== "string" || !TASK_STATES.includes(status.state as TaskState)) throw new Error("completion task status is invalid");
        const createdAt = timestamp(status.createdAt, "completion task createdAt");
        const startedAt = status.startedAt === undefined ? undefined : timestamp(status.startedAt, "completion task startedAt");
        const finishedAt = status.finishedAt === undefined ? undefined : timestamp(status.finishedAt, "completion task finishedAt");
        const completion = validateCompletionTarget(request.completion, request.requesterEndpointId);
        const cancelledByCompletionEndpoint = Boolean(cancellationValue && typeof cancellationValue === "object" && !Array.isArray(cancellationValue) && (cancellationValue as Record<string, unknown>).schemaVersion === 1 && (cancellationValue as Record<string, unknown>).meshId === meshId && (cancellationValue as Record<string, unknown>).agentId === request.agentId && (cancellationValue as Record<string, unknown>).taskId === taskId && (cancellationValue as Record<string, unknown>).requesterEndpointId === completion.endpointId);
        const stoppedByCompletionEndpoint = Boolean(stopValue && typeof stopValue === "object" && !Array.isArray(stopValue) && (stopValue as Record<string, unknown>).schemaVersion === 1 && (stopValue as Record<string, unknown>).meshId === meshId && (stopValue as Record<string, unknown>).agentId === request.agentId && (stopValue as Record<string, unknown>).state === "confirmed" && ((stopValue as Record<string, unknown>).source === "user" || (stopValue as Record<string, unknown>).source === "peer") && (stopValue as Record<string, unknown>).affectedTaskId === taskId && (stopValue as Record<string, unknown>).requesterEndpointId === completion.endpointId);
        return { taskId, agentId: request.agentId, state: status.state as TaskState, createdAt, ...(startedAt ? { startedAt } : {}), ...(finishedAt ? { finishedAt } : {}), completion, suppressCompletion: status.state === "stopped" && (cancelledByCompletionEndpoint || stoppedByCompletionEndpoint) } satisfies CompletionTask;
    }));
    return tasks.filter((task): task is CompletionTask => task !== undefined).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.taskId.localeCompare(b.taskId));
}

async function ledgerIdentitiesUnlocked(stateRoot: string, meshId: string, tasks: readonly CompletionTask[]): Promise<CompletionTarget[]> {
    const identities = new Map<string, CompletionTarget>();
    for (const task of tasks) identities.set(deliveryKey(task.completion.endpointId, task.completion.endpointSessionFile), task.completion);
    const directory = join(meshDirectory(stateRoot, meshId), "deliveries");
    const names = await readdir(directory).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : Promise.reject(error));
    for (const name of names.filter(name => /^[0-9a-f]{64}\.json$/u.test(name))) {
        const value = validateLedger(await optionalJson(join(directory, name)), meshId);
        if (name !== `${deliveryKey(value.endpointId, value.endpointSessionFile)}.json`) throw new Error("completion ledger identity does not match path");
        identities.set(name.slice(0, -5), value);
    }
    return [...identities.values()];
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
        let ledger = await readCompletionLedger(stateRoot, meshId, identity.endpointId, identity.endpointSessionFile) ?? emptyLedger(meshId, identity.endpointId, identity.endpointSessionFile);
        const assigned = new Set(ledger.batches.flatMap(batch => batch.taskIds));
        const received = new Set(ledger.receipts.flatMap(receipt => receipt.taskIds));
        const terminal = tasks.filter(task => task.completion.endpointId === identity.endpointId && task.completion.endpointSessionFile === identity.endpointSessionFile && isTerminalTask(task.state) && !task.suppressCompletion && !assigned.has(task.taskId) && !received.has(task.taskId));
        if (terminal.length) {
            const settledAt = new Date().toISOString();
            ledger = { ...ledger, batches: [...ledger.batches, { batchId: randomUUID(), taskIds: terminal.map(task => task.taskId), settledAt, eventId: randomUUID() }], updatedAt: settledAt };
            assertLedgerBudget(ledger, maxTasksPerMesh);
            await writeAtomicJson(completionLedgerPath(stateRoot, meshId, identity.endpointId, identity.endpointSessionFile), ledger);
            ledgersPersisted = true;
        }
        for (const batch of ledger.batches) {
            const batchTasks = batch.taskIds.map(taskId => tasks.find(task => task.taskId === taskId)).filter((task): task is CompletionTask => task !== undefined);
            if (batchTasks.length === batch.taskIds.length) eventBatches.push({ ledger, batch, tasks: batchTasks });
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

export async function createCompletionReceipt(stateRoot: string, meshId: string, input: CompletionReceiptInput): Promise<CompletionReceiptCreationResult> {
    return withMeshLock(stateRoot, meshId, () => createCompletionReceiptUnlocked(stateRoot, meshId, input));
}

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
