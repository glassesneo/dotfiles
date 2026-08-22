import { mapConcurrent } from "./concurrency.ts";
import { withAgentTerminationLock } from "./orchestration_lock.ts";
import { confirmAgentStop, failAgent, failAgentStop, listMeshAgents, markAgentStopTerminating, observeAgentLifecycle, readAgentSnapshot, readAgentStopRequest, requestAgentStop, requestTaskCancellation, type AgentLifecycleObservation } from "./orchestration_store.ts";
import { isTerminalAgent, isTerminalTask, tmuxOwnership, type AgentSnapshot, type AgentStopRequest, type AgentStopSource } from "./orchestration_types.ts";
import { inspectAgentTmux, meshHubName, stopAgentSession, stopMeshHub, type CommandExecutor, type TmuxContext } from "./orchestration_tmux.ts";
import { createExplicitStopNotice, reconcileGcStopNotices, resolveProvenanceParentEndpoint } from "./orchestration_notices.ts";

export type ManagedMeshAgent = AgentSnapshot;
export async function readReconciledAgentSnapshot(exec: CommandExecutor, tmux: string, stateRoot: string, meshId: string, agentId: string, taskId?: string): Promise<AgentSnapshot> {
    let snapshot = await readAgentSnapshot(stateRoot, meshId, agentId, taskId);
    if (isTerminalAgent(snapshot.status.state)) {
        const terminalTmux = await inspectAgentTmux(exec, tmux, snapshot.agent.tmux);
        if (terminalTmux.server === "match" && terminalTmux.paneState === "unavailable") throw new Error("The recorded tmux pane is temporarily unavailable");
        if (terminalTmux.server === "match" && terminalTmux.paneState === "dead") await stopAgentSession(exec, tmux, snapshot.agent.tmux);
        return snapshot;
    }
    const inspected = await inspectAgentTmux(exec, tmux, snapshot.agent.tmux);
    if (inspected.server === "unavailable" || inspected.server === "match" && inspected.paneState === "unavailable") throw new Error("The recorded tmux server or pane is temporarily unavailable");
    if (snapshot.status.state === "stopping") { const request = snapshot.stop; if (request && (request.state === "requested" || request.state === "terminating") && (inspected.server === "absent" || inspected.server === "match" && inspected.paneState === "dead")) { const confirmed = await confirmAgentStop(stateRoot, meshId, agentId, request.stopRequestId); snapshot = await readAgentSnapshot(stateRoot, meshId, agentId, taskId); await ensureConfirmedExplicitStopNotice({ stateRoot, meshId, agentId, exec, tmux }, snapshot, confirmed); return snapshot; } if (inspected.server === "mismatch") return snapshot; }
    if (inspected.server === "match" && !inspected.sessionAlive && inspected.paneAlive && !await stopAgentSession(exec, tmux, snapshot.agent.tmux)) throw new Error("Could not terminate the orphaned linked agent window");
    if (inspected.server !== "match" || !inspected.sessionAlive || !inspected.paneAlive) {
        const reason = inspected.server === "mismatch" ? "The recorded tmux server identity changed" : inspected.server === "absent" ? "The recorded tmux server disappeared" : !inspected.sessionAlive ? `The ${tmuxOwnership(snapshot.agent) === "mesh-hub" ? "mesh tmux hub" : "dedicated tmux agent session"} disappeared` : "The tmux agent pane disappeared before shutdown completed";
        await failAgent(stateRoot, meshId, agentId, reason, snapshot.status.state === "stopping");
        snapshot = await readAgentSnapshot(stateRoot, meshId, agentId, taskId);
    }
    return snapshot;
}

export class MeshAgentDiscovery {
    readonly options: { stateRoot: string; meshId: string; authorizedAgents: readonly string[]; exec: CommandExecutor; tmux: string };
    constructor(options: { stateRoot: string; meshId: string; authorizedAgents: readonly string[]; exec: CommandExecutor; tmux: string }) { this.options = options; }
    async refresh(): Promise<{ agents: AgentSnapshot[]; malformedCount: number }> {
        const found = await listMeshAgents(this.options.stateRoot, this.options.meshId);
        const settled = await mapConcurrent(found, 8, async item => { try { return { status: "fulfilled" as const, value: await readReconciledAgentSnapshot(this.options.exec, this.options.tmux, this.options.stateRoot, this.options.meshId, item.agent.agentId) }; } catch (reason) { return { status: "rejected" as const, reason }; } });
        return { agents: settled.flatMap(result => result.status === "fulfilled" ? [result.value] : []), malformedCount: settled.filter(result => result.status === "rejected").length };
    }
}

interface TerminateAgentOptions { stateRoot: string; meshId: string; agentId: string; exec: CommandExecutor; tmux: string; authorizedAgents?: readonly string[]; callerIdentity?: string }
type StopDisposition = "stopped-now" | "stop-pending" | "already-terminal";
type TerminateAgentResult = { snapshot: AgentSnapshot; disposition: StopDisposition };
async function ensureConfirmedExplicitStopNotice(options: TerminateAgentOptions, snapshot: AgentSnapshot, request: AgentStopRequest): Promise<void> {
    if (request.state !== "confirmed" || request.source !== "user" && request.source !== "peer" || !request.requesterEndpointId) return;
    const endpointId = await resolveProvenanceParentEndpoint(options.stateRoot, snapshot); if (!endpointId) return;
    await createExplicitStopNotice(options.stateRoot, options.meshId, { endpointId, requesterEndpointId: request.requesterEndpointId, payload: { stopRequestId: request.stopRequestId, agentId: snapshot.agent.agentId, role: snapshot.agent.agent, source: request.source, reason: request.reason } }).catch(() => undefined);
}
async function terminateClaimedAgent(options: TerminateAgentOptions, request: AgentStopRequest, initiated: boolean): Promise<TerminateAgentResult> {
    const result = await withAgentTerminationLock(options.stateRoot, options.meshId, options.agentId, async () => {
        let snapshot = await readAgentSnapshot(options.stateRoot, options.meshId, options.agentId);
        const current = await readAgentStopRequest(options.stateRoot, options.meshId, options.agentId);
        if (!current || current.stopRequestId !== request.stopRequestId || current.state !== "requested" && current.state !== "terminating") return { snapshot, request: current, disposition: isTerminalAgent(snapshot.status.state) ? "already-terminal" as const : "stop-pending" as const };
        request = current;
        if (isTerminalAgent(snapshot.status.state)) { request = await confirmAgentStop(options.stateRoot, options.meshId, options.agentId, request.stopRequestId); snapshot = await readAgentSnapshot(options.stateRoot, options.meshId, options.agentId); return { snapshot, request, disposition: "already-terminal" as const }; }
        request = await markAgentStopTerminating(options.stateRoot, options.meshId, options.agentId, request.stopRequestId);
        snapshot = await readAgentSnapshot(options.stateRoot, options.meshId, options.agentId);
        if (request.stopRequestId !== current.stopRequestId || request.state !== "terminating" || snapshot.status.state !== "stopping") return { snapshot, request, disposition: "stop-pending" as const };
        let stopped = false; let failure: unknown;
        try { stopped = await stopAgentSession(options.exec, options.tmux, snapshot.agent.tmux); } catch (error) { failure = error; }
        const evidence = stopped ? { server: "match" as const, paneState: "dead" as const } : await inspectAgentTmux(options.exec, options.tmux, snapshot.agent.tmux).catch(() => undefined);
        const confirmed = stopped || evidence?.server === "absent" || evidence?.server === "match" && evidence.paneState === "dead";
        if (confirmed) { request = await confirmAgentStop(options.stateRoot, options.meshId, options.agentId, request.stopRequestId); snapshot = await readAgentSnapshot(options.stateRoot, options.meshId, options.agentId); return { snapshot, request, disposition: initiated ? "stopped-now" as const : "stop-pending" as const }; }
        if (evidence?.server === "match" && evidence.paneState === "alive") { await failAgentStop(options.stateRoot, options.meshId, options.agentId, request.stopRequestId, "pane-remained-alive"); throw failure ?? new Error("Could not stop the live tmux agent pane"); }
        return { snapshot: await readAgentSnapshot(options.stateRoot, options.meshId, options.agentId), request, disposition: "stop-pending" as const };
    });
    if (result.request) await ensureConfirmedExplicitStopNotice(options, result.snapshot, result.request);
    return { snapshot: result.snapshot, disposition: result.disposition };
}
const activeStops = new Map<string, Promise<TerminateAgentResult>>();
export async function stopMeshAgentWithDisposition(options: TerminateAgentOptions & { source: AgentStopSource; reason: string; requesterEndpointId?: string; terminalState?: "stopped" | "failed"; claimedRequest?: AgentStopRequest; initialLifecycle?: AgentLifecycleObservation }): Promise<TerminateAgentResult> { const snapshot = await readAgentSnapshot(options.stateRoot, options.meshId, options.agentId); const initialLifecycle = options.initialLifecycle ?? await observeAgentLifecycle(options.stateRoot, options.meshId, options.agentId); if (options.authorizedAgents && !options.authorizedAgents.includes(snapshot.agent.agent)) throw new Error(`${options.callerIdentity ?? "Caller"} is not allowed to manage agent ${snapshot.agent.agent}`); const key = `${options.stateRoot}:${options.meshId}:${options.agentId}`; const active = activeStops.get(key); if (active) return { ...(await active), disposition: "stop-pending" }; const claimed = options.claimedRequest ? { request: options.claimedRequest, created: true } : await requestAgentStop(options.stateRoot, options.meshId, options.agentId, { source: options.source, reason: options.reason, ...(options.requesterEndpointId ? { requesterEndpointId: options.requesterEndpointId } : {}), ...(options.terminalState ? { terminalState: options.terminalState } : {}), initialLifecycle }); const attempt = terminateClaimedAgent(options, claimed.request, claimed.created); activeStops.set(key, attempt); try { return await attempt; } finally { if (activeStops.get(key) === attempt) activeStops.delete(key); } }
async function failStartedAgent(options: TerminateAgentOptions, reason: string): Promise<TerminateAgentResult> { return stopMeshAgentWithDisposition({ ...options, source: "recovery", reason, terminalState: "failed" }); }
export async function stopMeshTaskWithDisposition(options: { stateRoot: string; meshId: string; taskId: string; reason?: string; requesterEndpointId?: string; acknowledgementTimeoutMs?: number }): Promise<{ snapshot: AgentSnapshot; disposition: StopDisposition }> {
    const initial = await requestTaskCancellation(options.stateRoot, options.meshId, options.taskId, options.reason ?? "Stopped by mesh peer", options.requesterEndpointId);
    if (!initial.created && !initial.request) return { snapshot: initial.snapshot, disposition: "already-terminal" };
    const disposition: StopDisposition = initial.created ? "stopped-now" : "stop-pending";
    if (initial.snapshot.task && isTerminalTask(initial.snapshot.task.status.state)) return { snapshot: initial.snapshot, disposition };
    const deadline = Date.now() + (options.acknowledgementTimeoutMs ?? 5000);
    while (Date.now() < deadline) { const current = await readAgentSnapshot(options.stateRoot, options.meshId, initial.snapshot.agent.agentId, options.taskId); if (current.task && isTerminalTask(current.task.status.state)) return { snapshot: current, disposition }; await new Promise(resolve => setTimeout(resolve, 25)); }
    throw new Error(`Cancellation acknowledgement timed out for task ${options.taskId}; durable cancellation request remains active`);
}
export async function stopMeshTask(options: Parameters<typeof stopMeshTaskWithDisposition>[0]): Promise<AgentSnapshot> { return (await stopMeshTaskWithDisposition(options)).snapshot; }
export async function failStartedMeshAgent(options: TerminateAgentOptions, reason: string): Promise<AgentSnapshot> { return (await failStartedAgent(options, reason)).snapshot; }
export async function recoverPendingAgentStops(options: { stateRoot: string; meshId: string; exec: CommandExecutor; tmux: string }): Promise<{ confirmed: number; pending: number; failed: number }> { let confirmed = 0; let pending = 0; let failed = 0; for (const snapshot of await listMeshAgents(options.stateRoot, options.meshId)) { const request = await readAgentStopRequest(options.stateRoot, options.meshId, snapshot.agent.agentId); if (!request) continue; try { if (request.state === "confirmed") { await ensureConfirmedExplicitStopNotice({ ...options, agentId: snapshot.agent.agentId }, snapshot, request); continue; } if (request.state !== "requested" && request.state !== "terminating") continue; const result = await stopMeshAgentWithDisposition({ ...options, agentId: snapshot.agent.agentId, source: "recovery", reason: request.reason }); if (result.snapshot.stop?.state === "confirmed") confirmed += 1; else pending += 1; } catch { failed += 1; } } await reconcileGcStopNotices(options.stateRoot, options.meshId).catch(() => {}); return { confirmed, pending, failed }; }
export async function cleanupMeshAgents(options: { stateRoot: string; meshId: string; exec: CommandExecutor; tmux: string; shutdownReason: string; hubContext?: TmuxContext }): Promise<void> {
    const agents = await listMeshAgents(options.stateRoot, options.meshId); const reason = `Mesh root shut down (${options.shutdownReason})`; let failures: Array<{ agentId: string; error: unknown }> = [];
    for (const snapshot of agents) try { const result = await stopMeshAgentWithDisposition({ ...options, agentId: snapshot.agent.agentId, source: "shutdown", reason }); if (result.snapshot.stop?.state !== "confirmed" && !isTerminalAgent(result.snapshot.status.state)) failures.push({ agentId: snapshot.agent.agentId, error: new Error("Agent stop remains pending") }); } catch (error) { failures.push({ agentId: snapshot.agent.agentId, error }); }
    const recordedHub = agents.find(snapshot => tmuxOwnership(snapshot.agent) === "mesh-hub")?.agent.tmux; const hub = options.hubContext ? { socket: options.hubContext.socket, serverPid: options.hubContext.serverPid, sessionName: meshHubName(options.meshId) } : recordedHub; let hubError: unknown;
    if (hub) try { await stopMeshHub(options.exec, options.tmux, hub); } catch (error) { hubError = error; }
    if (!hubError && hub && failures.length) { const retry = failures; failures = []; for (const failure of retry) { const snapshot = agents.find(agent => agent.agent.agentId === failure.agentId); const belongs = snapshot && tmuxOwnership(snapshot.agent) === "mesh-hub" && snapshot.agent.tmux.socket === hub.socket && snapshot.agent.tmux.serverPid === hub.serverPid; if (!belongs) { failures.push(failure); continue; } try { const result = await stopMeshAgentWithDisposition({ ...options, agentId: failure.agentId, source: "shutdown", reason }); if (result.snapshot.stop?.state !== "confirmed" && !isTerminalAgent(result.snapshot.status.state)) failures.push({ agentId: failure.agentId, error: new Error("Agent stop remains pending") }); } catch (error) { failures.push({ agentId: failure.agentId, error }); } } }
    const errors = [...failures.map(failure => new Error(`Agent ${failure.agentId} cleanup failed`, { cause: failure.error })), ...(hubError ? [new Error("Mesh hub cleanup failed", { cause: hubError })] : [])]; if (errors.length) throw new AggregateError(errors, `Mesh ${options.meshId} cleanup remains incomplete`);
}
