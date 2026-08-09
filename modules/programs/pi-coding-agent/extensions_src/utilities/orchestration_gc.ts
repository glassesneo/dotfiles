import { randomUUID } from "node:crypto";
import type { MeshGcConfig } from "./agent_types.ts";
import { projectAgentActivity, readAgentActivity } from "./orchestration_activity.ts";
import { readAgentRuntimeBinding } from "./orchestration_runtime.ts";
import { stopMeshAgentWithDisposition } from "./orchestration_management.ts";
import { assertRootLeaseOwner, claimIdleAgentForStop, listMeshAgents, readMesh, reserveMeshCapacity, reservePressureCapacityOrClaimIdleAgent, type IdleStopRoleMinimum } from "./orchestration_store.ts";
import type { CommandExecutor } from "./orchestration_tmux.ts";
import type { AgentSnapshot, BudgetReservation } from "./orchestration_types.ts";
import { reconcileGcStopNotices } from "./orchestration_notices.ts";

interface GcOptions { stateRoot: string; meshId: string; leaseId: string; gc: MeshGcConfig; exec: CommandExecutor; tmux: string; signal?: AbortSignal; beforeClaim?: (candidate: { agentId: string; source: "gc-role" | "gc-context" | "gc-pressure" }) => Promise<void> }
interface Candidate { snapshot: AgentSnapshot; sequence: number; kind: "context" | "reusable"; roleMinimum?: IdleStopRoleMinimum }
export interface GcPassResult { gcPassId: string; confirmed: string[]; pending: string[]; failed: Array<{ agentId: string; error: string }> }
export class PressureAdmissionStaleError extends Error {}

function oldest(left: Candidate, right: Candidate): number {
    return (left.snapshot.activity.phaseSince ?? "").localeCompare(right.snapshot.activity.phaseSince ?? "")
        || left.snapshot.agent.createdAt.localeCompare(right.snapshot.agent.createdAt)
        || left.snapshot.agent.agentId.localeCompare(right.snapshot.agent.agentId);
}
async function candidates(options: GcOptions): Promise<Candidate[]> {
    const snapshots = await listMeshAgents(options.stateRoot, options.meshId); const values: Candidate[] = [];
    for (const snapshot of snapshots) {
        if (snapshot.status.state !== "idle" || snapshot.status.activeTaskId || snapshot.activity.phase !== "idle" || snapshot.activity.pendingMessages) continue;
        const [activity, runtime] = await Promise.all([readAgentActivity(options.stateRoot, options.meshId, snapshot.agent.agentId).catch(() => undefined), readAgentRuntimeBinding(options.stateRoot, options.meshId, snapshot.agent.agentId)]);
        if (!activity || !runtime || activity.runtimeId !== runtime.runtimeId || activity.sequence < 1) continue;
        const observed = projectAgentActivity(snapshot.status, activity, { staleMs: options.gc.activityStaleMs, expectedRuntimeId: runtime.runtimeId, allowUnsupportedContext: snapshot.agent.harness !== "pi" });
        if (observed.context.health === "retire") values.push({ snapshot: { ...snapshot, activity: observed }, sequence: activity.sequence, kind: "context" });
        else if (observed.acceptingTask) values.push({ snapshot: { ...snapshot, activity: observed }, sequence: activity.sequence, kind: "reusable" });
    }
    return values.sort(oldest);
}
async function assertGcPassActive(options: GcOptions): Promise<void> { if (options.signal?.aborted) throw options.signal.reason; await assertRootLeaseOwner(options.stateRoot, options.meshId, options.leaseId); if (options.signal?.aborted) throw options.signal.reason; }
async function collect(options: GcOptions, selected: Candidate[], source: "gc-role" | "gc-context" | "gc-pressure", result: GcPassResult, beforeClaim?: () => Promise<void>): Promise<void> {
    for (const candidate of selected) {
        await assertGcPassActive(options);
        const reason = source === "gc-context" ? "Context headroom reached the retirement threshold" : source === "gc-role" ? `Role ${candidate.snapshot.agent.agent} exceeded its idle retention policy` : "Live-agent capacity required idle agent reclamation";
        await beforeClaim?.();
        await options.beforeClaim?.({ agentId: candidate.snapshot.agent.agentId, source });
        const request = await claimIdleAgentForStop(options.stateRoot, options.meshId, candidate.snapshot.agent.agentId, { source, reason, activitySequence: candidate.sequence, gcPassId: result.gcPassId, staleMs: options.gc.activityStaleMs, allowContextRetire: candidate.kind === "context", ...(candidate.roleMinimum ? { roleMinimum: candidate.roleMinimum } : {}) });
        if (!request) continue;
        try {
            await assertGcPassActive(options);
            const stopped = await stopMeshAgentWithDisposition({ ...options, agentId: candidate.snapshot.agent.agentId, source, reason, claimedRequest: request });
            if (stopped.snapshot.stop?.state === "confirmed") result.confirmed.push(candidate.snapshot.agent.agentId); else result.pending.push(candidate.snapshot.agent.agentId);
        } catch (error) { result.failed.push({ agentId: candidate.snapshot.agent.agentId, error: error instanceof Error ? error.message : String(error) }); }
    }
}
async function createGcPassNotices(options: GcOptions, _result: GcPassResult): Promise<void> { await reconcileGcStopNotices(options.stateRoot, options.meshId).catch(() => {}); }

export async function runPeriodicAgentGc(options: GcOptions): Promise<GcPassResult> {
    await assertGcPassActive(options); const result: GcPassResult = { gcPassId: randomUUID(), confirmed: [], pending: [], failed: [] };
    let current = await candidates(options); await collect(options, current.filter(item => item.kind === "context"), "gc-context", result);
    current = await candidates(options); const byRole = new Map<string, Candidate[]>();
    for (const candidate of current.filter(item => item.kind === "reusable")) { const role = candidate.snapshot.agent.agent; const items = byRole.get(role) ?? []; items.push(candidate); byRole.set(role, items); }
    for (const role of [...byRole.keys()].sort()) { const items = byRole.get(role)!; const policy = options.gc.roles[role]; if (policy && items.length >= policy.collectAt) await collect(options, items.slice(0, Math.max(0, items.length - policy.retain)).map(candidate => ({ ...candidate, roleMinimum: { role, tier: "retain" as const, minimum: policy.retain } })), "gc-role", result); }
    await createGcPassNotices(options, result); return result;
}
function pressureCandidate(items: Candidate[], gc: MeshGcConfig, attempted: ReadonlySet<string> = new Set()): Candidate | undefined {
    const context = items.filter(item => item.kind === "context" && !attempted.has(item.snapshot.agent.agentId)); if (context.length) return context[0];
    const reusable = items.filter(item => item.kind === "reusable"); const reusableCounts = new Map<string, number>(); for (const item of reusable) reusableCounts.set(item.snapshot.agent.agent, (reusableCounts.get(item.snapshot.agent.agent) ?? 0) + 1);
    const select = (tier: IdleStopRoleMinimum["tier"]): Candidate | undefined => { const selected = reusable.find(item => !attempted.has(item.snapshot.agent.agentId) && (reusableCounts.get(item.snapshot.agent.agent) ?? 0) > (gc.roles[item.snapshot.agent.agent]?.[tier] ?? Number.POSITIVE_INFINITY)); if (!selected) return undefined; return { ...selected, roleMinimum: { role: selected.snapshot.agent.agent, tier, minimum: gc.roles[selected.snapshot.agent.agent]![tier] } }; };
    return select("retain") ?? select("pressureFloor");
}
export async function reserveNewAgentCapacityWithPressure(options: GcOptions, requestedReservationId?: string, requesterGuard?: () => Promise<void>, requester?: { agentId: string; runtimeId: string }): Promise<BudgetReservation> {
    const reservationId = requestedReservationId ?? randomUUID();
    const retryReservation = async (): Promise<BudgetReservation | undefined> => {
        try { return await reserveMeshCapacity(options.stateRoot, options.meshId, "new-agent-task", undefined, reservationId); }
        catch (error) { if (!(error instanceof Error) || !/live-agent capacity exhausted/u.test(error.message)) throw error; return undefined; }
    };
    const initial = await retryReservation(); if (initial) return initial;
    await assertGcPassActive(options); const mesh = await readMesh(options.stateRoot, options.meshId); const passLimit = (await listMeshAgents(options.stateRoot, options.meshId)).filter(item => ["creating", "idle", "busy", "stopping"].includes(item.status.state)).length; const attempted = new Set<string>(); const result: GcPassResult = { gcPassId: randomUUID(), confirmed: [], pending: [], failed: [] };
    try {
        for (let attempt = 0; attempt < passLimit; attempt += 1) {
            await assertGcPassActive(options); const beforeSelection = await retryReservation(); if (beforeSelection) return beforeSelection;
            const snapshots = await listMeshAgents(options.stateRoot, options.meshId); const items = await candidates(options); const victim = pressureCandidate(items, options.gc, attempted); if (!victim) { const unknown = snapshots.filter(item => item.activity.phase === "unknown").length; const stopping = snapshots.filter(item => item.status.state === "stopping").length; throw new Error(`Mesh live-agent capacity exhausted (${mesh.budgets.maxLiveAgents}); no pressure GC candidate (tiers=context,retain,floor; unknown=${unknown}; stopping=${stopping})`); }
            await requesterGuard?.();
            const boundary = await reservePressureCapacityOrClaimIdleAgent(options.stateRoot, options.meshId, { reservationId, victimAgentId: victim.snapshot.agent.agentId, claim: { source: "gc-pressure", reason: "Live-agent capacity required idle agent reclamation", activitySequence: victim.sequence, gcPassId: result.gcPassId, staleMs: options.gc.activityStaleMs, allowContextRetire: victim.kind === "context", ...(victim.roleMinimum ? { roleMinimum: victim.roleMinimum } : {}) }, ...(requestedReservationId && requester ? { admission: { requestId: requestedReservationId, requesterAgentId: requester.agentId, requesterRuntimeId: requester.runtimeId } } : {}) });
            if (boundary.kind === "reserved") return boundary.reservation;
            if (boundary.kind === "stale-admission") throw new PressureAdmissionStaleError("Pressure admission is no longer processing for its current requester runtime");
            if (boundary.kind === "ineligible-victim") { attempted.add(victim.snapshot.agent.agentId); continue; }
            const claimedRequest = boundary.request;
            attempted.add(victim.snapshot.agent.agentId); const confirmedBefore = result.confirmed.length;
            try { const stopped = await stopMeshAgentWithDisposition({ ...options, agentId: victim.snapshot.agent.agentId, source: "gc-pressure", reason: claimedRequest.reason, claimedRequest }); if (stopped.snapshot.stop?.state === "confirmed") result.confirmed.push(victim.snapshot.agent.agentId); else result.pending.push(victim.snapshot.agent.agentId); }
            catch (error) { result.failed.push({ agentId: victim.snapshot.agent.agentId, error: error instanceof Error ? error.message : String(error) }); }
            if (result.confirmed.length === confirmedBefore) continue;
            await assertGcPassActive(options); const afterReclamation = await retryReservation(); if (afterReclamation) return afterReclamation;
        }
        throw new Error(`Mesh live-agent capacity exhausted (${mesh.budgets.maxLiveAgents}); pressure GC retry bound reached`);
    } finally { await createGcPassNotices(options, result); }
}
