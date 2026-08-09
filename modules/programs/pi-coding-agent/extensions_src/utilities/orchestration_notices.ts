import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomicJson as atomicJson } from "./orchestration_json.ts";
import { meshDirectory, withMeshLock } from "./orchestration_lock.ts";
import { listMeshAgents, readAgentSnapshot } from "./orchestration_store.ts";
import type { AgentSnapshot } from "./orchestration_types.ts";
import { isLiveMeshEndpointBinding, type MeshEndpoint } from "./orchestration_events.ts";

export const NOTICE_REASON_MAX_BYTES = 512;
export const NOTICE_PAYLOAD_MAX_BYTES = 32 * 1024;
export const GC_NOTICE_MAX_AGENTS = 64;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EXPLICIT_SOURCES = ["user", "peer"] as const;
const GC_SOURCES = ["gc-role", "gc-context", "gc-pressure"] as const;

export interface NoticeRecipient {
    endpointId: string;
}

export interface ExplicitStopNoticePayload {
    stopRequestId: string;
    agentId: string;
    role: string;
    source: (typeof EXPLICIT_SOURCES)[number];
    reason: string;
}

export interface GcStopNoticeAgent {
    agentId: string;
    role: string;
    source: (typeof GC_SOURCES)[number];
    reason: string;
}

export interface GcStopNoticePayload {
    gcPassId: string;
    confirmed: GcStopNoticeAgent[];
    failedCount: number;
    pendingCount: number;
}

export type TuiNotice = {
    schemaVersion: 1;
    meshId: string;
    noticeId: string;
    state: "pending" | "acknowledged";
    recipientEndpointId: string;
    createdAt: string;
    displayedAt?: string;
    acknowledgedAt?: string;
} & ({ kind: "explicit-stop"; payload: ExplicitStopNoticePayload } | { kind: "gc-stop"; payload: GcStopNoticePayload });

function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string): void {
    const allowed = [...required, ...optional];
    const unknown = Object.keys(value).filter(key => !allowed.includes(key));
    const missing = required.filter(key => !(key in value));
    if (unknown.length) throw new Error(`${label} contains unknown keys: ${unknown.join(", ")}`);
    if (missing.length) throw new Error(`${label} is missing required keys: ${missing.join(", ")}`);
}
function boundedText(value: unknown, label: string, maxBytes: number): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
    const result = value.trim();
    if (Buffer.byteLength(result, "utf8") > maxBytes) throw new Error(`${label} exceeds ${maxBytes} UTF-8 bytes`);
    return result;
}
function uuid(value: unknown, label: string): string {
    const result = boundedText(value, label, 64);
    if (!UUID.test(result)) throw new Error(`${label} must be a UUID`);
    return result;
}
function timestamp(value: unknown, label: string): string {
    const result = boundedText(value, label, 64);
    if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO timestamp`);
    return result;
}
function count(value: unknown, label: string): number {
    if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 1024) throw new Error(`${label} must be an integer from 0 through 1024`);
    return Number(value);
}
function reason(value: unknown): string { return boundedText(value, "notice reason", NOTICE_REASON_MAX_BYTES); }
function role(value: unknown): string { return boundedText(value, "notice role", 128); }
function recipient(value: NoticeRecipient): NoticeRecipient {
    return { endpointId: boundedText(value.endpointId, "recipient endpoint ID", 512) };
}
function explicitPayload(value: unknown): ExplicitStopNoticePayload {
    const raw = object(value, "explicit notice payload");
    exact(raw, ["stopRequestId", "agentId", "role", "source", "reason"], [], "explicit notice payload");
    if (!EXPLICIT_SOURCES.includes(raw.source as never)) throw new Error("explicit notice source is invalid");
    return { stopRequestId: uuid(raw.stopRequestId, "stop request ID"), agentId: uuid(raw.agentId, "agent ID"), role: role(raw.role), source: raw.source as ExplicitStopNoticePayload["source"], reason: reason(raw.reason) };
}
function gcAgent(value: unknown): GcStopNoticeAgent {
    const raw = object(value, "GC notice agent");
    exact(raw, ["agentId", "role", "source", "reason"], [], "GC notice agent");
    if (!GC_SOURCES.includes(raw.source as never)) throw new Error("GC notice source is invalid");
    return { agentId: uuid(raw.agentId, "agent ID"), role: role(raw.role), source: raw.source as GcStopNoticeAgent["source"], reason: reason(raw.reason) };
}
function gcPayload(value: unknown): GcStopNoticePayload {
    const raw = object(value, "GC notice payload");
    exact(raw, ["gcPassId", "confirmed", "failedCount", "pendingCount"], [], "GC notice payload");
    if (!Array.isArray(raw.confirmed) || raw.confirmed.length > GC_NOTICE_MAX_AGENTS) throw new Error(`GC notice confirmed agents must contain at most ${GC_NOTICE_MAX_AGENTS} entries`);
    const confirmed = raw.confirmed.map(gcAgent);
    if (new Set(confirmed.map(item => item.agentId)).size !== confirmed.length) throw new Error("GC notice confirmed agents must not contain duplicates");
    return { gcPassId: uuid(raw.gcPassId, "GC pass ID"), confirmed, failedCount: count(raw.failedCount, "GC failed count"), pendingCount: count(raw.pendingCount, "GC pending count") };
}
function assertPayloadBound(payload: ExplicitStopNoticePayload | GcStopNoticePayload): void {
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > NOTICE_PAYLOAD_MAX_BYTES) throw new Error(`notice payload exceeds ${NOTICE_PAYLOAD_MAX_BYTES} UTF-8 bytes`);
}

export function validateTuiNotice(value: unknown, expected?: { meshId: string; noticeId?: string }): TuiNotice {
    const raw = object(value, "TUI notice");
    exact(raw, ["schemaVersion", "meshId", "noticeId", "state", "recipientEndpointId", "kind", "payload", "createdAt"], ["displayedAt", "acknowledgedAt"], "TUI notice");
    if (raw.schemaVersion !== 1) throw new Error("Unsupported TUI notice schemaVersion");
    const meshId = uuid(raw.meshId, "notice mesh ID"); const noticeId = uuid(raw.noticeId, "notice ID");
    if (expected && (meshId !== expected.meshId || expected.noticeId !== undefined && noticeId !== expected.noticeId)) throw new Error("TUI notice does not match path identity");
    if (raw.state !== "pending" && raw.state !== "acknowledged") throw new Error("TUI notice state is invalid");
    const target = recipient({ endpointId: raw.recipientEndpointId as string });
    const createdAt = timestamp(raw.createdAt, "notice createdAt");
    const displayedAt = raw.displayedAt === undefined ? undefined : timestamp(raw.displayedAt, "notice displayedAt");
    const acknowledgedAt = raw.acknowledgedAt === undefined ? undefined : timestamp(raw.acknowledgedAt, "notice acknowledgedAt");
    if (raw.state === "pending" && (displayedAt || acknowledgedAt) || raw.state === "acknowledged" && (!displayedAt || !acknowledgedAt)) throw new Error("TUI notice lifecycle timestamps do not match state");
    if (displayedAt && Date.parse(displayedAt) < Date.parse(createdAt) || acknowledgedAt && displayedAt && Date.parse(acknowledgedAt) < Date.parse(displayedAt)) throw new Error("TUI notice lifecycle timestamps are out of order");
    let notice: TuiNotice;
    if (raw.kind === "explicit-stop") notice = { schemaVersion: 1, meshId, noticeId, state: raw.state, recipientEndpointId: target.endpointId, kind: raw.kind, payload: explicitPayload(raw.payload), createdAt, ...(displayedAt ? { displayedAt } : {}), ...(acknowledgedAt ? { acknowledgedAt } : {}) };
    else if (raw.kind === "gc-stop") notice = { schemaVersion: 1, meshId, noticeId, state: raw.state, recipientEndpointId: target.endpointId, kind: raw.kind, payload: gcPayload(raw.payload), createdAt, ...(displayedAt ? { displayedAt } : {}), ...(acknowledgedAt ? { acknowledgedAt } : {}) };
    else throw new Error("TUI notice kind is invalid");
    assertPayloadBound(notice.payload); return notice;
}

function noticeDirectory(stateRoot: string, meshId: string): string { return join(meshDirectory(stateRoot, meshId), "notices"); }
function noticePath(stateRoot: string, meshId: string, noticeId: string): string { return join(noticeDirectory(stateRoot, meshId), `${uuid(noticeId, "notice ID")}.json`); }
function identityNoticeId(kind: TuiNotice["kind"], identity: string, endpointId: string): string {
    const bytes = Buffer.from(createHash("sha256").update(`${kind}\0${identity}\0${endpointId}`).digest().subarray(0, 16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x50; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString("hex"); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function readNotice(path: string, meshId: string, noticeId: string): Promise<TuiNotice> { return validateTuiNotice(JSON.parse(await readFile(path, "utf8")), { meshId, noticeId }); }
function equivalent(existing: TuiNotice, candidate: TuiNotice): boolean {
    return existing.kind === candidate.kind && existing.recipientEndpointId === candidate.recipientEndpointId && JSON.stringify(existing.payload) === JSON.stringify(candidate.payload);
}
async function createNotice(stateRoot: string, candidate: TuiNotice, preserveExisting = false): Promise<TuiNotice> {
    return withMeshLock(stateRoot, candidate.meshId, async () => {
        const path = noticePath(stateRoot, candidate.meshId, candidate.noticeId);
        try {
            const existing = await readNotice(path, candidate.meshId, candidate.noticeId);
            if (!equivalent(existing, candidate)) {
                const sameGcIdentity = preserveExisting && existing.kind === "gc-stop" && candidate.kind === "gc-stop" && existing.recipientEndpointId === candidate.recipientEndpointId && existing.payload.gcPassId === candidate.payload.gcPassId;
                if (!sameGcIdentity) throw new Error(`Notice identity ${candidate.noticeId} was reused with different content`);
                if (existing.state === "pending") { const updated = validateTuiNotice({ ...candidate, createdAt: existing.createdAt }, { meshId: candidate.meshId, noticeId: candidate.noticeId }); await atomicJson(path, updated); return updated; }
            }
            return existing;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        const notice = validateTuiNotice(candidate, { meshId: candidate.meshId, noticeId: candidate.noticeId }); await atomicJson(path, notice); return notice;
    });
}

export async function resolveProvenanceParentEndpoint(stateRoot: string, snapshot: AgentSnapshot): Promise<string | undefined> {
    const parentAgentId = snapshot.agent.parentAgentId;
    if (!parentAgentId) return `root:${snapshot.agent.meshId}`;
    const parent = await readAgentSnapshot(stateRoot, snapshot.agent.meshId, parentAgentId);
    if (parent.agent.harness !== "pi") return undefined;
    return `agent:${parentAgentId}`;
}

export async function reconcileGcStopNotices(stateRoot: string, meshId: string, onlyGcPassId?: string): Promise<number> {
    const groups = new Map<string, { gcPassId: string; confirmed: GcStopNoticeAgent[]; failedCount: number; pendingCount: number }>();
    for (const snapshot of await listMeshAgents(stateRoot, meshId)) {
        const stop = snapshot.stop;
        if (!stop?.gcPassId || onlyGcPassId && stop.gcPassId !== onlyGcPassId || !GC_SOURCES.includes(stop.source as never)) continue;
        const endpointId = await resolveProvenanceParentEndpoint(stateRoot, snapshot); if (!endpointId) continue;
        const key = `${stop.gcPassId}\0${endpointId}`; const group = groups.get(key) ?? { gcPassId: stop.gcPassId, confirmed: [], failedCount: 0, pendingCount: 0 };
        if (stop.state === "confirmed") group.confirmed.push({ agentId: snapshot.agent.agentId, role: snapshot.agent.agent, source: stop.source as GcStopNoticeAgent["source"], reason: stop.reason });
        else if (stop.state === "failed") group.failedCount += 1;
        else group.pendingCount += 1;
        groups.set(key, group);
    }
    let created = 0;
    for (const [key, group] of groups) { const endpointId = key.slice(key.indexOf("\0") + 1); group.confirmed.sort((left, right) => left.agentId.localeCompare(right.agentId)); await createGcStopNotice(stateRoot, meshId, { endpointId, payload: group }, true); created += 1; }
    return created;
}

export async function createExplicitStopNotice(stateRoot: string, meshId: string, input: NoticeRecipient & { requesterEndpointId: string; payload: ExplicitStopNoticePayload }): Promise<TuiNotice | undefined> {
    const target = recipient(input); const requesterEndpointId = boundedText(input.requesterEndpointId, "requester endpoint ID", 512);
    if (requesterEndpointId === target.endpointId) return undefined;
    const payload = explicitPayload(input.payload); assertPayloadBound(payload);
    const noticeId = identityNoticeId("explicit-stop", payload.stopRequestId, target.endpointId);
    return createNotice(stateRoot, { schemaVersion: 1, meshId: uuid(meshId, "mesh ID"), noticeId, state: "pending", recipientEndpointId: target.endpointId, kind: "explicit-stop", payload, createdAt: new Date().toISOString() });
}

export async function createGcStopNotice(stateRoot: string, meshId: string, input: NoticeRecipient & { payload: GcStopNoticePayload }, preserveExisting = false): Promise<TuiNotice> {
    const target = recipient(input); const payload = gcPayload(input.payload); assertPayloadBound(payload);
    const noticeId = identityNoticeId("gc-stop", payload.gcPassId, target.endpointId);
    return createNotice(stateRoot, { schemaVersion: 1, meshId: uuid(meshId, "mesh ID"), noticeId, state: "pending", recipientEndpointId: target.endpointId, kind: "gc-stop", payload, createdAt: new Date().toISOString() }, preserveExisting);
}

export async function listPendingTuiNotices(stateRoot: string, meshId: string, targetInput: NoticeRecipient): Promise<TuiNotice[]> {
    const target = recipient(targetInput); const directory = noticeDirectory(stateRoot, uuid(meshId, "mesh ID"));
    const names = await readdir(directory).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : Promise.reject(error));
    const notices = await Promise.all(names.filter(name => name.endsWith(".json")).map(async name => {
        const noticeId = name.slice(0, -5); try { return await readNotice(join(directory, name), meshId, noticeId); } catch { return undefined; }
    }));
    return notices.filter((notice): notice is TuiNotice => notice !== undefined && notice.state === "pending" && notice.recipientEndpointId === target.endpointId).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.noticeId.localeCompare(right.noticeId));
}

export async function acknowledgeDisplayedTuiNotice(stateRoot: string, meshId: string, noticeId: string, targetInput: NoticeRecipient & { binding?: MeshEndpoint }, displayedAt: string): Promise<TuiNotice> {
    const target = recipient(targetInput); const observedDisplayedAt = timestamp(displayedAt, "notice displayedAt");
    return withMeshLock(stateRoot, meshId, async () => {
        if (targetInput.binding && !await isLiveMeshEndpointBinding(stateRoot, meshId, targetInput.binding)) throw new Error("TUI notice live endpoint/session binding changed before acknowledgment");
        const path = noticePath(stateRoot, meshId, noticeId); const notice = await readNotice(path, meshId, noticeId);
        if (notice.recipientEndpointId !== target.endpointId) throw new Error("TUI notice recipient endpoint does not match");
        if (notice.state === "acknowledged") return notice;
        const acknowledgedAt = new Date(Math.max(Date.now(), Date.parse(observedDisplayedAt))).toISOString();
        const next = validateTuiNotice({ ...notice, state: "acknowledged", displayedAt: observedDisplayedAt, acknowledgedAt }, { meshId, noticeId });
        await atomicJson(path, next); return next;
    });
}
