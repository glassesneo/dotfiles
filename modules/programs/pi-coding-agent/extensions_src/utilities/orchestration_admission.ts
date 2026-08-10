import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { MeshGcConfig } from "./agent_types.ts";
import { PressureAdmissionStaleError, reserveNewAgentCapacityWithPressure } from "./orchestration_gc.ts";
import { writeAtomicJson } from "./orchestration_json.ts";
import { meshDirectory, withMeshLock } from "./orchestration_lock.ts";
import { assertCurrentAgentRuntime, readAgentRuntimeBinding } from "./orchestration_runtime.ts";
import { stopMeshAgentWithDisposition } from "./orchestration_management.ts";
import { agentPaths, assertRootLeaseOwner, observeAgentLifecycle, readAgentSnapshot, readAgentStatus, readMesh, readMeshReservation, readTask, releaseMeshReservation, releasePendingMeshReservation, releaseUnconsumedMeshReservation, removePreparedAgent, reservationPath } from "./orchestration_store.ts";
import { inspectAgentTmux, type CommandExecutor } from "./orchestration_tmux.ts";
import { isTerminalAgent, type BudgetReservation } from "./orchestration_types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const STATES = ["requested", "processing", "succeeded", "failed", "cancelled"] as const;
type PressureAdmissionState = (typeof STATES)[number];
export interface PressureAdmission {
    schemaVersion: 1;
    meshId: string;
    requestId: string;
    requesterAgentId: string;
    requesterRuntimeId: string;
    state: PressureAdmissionState;
    requestedAt: string;
    updatedAt: string;
    reservationId: string | null;
    error: string | null;
    completedAt: string | null;
}
interface PressureOptions { stateRoot: string; meshId: string; leaseId: string; gc: MeshGcConfig; exec: CommandExecutor; tmux: string; signal?: AbortSignal }

function directory(stateRoot: string, meshId: string): string { return join(meshDirectory(stateRoot, meshId), "pressure-admissions"); }
function pathFor(stateRoot: string, meshId: string, requestId: string): string { if (!UUID.test(requestId)) throw new Error("pressure admission request ID must be a UUID"); return join(directory(stateRoot, meshId), `${requestId}.json`); }
function validate(value: unknown, meshId: string, requestId: string): PressureAdmission {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("pressure admission must be an object");
    const raw = value as Record<string, unknown>; const keys = ["schemaVersion", "meshId", "requestId", "requesterAgentId", "requesterRuntimeId", "state", "requestedAt", "updatedAt", "reservationId", "error", "completedAt"];
    if (Object.keys(raw).length !== keys.length || keys.some(key => !(key in raw))) throw new Error("pressure admission has invalid keys");
    if (raw.schemaVersion !== 1 || raw.meshId !== meshId || raw.requestId !== requestId || typeof raw.requesterAgentId !== "string" || !UUID.test(raw.requesterAgentId) || typeof raw.requesterRuntimeId !== "string" || !UUID.test(raw.requesterRuntimeId)) throw new Error("pressure admission identity is invalid");
    if (!STATES.includes(raw.state as PressureAdmissionState)) throw new Error("pressure admission state is invalid");
    for (const key of ["requestedAt", "updatedAt"] as const) if (typeof raw[key] !== "string" || !Number.isFinite(Date.parse(raw[key] as string))) throw new Error(`pressure admission ${key} is invalid`);
    if (raw.completedAt !== null && (typeof raw.completedAt !== "string" || !Number.isFinite(Date.parse(raw.completedAt)))) throw new Error("pressure admission completedAt is invalid");
    if (raw.reservationId !== null && (typeof raw.reservationId !== "string" || !UUID.test(raw.reservationId))) throw new Error("pressure admission reservationId is invalid");
    if (raw.error !== null && (typeof raw.error !== "string" || Buffer.byteLength(raw.error, "utf8") > 1024)) throw new Error("pressure admission error is invalid");
    if ((raw.state === "requested" || raw.state === "processing") && (raw.reservationId !== null || raw.error !== null || raw.completedAt !== null)) throw new Error("pressure admission pending state is inconsistent");
    if (raw.state === "succeeded" && (raw.reservationId === null || raw.error !== null || raw.completedAt === null)) throw new Error("pressure admission success is incomplete");
    if ((raw.state === "failed" || raw.state === "cancelled") && (raw.reservationId !== null || raw.error === null || raw.completedAt === null)) throw new Error("pressure admission terminal failure is incomplete");
    return value as PressureAdmission;
}
async function optional(stateRoot: string, meshId: string, requestId: string): Promise<PressureAdmission | undefined> { try { return validate(JSON.parse(await readFile(pathFor(stateRoot, meshId, requestId), "utf8")), meshId, requestId); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
function boundedError(error: unknown): string { const characters = Array.from(error instanceof Error ? error.message : String(error)); while (characters.length && Buffer.byteLength(characters.join(""), "utf8") > 1024) characters.pop(); return characters.join("") || "Pressure admission failed"; }

export async function requestPressureAdmission(stateRoot: string, meshId: string, input: { requestId: string; requesterAgentId: string; requesterRuntimeId: string }): Promise<PressureAdmission> {
    await assertCurrentAgentRuntime(stateRoot, meshId, input.requesterAgentId, input.requesterRuntimeId);
    return withMeshLock(stateRoot, meshId, async () => {
        const existing = await optional(stateRoot, meshId, input.requestId);
        if (existing) {
            if (existing.requesterAgentId !== input.requesterAgentId || existing.requesterRuntimeId !== input.requesterRuntimeId) throw new Error("pressure admission request ID was reused with different content");
            return existing;
        }
        if ((await readMesh(stateRoot, meshId)).state !== "open") throw new Error(`Mesh ${meshId} is not open`);
        const now = new Date().toISOString(); const request: PressureAdmission = { schemaVersion: 1, meshId, requestId: input.requestId, requesterAgentId: input.requesterAgentId, requesterRuntimeId: input.requesterRuntimeId, state: "requested", requestedAt: now, updatedAt: now, reservationId: null, error: null, completedAt: null };
        await writeAtomicJson(pathFor(stateRoot, meshId, input.requestId), request); return request;
    });
}
export async function readPressureAdmission(stateRoot: string, meshId: string, requestId: string): Promise<PressureAdmission> { const value = await optional(stateRoot, meshId, requestId); if (!value) throw new Error(`Pressure admission ${requestId} was not found`); return value; }
async function settle(stateRoot: string, meshId: string, requestId: string, outcome: { reservation?: BudgetReservation; error?: string }, guard?: () => Promise<void>): Promise<boolean> {
    return withMeshLock(stateRoot, meshId, async () => {
        await guard?.(); const current = await readPressureAdmission(stateRoot, meshId, requestId); if (current.state === "cancelled" || current.state === "failed" || current.state === "succeeded") return false;
        const now = new Date().toISOString(); const next: PressureAdmission = outcome.reservation
            ? { ...current, state: "succeeded", updatedAt: now, completedAt: now, reservationId: outcome.reservation.reservationId, error: null }
            : { ...current, state: "failed", updatedAt: now, completedAt: now, reservationId: null, error: outcome.error ?? "Pressure admission failed" };
        await writeAtomicJson(pathFor(stateRoot, meshId, requestId), next); return true;
    });
}
async function assertPressurePassActive(options: PressureOptions): Promise<void> { if (options.signal?.aborted) throw options.signal.reason; await assertRootLeaseOwner(options.stateRoot, options.meshId, options.leaseId); if (options.signal?.aborted) throw options.signal.reason; }
type RequesterEvidence = { state: "live" | "dead" | "unavailable"; reason?: string };
class RequesterUnavailableError extends Error {}
class RequesterDeadError extends Error {}
async function inspectRequester(stateRoot: string, meshId: string, admission: PressureAdmission, inspectPane: (requester: Awaited<ReturnType<typeof readAgentSnapshot>>) => Promise<"live" | "dead" | "unavailable">): Promise<RequesterEvidence> {
    let runtime; try { runtime = await readAgentRuntimeBinding(stateRoot, meshId, admission.requesterAgentId); } catch { return { state: "unavailable" }; }
    if (!runtime || runtime.runtimeId !== admission.requesterRuntimeId) return { state: "dead", reason: "Pressure admission requester runtime is stale or absent" };
    let requester: Awaited<ReturnType<typeof readAgentSnapshot>>; try { requester = await readAgentSnapshot(stateRoot, meshId, admission.requesterAgentId); } catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? { state: "dead", reason: "Pressure admission requester is absent" } : { state: "unavailable" }; }
    if (requester.status.state === "stopping" || isTerminalAgent(requester.status.state)) return { state: "dead", reason: "Pressure admission requester lifecycle is not live" };
    let pane: "live" | "dead" | "unavailable"; try { pane = await inspectPane(requester); } catch { return { state: "unavailable" }; }
    return pane === "dead" ? { state: "dead", reason: "Pressure admission requester tmux identity is not live" } : { state: pane };
}
async function inspectRequesterTmux(options: PressureOptions, admission: PressureAdmission): Promise<RequesterEvidence> {
    return inspectRequester(options.stateRoot, options.meshId, admission, async requester => {
        const inspected = await inspectAgentTmux(options.exec, options.tmux, requester.agent.tmux);
        if (inspected.server === "unavailable" || inspected.server === "match" && inspected.paneState === "unavailable") return "unavailable";
        return inspected.server === "match" && inspected.sessionAlive && inspected.paneState === "alive" ? "live" : "dead";
    });
}
async function assertRequesterLive(options: PressureOptions, admission: PressureAdmission): Promise<void> {
    const evidence = await inspectRequesterTmux(options, admission);
    if (evidence.state === "unavailable") throw new RequesterUnavailableError("Pressure admission requester liveness is unavailable");
    if (evidence.state === "dead") throw new RequesterDeadError(evidence.reason ?? "Pressure admission requester is not live");
}
async function durableReservationTask(stateRoot: string, meshId: string, reservation: BudgetReservation): Promise<"valid" | "absent" | "unavailable"> {
    if (!reservation.taskId || !reservation.agentId) return "absent";
    try { return (await readTask(stateRoot, meshId, reservation.taskId)).request.agentId === reservation.agentId ? "valid" : "absent"; }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "unavailable"; }
}
async function reconcileDeadCommittedLaunch(options: PressureOptions, request: PressureAdmission, reservation: BudgetReservation, reason: string): Promise<boolean> {
    if (!reservation.agentId) return false;
    let initialLifecycle; try { initialLifecycle = await observeAgentLifecycle(options.stateRoot, options.meshId, reservation.agentId); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
        let prepared; try { prepared = await readAgentStatus(agentPaths(options.stateRoot, options.meshId, reservation.agentId), options.meshId); } catch { return false; }
        if (prepared.state !== "creating") return false;
        await removePreparedAgent(options.stateRoot, options.meshId, reservation.agentId, reservation.reservationId, reason);
        await cancelPressureAdmission(options.stateRoot, options.meshId, request.requestId, reason);
        return true;
    }
    let launch; try { launch = await readAgentSnapshot(options.stateRoot, options.meshId, reservation.agentId); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
        let prepared; try { prepared = await readAgentStatus(agentPaths(options.stateRoot, options.meshId, reservation.agentId), options.meshId); } catch { return false; }
        if (prepared.state !== "creating" || prepared.activeTaskId) return false;
        await removePreparedAgent(options.stateRoot, options.meshId, reservation.agentId, reservation.reservationId, reason);
        await cancelPressureAdmission(options.stateRoot, options.meshId, request.requestId, reason);
        return true;
    }
    if (isTerminalAgent(launch.status.state)) {
        const release = await releaseUnconsumedMeshReservation(options.stateRoot, options.meshId, reservation.reservationId, reason);
        if (!release.released) return false;
        await cancelPressureAdmission(options.stateRoot, options.meshId, request.requestId, reason);
        return true;
    }
    if (!["creating", "idle", "stopping"].includes(launch.status.state) || launch.status.activeTaskId || launch.task) return false;
    const inspected = await inspectAgentTmux(options.exec, options.tmux, launch.agent.tmux).catch(() => undefined);
    if (!inspected || inspected.server === "unavailable" || inspected.server === "match" && inspected.paneState === "unavailable" || inspected.server === "mismatch") return false;
    let stopped; try { stopped = await stopMeshAgentWithDisposition({ ...options, agentId: reservation.agentId, source: "recovery", reason, initialLifecycle }); } catch (error) { if (error instanceof Error && /lifecycle observation is stale/u.test(error.message)) return false; throw error; }
    if (stopped.snapshot.stop?.state !== "confirmed" && !isTerminalAgent(stopped.snapshot.status.state)) return false;
    const release = await releaseUnconsumedMeshReservation(options.stateRoot, options.meshId, reservation.reservationId, reason);
    if (!release.released) return false;
    await cancelPressureAdmission(options.stateRoot, options.meshId, request.requestId, reason);
    return true;
}
export async function processPressureAdmissions(options: PressureOptions, limit = 8): Promise<number> {
    await assertPressurePassActive(options);
    const names = await readdir(directory(options.stateRoot, options.meshId)).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : Promise.reject(error)); let processed = 0;
    for (const name of names.filter(name => name.endsWith(".json") && UUID.test(name.slice(0, -5))).sort()) {
        if (processed >= limit) break;
        await assertPressurePassActive(options); const requestId = name.slice(0, -5); let request = await readPressureAdmission(options.stateRoot, options.meshId, requestId);
        if (request.state === "succeeded") {
            const reservation = await readMeshReservation(options.stateRoot, options.meshId, request.reservationId!).catch(() => undefined);
            if (reservation?.state === "committed") {
                const task = await durableReservationTask(options.stateRoot, options.meshId, reservation); if (task === "valid" || task === "unavailable") continue;
                const evidence = await inspectRequesterTmux(options, request); if (evidence.state !== "dead") continue;
                if (await reconcileDeadCommittedLaunch(options, request, reservation, evidence.reason ?? "Pressure admission requester is not live")) processed += 1;
                continue;
            }
            const evidence = await inspectRequesterTmux(options, request); if (evidence.state === "unavailable") continue;
            const validPending = reservation?.state === "pending" && reservation.kind === "new-agent-task" && reservation.agentId === undefined && reservation.taskId === undefined;
            if (evidence.state === "dead" || !validPending) { await cancelPressureAdmission(options.stateRoot, options.meshId, requestId, evidence.state === "dead" ? evidence.reason ?? "Pressure admission requester is not live" : "Pressure admission reservation is released or mismatched"); processed += 1; }
            continue;
        }
        if (request.state !== "requested" && request.state !== "processing") continue;
        const evidence = await inspectRequesterTmux(options, request);
        if (evidence.state === "unavailable") continue;
        if (evidence.state === "dead") { await cancelPressureAdmission(options.stateRoot, options.meshId, requestId, evidence.reason ?? "Pressure admission requester is not live"); processed += 1; continue; }
        const claimed = await withMeshLock(options.stateRoot, options.meshId, async () => { if (options.signal?.aborted) throw options.signal.reason; const current = await readPressureAdmission(options.stateRoot, options.meshId, requestId); if (current.state !== "requested" && current.state !== "processing") return undefined; if (current.state === "processing") return current; const next = { ...current, state: "processing" as const, updatedAt: new Date().toISOString() }; await writeAtomicJson(pathFor(options.stateRoot, options.meshId, requestId), next); return next; });
        if (!claimed) continue; request = claimed;
        const destructiveEvidence = await inspectRequesterTmux(options, request);
        if (destructiveEvidence.state === "unavailable") continue;
        if (destructiveEvidence.state === "dead") { await cancelPressureAdmission(options.stateRoot, options.meshId, requestId, destructiveEvidence.reason ?? "Pressure admission requester is not live"); processed += 1; continue; }
        const requesterGuard = async () => { await assertPressurePassActive(options); await assertRequesterLive(options, request); };
        let reservation: BudgetReservation | undefined;
        try {
            reservation = await reserveNewAgentCapacityWithPressure(options, request.requestId, requesterGuard, { agentId: request.requesterAgentId, runtimeId: request.requesterRuntimeId });
            if (!await settle(options.stateRoot, options.meshId, requestId, { reservation }, requesterGuard)) await releaseMeshReservation(options.stateRoot, options.meshId, reservation.reservationId, "pressure admission caller no longer waiting");
        } catch (error) {
            const durableReservation = reservation ?? await readMeshReservation(options.stateRoot, options.meshId, requestId).catch(() => undefined);
            if (error instanceof RequesterUnavailableError) continue;
            if (error instanceof RequesterDeadError || error instanceof PressureAdmissionStaleError) { await cancelPressureAdmission(options.stateRoot, options.meshId, requestId, error.message); processed += 1; continue; }
            if (durableReservation?.state === "pending") await releasePendingMeshReservation(options.stateRoot, options.meshId, durableReservation.reservationId, "pressure admission failed after reservation").catch(() => {});
            if (options.signal?.aborted) throw error;
            await settle(options.stateRoot, options.meshId, requestId, { error: boundedError(error) }, () => assertPressurePassActive(options));
        }
        processed += 1;
    }
    return processed;
}
export async function cancelPressureAdmission(stateRoot: string, meshId: string, requestId: string, reason: string): Promise<void> {
    await withMeshLock(stateRoot, meshId, async () => {
        const latest = await readPressureAdmission(stateRoot, meshId, requestId); if (latest.state === "cancelled" || latest.state === "failed") return;
        const reservationId = latest.reservationId ?? requestId; const reservation = await readMeshReservation(stateRoot, meshId, reservationId).catch(() => undefined); if (reservation?.state === "committed") return;
        const now = new Date().toISOString(); const error = boundedError(reason);
        await writeAtomicJson(pathFor(stateRoot, meshId, requestId), { ...latest, state: "cancelled", updatedAt: now, completedAt: now, reservationId: null, error });
        if (reservation?.state === "pending") await writeAtomicJson(reservationPath(stateRoot, meshId, reservationId), { ...reservation, state: "released", releasedAt: now, releaseReason: error, updatedAt: now });
    });
}
export async function reconcilePressureAdmissions(stateRoot: string, meshId: string, requesterPaneLive: (requester: Awaited<ReturnType<typeof readAgentSnapshot>>) => Promise<boolean>): Promise<ReadonlySet<string>> {
    const names = await readdir(directory(stateRoot, meshId)).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : Promise.reject(error)); const protectedIds = new Set<string>();
    for (const name of names.filter(name => name.endsWith(".json") && UUID.test(name.slice(0, -5))).sort()) {
        const requestId = name.slice(0, -5); const admission = await readPressureAdmission(stateRoot, meshId, requestId); if (admission.state === "failed" || admission.state === "cancelled") continue;
        const reservationId = admission.reservationId ?? requestId; let reservation: BudgetReservation | undefined; let reservationUnavailable = false;
        try { reservation = await readMeshReservation(stateRoot, meshId, reservationId); } catch (error) { reservationUnavailable = (error as NodeJS.ErrnoException).code !== "ENOENT"; }
        if (admission.state === "succeeded") {
            if (reservationUnavailable) { protectedIds.add(reservationId); continue; }
            if (reservation?.state === "committed") {
                if (await durableReservationTask(stateRoot, meshId, reservation) !== "valid") protectedIds.add(reservationId);
                continue;
            }
        }
        const evidence = await inspectRequester(stateRoot, meshId, admission, async requester => await requesterPaneLive(requester) ? "live" : "dead");
        if (evidence.state === "unavailable") { if (reservation?.state === "pending") protectedIds.add(reservationId); continue; }
        let reason = evidence.state === "dead" ? evidence.reason : undefined;
        if (!reason && reservation && (reservation.reservationId !== reservationId || reservation.kind !== "new-agent-task" || reservation.agentId !== undefined || reservation.taskId !== undefined)) reason = "Pressure admission reservation is mismatched";
        else if (!reason && reservation?.state === "pending") protectedIds.add(reservationId);
        else if (!reason && admission.state === "succeeded") reason = "Pressure admission reservation is released or missing";
        if (reason) await cancelPressureAdmission(stateRoot, meshId, requestId, reason);
    }
    return protectedIds;
}
export async function failOpenPressureAdmissions(stateRoot: string, meshId: string, reason = "Mesh root is shutting down"): Promise<number> {
    const names = await readdir(directory(stateRoot, meshId)).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : Promise.reject(error)); let failed = 0;
    for (const name of names.filter(name => name.endsWith(".json"))) { const requestId = name.slice(0, -5); if (!UUID.test(requestId)) continue; const before = await readPressureAdmission(stateRoot, meshId, requestId); await cancelPressureAdmission(stateRoot, meshId, requestId, reason); const after = await readPressureAdmission(stateRoot, meshId, requestId); if (after.state !== before.state && after.state === "cancelled") failed += 1; }
    return failed;
}
export async function awaitPressureAdmission(stateRoot: string, meshId: string, input: { requestId: string; requesterAgentId: string; requesterRuntimeId: string; timeoutMs?: number; signal?: AbortSignal; sleep?: (ms: number) => Promise<void>; now?: () => number }): Promise<BudgetReservation> {
    await requestPressureAdmission(stateRoot, meshId, input); const now = input.now ?? Date.now; const deadline = now() + (input.timeoutMs ?? 10_000); const wait = input.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    while (now() < deadline && !input.signal?.aborted) { const current = await readPressureAdmission(stateRoot, meshId, input.requestId); if (current.state === "succeeded") { await assertCurrentAgentRuntime(stateRoot, meshId, input.requesterAgentId, input.requesterRuntimeId); const reservation = await readMeshReservation(stateRoot, meshId, current.reservationId!); if (reservation.reservationId !== current.reservationId || reservation.meshId !== meshId || reservation.kind !== "new-agent-task" || reservation.state !== "pending" || reservation.agentId !== undefined || reservation.taskId !== undefined) { await cancelPressureAdmission(stateRoot, meshId, input.requestId, "Pressure admission reservation is released or mismatched"); throw new Error("Pressure admission reservation is released or mismatched"); } return reservation; } if (current.state === "failed" || current.state === "cancelled") throw new Error(current.error ?? "Pressure admission failed"); await wait(50); }
    const reason = input.signal?.aborted ? "Pressure admission caller aborted" : "Pressure admission timed out waiting for the mesh root"; await cancelPressureAdmission(stateRoot, meshId, input.requestId, reason); throw input.signal?.aborted ? input.signal.reason : new Error(reason);
}
