import { mapConcurrent } from "./orchestration_concurrency.ts";
import { failAgent, listMeshAgents, markAgentCleanupPending, markAgentStoppingWithDisposition, readAgentSnapshot, requestTaskCancellation, restoreAgentAfterStopFailure } from "./orchestration_store.ts";
import { isTerminalAgent, isTerminalTask, tmuxOwnership, type AgentSnapshot } from "./orchestration_types.ts";
import { inspectAgentTmux, meshHubName, stopAgentSession, stopMeshHub, type CommandExecutor, type TmuxContext } from "./orchestration_tmux.ts";

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
async function waitForExternalStopAcknowledgement(options: TerminateAgentOptions): Promise<void> { const deadline = Date.now() + 1000; while (Date.now() < deadline) { const status = (await readAgentSnapshot(options.stateRoot, options.meshId, options.agentId)).status; if (isTerminalAgent(status.state) || status.state === "stopping" && !status.activeTaskId) return; await new Promise(resolve => setTimeout(resolve, 25)); } }
async function terminateMeshAgent(options: TerminateAgentOptions, reason: string, stopped: boolean, ensureTerminalProcess = false): Promise<TerminateAgentResult> {
    const snapshot = await readAgentSnapshot(options.stateRoot, options.meshId, options.agentId);
    if (options.authorizedAgents && !options.authorizedAgents.includes(snapshot.agent.agent)) throw new Error(`${options.callerIdentity ?? "Caller"} is not allowed to manage agent ${snapshot.agent.agent}`);
    if (isTerminalAgent(snapshot.status.state)) {
        if (!ensureTerminalProcess) return { snapshot, disposition: "already-terminal" };
        try { if (!await stopAgentSession(options.exec, options.tmux, snapshot.agent.tmux)) { const inspected = await inspectAgentTmux(options.exec, options.tmux, snapshot.agent.tmux); if (inspected.server === "unavailable" || inspected.server === "match" && inspected.paneState !== "dead") throw new Error("Could not confirm that the terminal agent pane stopped"); } }
        catch (error) { const inspected = await inspectAgentTmux(options.exec, options.tmux, snapshot.agent.tmux).catch(() => undefined); if (!inspected || inspected.server === "unavailable" || inspected.server === "match" && inspected.paneState !== "dead") { await markAgentCleanupPending(options.stateRoot, options.meshId, options.agentId); throw error; } }
        return { snapshot: await readAgentSnapshot(options.stateRoot, options.meshId, options.agentId), disposition: "already-terminal" };
    }
    const stopping = await markAgentStoppingWithDisposition(options.stateRoot, options.meshId, options.agentId);
    const disposition: StopDisposition = stopping.initiated ? "stopped-now" : isTerminalAgent(stopping.status.state) ? "already-terminal" : "stop-pending";
    if (isTerminalAgent(stopping.status.state)) return ensureTerminalProcess ? terminateMeshAgent(options, reason, stopped, true) : { snapshot: await readAgentSnapshot(options.stateRoot, options.meshId, options.agentId), disposition };
    if (snapshot.agent.harness !== "pi") await waitForExternalStopAcknowledgement(options);
    try { if (!await stopAgentSession(options.exec, options.tmux, snapshot.agent.tmux)) throw new Error("The recorded tmux server is unavailable or its identity changed"); }
    catch (error) { const inspected = await inspectAgentTmux(options.exec, options.tmux, snapshot.agent.tmux).catch(async () => { await restoreAgentAfterStopFailure(options.stateRoot, options.meshId, options.agentId); throw error; }); if (inspected.server === "unavailable" || inspected.server === "match" && inspected.paneState !== "dead") { await restoreAgentAfterStopFailure(options.stateRoot, options.meshId, options.agentId); throw error; } }
    await failAgent(options.stateRoot, options.meshId, options.agentId, reason, stopped, { overrideTerminalReason: stopped });
    return { snapshot: await readAgentSnapshot(options.stateRoot, options.meshId, options.agentId), disposition };
}
const activeStops = new Map<string, Promise<TerminateAgentResult>>();
async function coordinatedTerminate(options: TerminateAgentOptions, reason: string, stopped: boolean, ensureTerminalProcess = false): Promise<TerminateAgentResult> { const key = `${options.stateRoot}:${options.meshId}:${options.agentId}`; const active = activeStops.get(key); if (active) return { ...(await active), disposition: "stop-pending" }; const attempt = terminateMeshAgent(options, reason, stopped, ensureTerminalProcess); activeStops.set(key, attempt); try { return await attempt; } finally { if (activeStops.get(key) === attempt) activeStops.delete(key); } }
export async function stopMeshAgentWithDisposition(options: TerminateAgentOptions): Promise<TerminateAgentResult> { return coordinatedTerminate(options, "Stopped by mesh peer", true); }
export async function stopMeshTaskWithDisposition(options: { stateRoot: string; meshId: string; taskId: string; reason?: string; acknowledgementTimeoutMs?: number }): Promise<{ snapshot: AgentSnapshot; disposition: StopDisposition }> {
    const initial = await requestTaskCancellation(options.stateRoot, options.meshId, options.taskId, options.reason ?? "Stopped by mesh peer");
    if (!initial.created && !initial.request) return { snapshot: initial.snapshot, disposition: "already-terminal" };
    const disposition: StopDisposition = initial.created ? "stopped-now" : "stop-pending";
    if (initial.snapshot.task && isTerminalTask(initial.snapshot.task.status.state)) return { snapshot: initial.snapshot, disposition };
    const deadline = Date.now() + (options.acknowledgementTimeoutMs ?? 5000);
    while (Date.now() < deadline) { const current = await readAgentSnapshot(options.stateRoot, options.meshId, initial.snapshot.agent.agentId, options.taskId); if (current.task && isTerminalTask(current.task.status.state)) return { snapshot: current, disposition }; await new Promise(resolve => setTimeout(resolve, 25)); }
    throw new Error(`Cancellation acknowledgement timed out for task ${options.taskId}; durable cancellation request remains active`);
}
export async function stopMeshTask(options: Parameters<typeof stopMeshTaskWithDisposition>[0]): Promise<AgentSnapshot> { return (await stopMeshTaskWithDisposition(options)).snapshot; }
export async function failStartedMeshAgent(options: TerminateAgentOptions, reason: string): Promise<AgentSnapshot> { return (await coordinatedTerminate(options, reason, false, true)).snapshot; }
export async function cleanupMeshAgents(options: { stateRoot: string; meshId: string; exec: CommandExecutor; tmux: string; shutdownReason: string; hubContext?: TmuxContext }): Promise<void> {
    const agents = await listMeshAgents(options.stateRoot, options.meshId); const reason = `Mesh root shut down (${options.shutdownReason})`; let failures: Array<{ agentId: string; error: unknown }> = [];
    for (const snapshot of agents) try { await coordinatedTerminate({ ...options, agentId: snapshot.agent.agentId }, reason, true, true); } catch (error) { failures.push({ agentId: snapshot.agent.agentId, error }); }
    const recordedHub = agents.find(snapshot => tmuxOwnership(snapshot.agent) === "mesh-hub")?.agent.tmux; const hub = options.hubContext ? { socket: options.hubContext.socket, serverPid: options.hubContext.serverPid, sessionName: meshHubName(options.meshId) } : recordedHub; let hubError: unknown;
    if (hub) try { await stopMeshHub(options.exec, options.tmux, hub); } catch (error) { hubError = error; }
    if (!hubError && hub && failures.length) { const retry = failures; failures = []; for (const failure of retry) { const snapshot = agents.find(agent => agent.agent.agentId === failure.agentId); const belongs = snapshot && tmuxOwnership(snapshot.agent) === "mesh-hub" && snapshot.agent.tmux.socket === hub.socket && snapshot.agent.tmux.serverPid === hub.serverPid; if (!belongs) { failures.push(failure); continue; } try { await coordinatedTerminate({ ...options, agentId: failure.agentId }, reason, true, true); } catch (error) { failures.push({ agentId: failure.agentId, error }); } } }
    const errors = [...failures.map(failure => new Error(`Agent ${failure.agentId} cleanup failed`, { cause: failure.error })), ...(hubError ? [new Error("Mesh hub cleanup failed", { cause: hubError })] : [])]; if (errors.length) throw new AggregateError(errors, `Mesh ${options.meshId} cleanup remains incomplete`);
}
