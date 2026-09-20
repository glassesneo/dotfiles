import { randomUUID } from "node:crypto";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { mapConcurrent } from "./concurrency.ts";
import { meshDirectory, withMeshLock } from "./orchestration_lock.ts";
import { readOptionalJson as optionalJson, writeAtomicJson as atomicJson } from "./orchestration_json.ts";
import { assertRootLeaseOwner, agentPaths, meshPaths, readAgentExecution, readAgentSnapshot, readAgentStatus, readMesh, readMeshReservation, readTask, taskPaths } from "./orchestration_store.ts";
import { readMeshEndpoint, readQuiescentDeliverySnapshotUnlocked } from "./orchestration_events.ts";
import { listPressureAdmissions } from "./orchestration_admission.ts";
import { isTerminalAgent, isTerminalTask, type AgentState } from "./orchestration_types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const READ_CONCURRENCY = 8;

export const PARENT_TRANSITION_FENCE_SCHEMA_VERSION = 1 as const;
export const PARENT_TRANSITION_REQUEST_EVENT = "neo.dotfiles.pi:parent-transition-request" as const;
export const PARENT_TRANSITION_RESULT_EVENT = "neo.dotfiles.pi:parent-transition-result" as const;
export type ParentTransitionKind = "mode" | "handoff";
export interface ParentTransitionFence {
    schemaVersion: 1;
    requestId: string;
    rootLeaseId: string;
    rootSessionId: string;
    kind: ParentTransitionKind;
    fromMode: string;
    targetMode?: string;
    token: string;
    createdAt: string;
}
export type ParentTransitionOperation = "prepare" | "apply" | "cancel";
export type ParentTransitionStatus = "prepared" | "rejected" | "applied" | "cancelled" | "failed";
export interface ParentTransitionRequest {
    schemaVersion: 1;
    operation: ParentTransitionOperation;
    requestId: string;
    token?: string;
    kind?: ParentTransitionKind;
    fromMode?: string;
    targetMode?: string;
}
export interface ParentTransitionResult {
    schemaVersion: 1;
    requestId: string;
    status: ParentTransitionStatus;
    token?: string;
    error?: string;
}

function uuid(value: unknown, label: string): string { if (typeof value !== "string" || !UUID.test(value)) throw new Error(`${label} must be a UUID`); return value; }
function text(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`); return value; }
function optionalText(value: unknown, label: string): string | undefined { return value === undefined ? undefined : text(value, label); }
function isoTimestamp(value: unknown, label: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`); return value; }

export function validateParentTransitionFence(value: unknown): ParentTransitionFence {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("parent transition fence must be an object");
    const raw = value as Record<string, unknown>;
    const allowed = ["schemaVersion", "requestId", "rootLeaseId", "rootSessionId", "kind", "fromMode", "targetMode", "token", "createdAt"];
    const unknown = Object.keys(raw).filter(key => !allowed.includes(key));
    if (unknown.length) throw new Error(`parent transition fence contains unknown keys: ${unknown.join(", ")}`);
    if (raw.schemaVersion !== PARENT_TRANSITION_FENCE_SCHEMA_VERSION) throw new Error("Unsupported parent transition fence schemaVersion");
    const requestId = uuid(raw.requestId, "parent transition fence requestId");
    const rootLeaseId = uuid(raw.rootLeaseId, "parent transition fence rootLeaseId");
    const rootSessionId = text(raw.rootSessionId, "parent transition fence rootSessionId");
    if (raw.kind !== "mode" && raw.kind !== "handoff") throw new Error("parent transition fence kind is invalid");
    const fromMode = text(raw.fromMode, "parent transition fence fromMode");
    const targetMode = optionalText(raw.targetMode, "parent transition fence targetMode");
    const token = uuid(raw.token, "parent transition fence token");
    const createdAt = isoTimestamp(raw.createdAt, "parent transition fence createdAt");
    return { schemaVersion: PARENT_TRANSITION_FENCE_SCHEMA_VERSION, requestId, rootLeaseId, rootSessionId, kind: raw.kind, fromMode, ...(targetMode !== undefined ? { targetMode } : {}), token, createdAt };
}
export function validateParentTransitionRequest(value: unknown): ParentTransitionRequest {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("parent transition request must be an object");
    const raw = value as Record<string, unknown>;
    const allowed = ["schemaVersion", "operation", "requestId", "token", "kind", "fromMode", "targetMode"];
    const unknown = Object.keys(raw).filter(key => !allowed.includes(key));
    if (unknown.length) throw new Error(`parent transition request contains unknown keys: ${unknown.join(", ")}`);
    if (raw.schemaVersion !== 1) throw new Error("Unsupported parent transition request schemaVersion");
    if (raw.operation !== "prepare" && raw.operation !== "apply" && raw.operation !== "cancel") throw new Error("parent transition request operation is invalid");
    const requestId = uuid(raw.requestId, "parent transition request requestId");
    const token = optionalText(raw.token, "parent transition request token");
    if (token !== undefined && !UUID.test(token)) throw new Error("parent transition request token must be a UUID");
    if (raw.kind !== undefined && raw.kind !== "mode" && raw.kind !== "handoff") throw new Error("parent transition request kind is invalid");
    const kind = raw.kind === undefined ? undefined : raw.kind;
    const fromMode = optionalText(raw.fromMode, "parent transition request fromMode");
    const targetMode = optionalText(raw.targetMode, "parent transition request targetMode");
    return { schemaVersion: 1, operation: raw.operation, requestId, ...(token !== undefined ? { token } : {}), ...(kind !== undefined ? { kind } : {}), ...(fromMode !== undefined ? { fromMode } : {}), ...(targetMode !== undefined ? { targetMode } : {}) };
}
export function validateParentTransitionResult(value: unknown): ParentTransitionResult {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("parent transition result must be an object");
    const raw = value as Record<string, unknown>;
    const allowed = ["schemaVersion", "requestId", "status", "token", "error"];
    const unknown = Object.keys(raw).filter(key => !allowed.includes(key));
    if (unknown.length) throw new Error(`parent transition result contains unknown keys: ${unknown.join(", ")}`);
    if (raw.schemaVersion !== 1) throw new Error("Unsupported parent transition result schemaVersion");
    const requestId = uuid(raw.requestId, "parent transition result requestId");
    if (raw.status !== "prepared" && raw.status !== "rejected" && raw.status !== "applied" && raw.status !== "cancelled" && raw.status !== "failed") throw new Error("parent transition result status is invalid");
    const token = optionalText(raw.token, "parent transition result token");
    const error = optionalText(raw.error, "parent transition result error");
    if (raw.status === "prepared" && token === undefined) throw new Error("prepared parent transition result requires token");
    if (raw.status === "rejected" && error === undefined) throw new Error("rejected parent transition result requires error");
    if (raw.status === "failed" && error === undefined) throw new Error("failed parent transition result requires error");
    return { schemaVersion: 1, requestId, status: raw.status, ...(token !== undefined ? { token } : {}), ...(error !== undefined ? { error } : {}) };
}

export function parentTransitionPath(stateRoot: string, meshId: string): string {
    if (!UUID.test(meshId)) throw new Error(`Invalid mesh ID: ${meshId}`);
    return join(meshDirectory(stateRoot, meshId), "parent-transition.json");
}
export async function readParentTransition(stateRoot: string, meshId: string): Promise<ParentTransitionFence | undefined> {
    const raw = await optionalJson(parentTransitionPath(stateRoot, meshId));
    return raw === undefined ? undefined : validateParentTransitionFence(raw);
}
export async function hasParentTransitionUnlocked(stateRoot: string, meshId: string): Promise<boolean> {
    const raw = await optionalJson(parentTransitionPath(stateRoot, meshId));
    if (raw === undefined) return false;
    validateParentTransitionFence(raw);
    return true;
}
export async function assertNoParentTransitionUnlocked(stateRoot: string, meshId: string): Promise<void> {
    if (await hasParentTransitionUnlocked(stateRoot, meshId)) throw new Error("Mesh parent transition in progress; new work is suspended");
}

/** Quiescence listings are strict: an unrecognized entry name is unavailable state, never silently skipped. Reservation IDs are hashes, so only their file shape is enforced here. */
async function listQuiescentDirectoryIds(directory: string, withJsonSuffix = false): Promise<string[]> {
    const names = await readdir(directory).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : Promise.reject(error));
    const ids: string[] = [];
    for (const name of names) {
        if (withJsonSuffix) {
            if (!name.endsWith(".json")) throw new Error(`Mesh parent transition requires quiescence: unrecognized reservation entry ${name}`);
            ids.push(name.slice(0, -5));
            continue;
        }
        if (!UUID.test(name)) throw new Error(`Mesh parent transition requires quiescence: unrecognized state entry ${name}`);
        ids.push(name);
    }
    return ids;
}

/** Strict quiescence inspection. Caller must hold the mesh lock. Any corrupted or unknown state rejects instead of being treated as empty. */
export async function assertParentTransitionQuiescenceUnlocked(stateRoot: string, meshId: string): Promise<void> {
    const paths = meshPaths(stateRoot, meshId);
    await mapConcurrent(await listQuiescentDirectoryIds(paths.agents), READ_CONCURRENCY, async agentId => {
        const pathsForAgent = agentPaths(stateRoot, meshId, agentId);
        const statusRaw = await optionalJson(pathsForAgent.status);
        if (statusRaw === undefined) throw new Error(`Mesh parent transition requires quiescence: agent ${agentId} has no status record`);
        const status = await readAgentStatus(pathsForAgent, meshId);
        const state: AgentState = status.state;
        if (isTerminalAgent(state)) return;
        if (state !== "idle") throw new Error(`Mesh parent transition requires quiescence: agent ${agentId} is ${state}`);
        if (status.activeTaskId) throw new Error(`Mesh parent transition requires quiescence: idle agent ${agentId} still references active task ${status.activeTaskId}`);
        const snapshot = await readAgentSnapshot(stateRoot, meshId, agentId);
        if (snapshot.stop && (snapshot.stop.state === "requested" || snapshot.stop.state === "terminating")) throw new Error(`Mesh parent transition requires quiescence: agent ${agentId} has active stop request ${snapshot.stop.stopRequestId}`);
        const execution = await readAgentExecution(stateRoot, meshId, agentId);
        if (execution && execution.holds.length) throw new Error(`Mesh parent transition requires quiescence: agent ${agentId} has ${execution.holds.length} execution hold(s)`);
    });
    await mapConcurrent(await listQuiescentDirectoryIds(paths.tasks), READ_CONCURRENCY, async taskId => {
        const task = await readTask(stateRoot, meshId, taskId).catch(error => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Mesh parent transition requires quiescence: task ${taskId} is missing its record`);
            throw error;
        });
        if (!isTerminalTask(task.status.state)) throw new Error(`Mesh parent transition requires quiescence: task ${taskId} is ${task.status.state}`);
    });
    for (const name of await listQuiescentDirectoryIds(paths.reservations, true)) {
        const reservation = await readMeshReservation(stateRoot, meshId, name);
        if (reservation.state === "pending") throw new Error(`Mesh parent transition requires quiescence: reservation ${reservation.reservationId} is pending`);
        if (reservation.state === "committed") {
            const [agentMaterialized, taskMaterialized] = await Promise.all([
                reservation.agentId ? optionalJson(agentPaths(stateRoot, meshId, reservation.agentId).status).then(value => value !== undefined) : Promise.resolve(false),
                reservation.taskId ? optionalJson(taskPaths(stateRoot, meshId, reservation.taskId).request).then(value => value !== undefined) : Promise.resolve(false),
            ]);
            if (!agentMaterialized || (reservation.taskId !== undefined && !taskMaterialized)) throw new Error(`Mesh parent transition requires quiescence: reservation ${reservation.reservationId} is committed but not materialized`);
        }
    }
    for (const admission of await listPressureAdmissions(stateRoot, meshId)) {
        if (admission.state === "requested" || admission.state === "processing") throw new Error(`Mesh parent transition requires quiescence: pressure admission ${admission.requestId} is ${admission.state}`);
    }
    const endpoint = await readMeshEndpoint(stateRoot, meshId, `root:${meshId}`);
    const delivery = await readQuiescentDeliverySnapshotUnlocked(stateRoot, meshId, endpoint);
    if (delivery.events.length) throw new Error(`Mesh parent transition requires quiescence: ${delivery.events.length} unacknowledged root delivery event(s)`);
    if (delivery.pendingTasks.length) throw new Error(`Mesh parent transition requires quiescence: ${delivery.pendingTasks.length} pending root completion task(s)`);
}
/** Verifies the current root identity and mesh quiescence, then records a short-lived transition fence atomically under one mesh lock. */
export async function prepareParentTransition(stateRoot: string, meshId: string, input: {
    requestId: string;
    rootLeaseId: string;
    rootSessionId: string;
    kind: ParentTransitionKind;
    fromMode: string;
    targetMode?: string;
    expectedBinding: { endpointId: string; endpointSessionFile: string; bindingId: string };
}): Promise<ParentTransitionFence> {
    return withMeshLock(stateRoot, meshId, async () => {
        const mesh = await readMesh(stateRoot, meshId);
        if (mesh.state !== "open") throw new Error(`Mesh ${meshId} is ${mesh.state}`);
        const lease = await assertRootLeaseOwner(stateRoot, meshId, input.rootLeaseId);
        if (lease.rootSessionId !== input.rootSessionId) throw new Error("Parent transition root session does not own the active root lease");
        const endpoint = await readMeshEndpoint(stateRoot, meshId, `root:${meshId}`);
        if (!endpoint.online || endpoint.endpointId !== input.expectedBinding.endpointId || endpoint.sessionFile !== input.expectedBinding.endpointSessionFile || endpoint.bindingId !== input.expectedBinding.bindingId) throw new Error("Parent transition root endpoint binding is stale or offline");
        const existing = await readParentTransition(stateRoot, meshId);
        if (existing) throw new Error(`Mesh ${meshId} already has an active parent transition fence (request ${existing.requestId}, kind ${existing.kind}). Do not delete or replay it; stop the session normally and start a new root session.`);
        await assertParentTransitionQuiescenceUnlocked(stateRoot, meshId);
        const fence: ParentTransitionFence = {
            schemaVersion: PARENT_TRANSITION_FENCE_SCHEMA_VERSION,
            requestId: input.requestId,
            rootLeaseId: input.rootLeaseId,
            rootSessionId: input.rootSessionId,
            kind: input.kind,
            fromMode: input.fromMode,
            ...(input.targetMode !== undefined ? { targetMode: input.targetMode } : {}),
            token: randomUUID(),
            createdAt: new Date().toISOString(),
        };
        validateParentTransitionFence(fence);
        await atomicJson(parentTransitionPath(stateRoot, meshId), fence);
        return fence;
    });
}

/** Deletes the fence only when the caller still owns it by token and root lease. */
export async function releaseParentTransition(stateRoot: string, meshId: string, expected: { token: string; rootLeaseId: string }): Promise<void> {
    await withMeshLock(stateRoot, meshId, async () => {
        const raw = await optionalJson(parentTransitionPath(stateRoot, meshId));
        if (raw === undefined) return;
        const fence = validateParentTransitionFence(raw);
        if (fence.token !== expected.token || fence.rootLeaseId !== expected.rootLeaseId) throw new Error("Parent transition fence ownership mismatch; fence remains in place");
        await unlink(parentTransitionPath(stateRoot, meshId));
    });
}
