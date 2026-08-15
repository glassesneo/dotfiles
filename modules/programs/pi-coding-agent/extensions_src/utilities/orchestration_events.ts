import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "./agent_types.ts";
import { settleCompletionDeliveriesUnlocked } from "./orchestration_channel.ts";
import { writeAtomicJson } from "./orchestration_json.ts";
import { withMeshLock } from "./orchestration_lock.ts";
import { meshPaths, readAgentSnapshot, readMesh, readTask } from "./orchestration_store.ts";
import type { TaskState } from "./orchestration_types.ts";

export type MeshDelivery = "steer" | "followUp";
export type MeshEndpointKind = "root" | "agent";
export interface MeshEndpoint { schemaVersion: 1; meshId: string; endpointId: string; kind: MeshEndpointKind; agentId?: string; harness: "pi"; sessionId: string; sessionFile: string; online: boolean; updatedAt: string }
export interface FrozenTask { taskId: string; state: TaskState; createdAt: string; startedAt?: string; finishedAt?: string; elapsedMs: number }
export interface MeshEvent { schemaVersion: 1; meshId: string; eventId: string; endpointId: string; endpointSessionFile: string; senderEndpointId: string; delivery: MeshDelivery; state: "pending" | "injected" | "acknowledged"; kind: "completion" | "signal"; payload: Record<string, unknown>; createdAt: string; injectedAt?: string; acknowledgedAt?: string }
export interface RouteIdempotency { schemaVersion: 1; meshId: string; endpointId: string; toolCallId: string; argumentsDigest: string; resultKind: "event"; resultId: string; createdAt: string }

function endpointKey(endpointId: string): string { return createHash("sha256").update(endpointId).digest("hex"); }
function endpointPath(stateRoot: string, meshId: string, endpointId: string): string { return join(meshPaths(stateRoot, meshId).endpoints, `${endpointKey(endpointId)}.json`); }
function eventPath(stateRoot: string, meshId: string, eventId: string): string { return join(meshPaths(stateRoot, meshId).events, `${eventId}.json`); }
function retryPath(stateRoot: string, meshId: string, endpointId: string, toolCallId: string): string { return join(meshPaths(stateRoot, meshId).events, `retry-${createHash("sha256").update(`${endpointId}\0${toolCallId}`).digest("hex")}.json`); }
async function json<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, "utf8")) as T; }
async function optional<T>(path: string): Promise<T | undefined> { return json<T>(path).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : Promise.reject(error)); }
function assertUuid(value: string, label: string): void { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new Error(`${label} must be a UUID`); }
function exact(value: unknown, required: readonly string[], optionalKeys: readonly string[], label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`); const raw = value as Record<string, unknown>; const allowed = [...required, ...optionalKeys]; const unknown = Object.keys(raw).filter(key => !allowed.includes(key)); const missing = required.filter(key => !(key in raw)); if (unknown.length || missing.length) throw new Error(`${label} has invalid keys`); return raw; }
function validateEndpoint(value: unknown, meshId: string, endpointId?: string): MeshEndpoint { const raw = exact(value, ["schemaVersion", "meshId", "endpointId", "kind", "harness", "sessionId", "sessionFile", "online", "updatedAt"], ["agentId"], "mesh endpoint"); if (raw.schemaVersion !== 1 || raw.meshId !== meshId || endpointId !== undefined && raw.endpointId !== endpointId || raw.harness !== "pi" || raw.kind !== "root" && raw.kind !== "agent" || typeof raw.sessionId !== "string" || typeof raw.sessionFile !== "string" || !raw.sessionFile || typeof raw.online !== "boolean") throw new Error("mesh endpoint is invalid"); if (raw.kind === "agent") assertUuid(String(raw.agentId), "endpoint agentId"); return value as MeshEndpoint; }
function validateEvent(value: unknown, meshId: string): MeshEvent { const raw = exact(value, ["schemaVersion", "meshId", "eventId", "endpointId", "endpointSessionFile", "senderEndpointId", "delivery", "state", "kind", "payload", "createdAt"], ["injectedAt", "acknowledgedAt"], "mesh event"); if (raw.schemaVersion !== 1 || raw.meshId !== meshId || raw.delivery !== "steer" && raw.delivery !== "followUp" || !["pending", "injected", "acknowledged"].includes(String(raw.state)) || raw.kind !== "completion" && raw.kind !== "signal" || !raw.payload || typeof raw.payload !== "object" || Array.isArray(raw.payload)) throw new Error("mesh event is invalid"); assertUuid(String(raw.eventId), "eventId"); return value as MeshEvent; }
function validateRetry(value: unknown, meshId: string): RouteIdempotency { const raw = exact(value, ["schemaVersion", "meshId", "endpointId", "toolCallId", "argumentsDigest", "resultKind", "resultId", "createdAt"], [], "signal idempotency"); if (raw.schemaVersion !== 1 || raw.meshId !== meshId || raw.resultKind !== "event" || typeof raw.argumentsDigest !== "string" || !/^[0-9a-f]{64}$/u.test(raw.argumentsDigest)) throw new Error("signal idempotency is invalid"); assertUuid(String(raw.resultId), "signal resultId"); return value as RouteIdempotency; }

export async function bindMeshEndpoint(stateRoot: string, meshId: string, input: Omit<MeshEndpoint, "schemaVersion" | "meshId" | "online" | "updatedAt">): Promise<MeshEndpoint> {
    if (!input.sessionFile.trim()) throw new Error("Durable mesh endpoint requires a persisted session file");
    if (input.kind === "agent") { if (!input.agentId) throw new Error("Agent endpoint requires agentId"); assertUuid(input.agentId, "agentId"); }
    const endpoint: MeshEndpoint = { schemaVersion: 1, meshId, ...input, online: true, updatedAt: new Date().toISOString() };
    await withMeshLock(stateRoot, meshId, async () => writeAtomicJson(endpointPath(stateRoot, meshId, endpoint.endpointId), endpoint)); return endpoint;
}
export async function setMeshEndpointOffline(stateRoot: string, meshId: string, endpointId: string, expected?: Pick<MeshEndpoint, "sessionId" | "sessionFile">): Promise<void> { await withMeshLock(stateRoot, meshId, async () => { const path = endpointPath(stateRoot, meshId, endpointId); const raw = await optional<unknown>(path); const endpoint = raw === undefined ? undefined : validateEndpoint(raw, meshId, endpointId); if (!endpoint || expected && (endpoint.sessionId !== expected.sessionId || endpoint.sessionFile !== expected.sessionFile)) return; await writeAtomicJson(path, { ...endpoint, online: false, updatedAt: new Date().toISOString() }); }); }
export async function readMeshEndpoint(stateRoot: string, meshId: string, endpointId: string): Promise<MeshEndpoint> { return validateEndpoint(await json<unknown>(endpointPath(stateRoot, meshId, endpointId)), meshId, endpointId); }
export async function isLiveMeshEndpointBinding(stateRoot: string, meshId: string, binding: MeshEndpoint): Promise<boolean> {
    const current = await readMeshEndpoint(stateRoot, meshId, binding.endpointId).catch(() => undefined);
    return Boolean(current?.online && current.kind === binding.kind && current.agentId === binding.agentId && current.sessionId === binding.sessionId && current.sessionFile === binding.sessionFile);
}

export async function resolveRouteEndpoint(stateRoot: string, meshId: string, receiver: string, callerAgentId?: string): Promise<MeshEndpoint> {
    let endpointId: string;
    if (receiver === "self") endpointId = callerAgentId ? `agent:${callerAgentId}` : `root:${meshId}`;
    else if (receiver === "root") endpointId = `root:${meshId}`;
    else if (receiver === "parent") {
        if (!callerAgentId) throw new Error("Root endpoint has no parent");
        const caller = await readAgentSnapshot(stateRoot, meshId, callerAgentId);
        endpointId = caller.agent.parentAgentId ? `agent:${caller.agent.parentAgentId}` : `root:${meshId}`;
    } else { assertUuid(receiver, "receiver"); endpointId = `agent:${receiver}`; }
    try { return await readMeshEndpoint(stateRoot, meshId, endpointId); }
    catch { throw new Error(`Receiver ${receiver} is not a durable Pi endpoint in this mesh`); }
}

async function createEvent(stateRoot: string, meshId: string, input: Omit<MeshEvent, "schemaVersion" | "meshId" | "eventId" | "state" | "createdAt">, assignedEventId?: string): Promise<MeshEvent> { const eventId = assignedEventId ?? randomUUID(); const event: MeshEvent = { schemaVersion: 1, meshId, eventId, state: "pending", createdAt: new Date().toISOString(), ...input, payload: { eventId, ...input.payload } }; await writeAtomicJson(eventPath(stateRoot, meshId, event.eventId), event); return event; }

export interface CompletionMaterializationOptions { afterLedgerPersisted?: () => void | Promise<void> }
async function evaluateCompletionRoutes(stateRoot: string, meshId: string, options: CompletionMaterializationOptions = {}): Promise<void> {
    const mesh = await readMesh(stateRoot, meshId);
    const settlement = await settleCompletionDeliveriesUnlocked(stateRoot, meshId, mesh.budgets.maxTasksPerMesh);
    if (settlement.ledgersPersisted) await options.afterLedgerPersisted?.();
    for (const item of settlement.eventBatches) {
        const eventId = item.batch.eventId!;
        if (await optional<unknown>(eventPath(stateRoot, meshId, eventId)) !== undefined) continue;
        await createEvent(stateRoot, meshId, {
            endpointId: item.ledger.endpointId,
            endpointSessionFile: item.ledger.endpointSessionFile,
            senderEndpointId: item.ledger.endpointId,
            delivery: "steer",
            kind: "completion",
            payload: {
                route: item.batch.route,
                ...(item.batch.channel ? { channel: item.batch.channel } : {}),
                batchId: item.batch.batchId,
                settledAt: item.batch.settledAt,
                tasks: item.tasks.map(task => ({ taskId: task.taskId, state: task.state, createdAt: task.createdAt, ...(task.startedAt ? { startedAt: task.startedAt } : {}), ...(task.finishedAt ? { finishedAt: task.finishedAt } : {}) })),
                openChannels: item.openChannels,
            },
        }, eventId);
    }
}

async function idempotent<T extends { eventId: string }>(stateRoot: string, meshId: string, endpointId: string, toolCallId: string, args: unknown, create: () => Promise<T>): Promise<T> {
    return withMeshLock(stateRoot, meshId, async () => {
        const path = retryPath(stateRoot, meshId, endpointId, toolCallId); const digest = createHash("sha256").update(canonicalJson(args)).digest("hex"); const rawExisting = await optional<unknown>(path); const existing = rawExisting === undefined ? undefined : validateRetry(rawExisting, meshId);
        if (existing) { if (existing.argumentsDigest !== digest) throw new Error("mesh_signal retry reused toolCallId with different arguments"); return { eventId: existing.resultId } as T; }
        const result = await create(); await writeAtomicJson(path, { schemaVersion: 1, meshId, endpointId, toolCallId, argumentsDigest: digest, resultKind: "event", resultId: result.eventId, createdAt: new Date().toISOString() } satisfies RouteIdempotency); return result;
    });
}
export async function registerMeshSignal(stateRoot: string, meshId: string, input: { callerEndpointId: string; toolCallId: string; endpoint: MeshEndpoint; delivery: MeshDelivery; topic: string; text: string; taskIds?: string[]; canonicalArguments: unknown }): Promise<{ eventId: string }> { return idempotent(stateRoot, meshId, input.callerEndpointId, input.toolCallId, input.canonicalArguments, async () => { if (input.taskIds) await Promise.all(input.taskIds.map(id => readTask(stateRoot, meshId, id))); const event = await createEvent(stateRoot, meshId, { endpointId: input.endpoint.endpointId, endpointSessionFile: input.endpoint.sessionFile, senderEndpointId: input.callerEndpointId, delivery: input.delivery, kind: "signal", payload: { topic: input.topic, text: input.text, ...(input.taskIds ? { taskIds: input.taskIds } : {}) } }); return { eventId: event.eventId }; }); }

async function records(directory: string, prefix = ""): Promise<unknown[]> { const names = await readdir(directory).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : Promise.reject(error)); return Promise.all(names.filter(name => name.endsWith(".json") && (prefix === "" || !name.startsWith(prefix))).map(name => json<unknown>(join(directory, name)))); }
export async function materializeMeshCompletionEvents(stateRoot: string, meshId: string, options: CompletionMaterializationOptions = {}): Promise<void> { await withMeshLock(stateRoot, meshId, () => evaluateCompletionRoutes(stateRoot, meshId, options)); }
export async function readPendingMeshEvents(stateRoot: string, meshId: string, endpoint: MeshEndpoint): Promise<MeshEvent[]> { validateEndpoint(endpoint, meshId, endpoint.endpointId); return withMeshLock(stateRoot, meshId, async () => { const durableRaw = await optional<unknown>(endpointPath(stateRoot, meshId, endpoint.endpointId)); const durable = durableRaw === undefined ? undefined : validateEndpoint(durableRaw, meshId, endpoint.endpointId); if (!durable || !durable.online || durable.kind !== endpoint.kind || durable.agentId !== endpoint.agentId || durable.sessionId !== endpoint.sessionId || durable.sessionFile !== endpoint.sessionFile) return []; const events = (await records(meshPaths(stateRoot, meshId).events, "retry-")).map(value => validateEvent(value, meshId)); return events.filter(event => event.endpointId === durable.endpointId && event.endpointSessionFile === durable.sessionFile && event.state !== "acknowledged"); }); }
export async function pollMeshEvents(stateRoot: string, meshId: string, endpoint: MeshEndpoint, options: CompletionMaterializationOptions = {}): Promise<MeshEvent[]> { await materializeMeshCompletionEvents(stateRoot, meshId, options); return readPendingMeshEvents(stateRoot, meshId, endpoint); }
export async function markMeshEventInjected(stateRoot: string, meshId: string, eventId: string): Promise<void> { await withMeshLock(stateRoot, meshId, async () => { const path = eventPath(stateRoot, meshId, eventId); const event = validateEvent(await json<unknown>(path), meshId); if (event.state !== "pending") return; await writeAtomicJson(path, { ...event, state: "injected", injectedAt: new Date().toISOString() }); }); }
export async function acknowledgeMeshEvents(stateRoot: string, meshId: string, eventIds: readonly string[]): Promise<void> { await withMeshLock(stateRoot, meshId, async () => { for (const eventId of new Set(eventIds)) { const path = eventPath(stateRoot, meshId, eventId); const raw = await optional<unknown>(path); const event = raw === undefined ? undefined : validateEvent(raw, meshId); if (event && event.state !== "acknowledged") await writeAtomicJson(path, { ...event, state: "acknowledged", acknowledgedAt: new Date().toISOString() }); } }); }
