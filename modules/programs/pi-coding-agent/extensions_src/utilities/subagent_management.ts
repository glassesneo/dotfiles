import { mapConcurrent } from "./subagent_concurrency.ts";
import { agentPaths, failAgent, listOriginAgents, markAgentCleanupPending, markAgentStoppingWithDisposition, readAgentSnapshot, requestTaskCancellation, restoreAgentAfterStopFailure } from "./subagent_store.ts";
import { isTerminalAgent, isTerminalTask, tmuxOwnership, type AgentSnapshot } from "./subagent_types.ts";
import { inspectAgentTmux, originHubName, stopAgentSession, stopOriginHub, type CommandExecutor, type TmuxContext } from "./subagent_tmux.ts";
export type ManagedSubagentAgent = AgentSnapshot;
export async function readReconciledAgentSnapshot(exec: CommandExecutor, tmux: string, stateRoot: string, agentId: string, taskId?: string): Promise<AgentSnapshot> {
    let snapshot = await readAgentSnapshot(stateRoot, agentId, taskId);
    if (isTerminalAgent(snapshot.status.state)) {
        const terminalTmux = await inspectAgentTmux(exec, tmux, snapshot.agent.tmux);
        if (terminalTmux.server === "match" && terminalTmux.paneState === "unavailable") throw new Error("The recorded tmux pane is temporarily unavailable");
        if (terminalTmux.server === "match" && terminalTmux.paneState === "dead") await stopAgentSession(exec, tmux, snapshot.agent.tmux);
        return snapshot;
    }
    const inspected = await inspectAgentTmux(exec, tmux, snapshot.agent.tmux);
    if (inspected.server === "unavailable" || inspected.server === "match" && inspected.paneState === "unavailable") throw new Error("The recorded tmux server or pane is temporarily unavailable");
    if (inspected.server === "match" && !inspected.sessionAlive && inspected.paneAlive) {
        if (!await stopAgentSession(exec, tmux, snapshot.agent.tmux)) throw new Error("Could not terminate the orphaned linked agent window");
    }
    if (inspected.server !== "match" || !inspected.sessionAlive || !inspected.paneAlive) {
        const reason = inspected.server === "mismatch" ? "The recorded tmux server identity changed" : inspected.server === "absent" ? "The recorded tmux server disappeared" : !inspected.sessionAlive ? `The ${tmuxOwnership(snapshot.agent) === "origin-hub" ? "origin tmux hub" : "dedicated tmux agent session"} disappeared` : "The tmux agent pane disappeared before shutdown completed";
        await failAgent(stateRoot, agentId, reason, snapshot.status.state === "stopping");
        snapshot = await readAgentSnapshot(stateRoot, agentId, taskId);
    }
    return snapshot;
}
export class OriginAgentDiscovery {
    readonly options: { stateRoot: string; originSessionId: string; exec: CommandExecutor; tmux: string };
    constructor(options: { stateRoot: string; originSessionId: string; exec: CommandExecutor; tmux: string }) { this.options = options; }
    async refresh(): Promise<{ agents: AgentSnapshot[]; malformedCount: number }> {
        const found = await listOriginAgents(this.options.stateRoot, this.options.originSessionId);
        const settled = await mapConcurrent(found, 8, async item => {
            try {
                return { status: "fulfilled" as const, value: await readReconciledAgentSnapshot(
                    this.options.exec,
                    this.options.tmux,
                    this.options.stateRoot,
                    item.agent.agentId,
                ) };
            } catch (reason) { return { status: "rejected" as const, reason }; }
        });
        return {
            agents: settled.flatMap(result => result.status === "fulfilled" ? [result.value] : []),
            malformedCount: settled.filter(result => result.status === "rejected").length,
        };
    }
}
interface TerminateAgentOptions { stateRoot: string; agentId: string; originSessionId: string; exec: CommandExecutor; tmux: string }
async function waitForExternalStopAcknowledgement(stateRoot: string, agentId: string): Promise<void> {
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
        const status = (await readAgentSnapshot(stateRoot, agentId)).status;
        if (isTerminalAgent(status.state) || status.state === "stopping" && !status.activeTaskId) return;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
}
type StopDisposition = "stopped-now" | "stop-pending" | "already-terminal";
type TerminateAgentResult = { snapshot: AgentSnapshot; disposition: StopDisposition };
async function terminateSubagentAgent(options: TerminateAgentOptions, reason: string, stopped: boolean, ensureTerminalProcess = false): Promise<TerminateAgentResult> {
    const snapshot = await readAgentSnapshot(options.stateRoot, options.agentId);
    if (snapshot.agent.originSessionId !== options.originSessionId) throw new Error(`Agent ${options.agentId} belongs to a different origin session`);
    if (isTerminalAgent(snapshot.status.state)) {
        if (!ensureTerminalProcess) return { snapshot, disposition: "already-terminal" };
        try {
            if (!await stopAgentSession(options.exec, options.tmux, snapshot.agent.tmux)) {
                const inspected = await inspectAgentTmux(options.exec, options.tmux, snapshot.agent.tmux);
                if (inspected.server === "unavailable" || inspected.server === "match" && inspected.paneState !== "dead") throw new Error("Could not confirm that the terminal child pane stopped");
            }
        } catch (error) {
            const inspected = await inspectAgentTmux(options.exec, options.tmux, snapshot.agent.tmux).catch(() => undefined);
            if (!inspected || inspected.server === "unavailable" || inspected.server === "match" && inspected.paneState !== "dead") {
                await markAgentCleanupPending(agentPaths(options.stateRoot, options.agentId));
                throw error;
            }
        }
        return { snapshot: await readAgentSnapshot(options.stateRoot, options.agentId), disposition: "already-terminal" };
    }
    const stopping = await markAgentStoppingWithDisposition(agentPaths(options.stateRoot, options.agentId));
    const disposition: StopDisposition = stopping.initiated ? "stopped-now" : isTerminalAgent(stopping.status.state) ? "already-terminal" : "stop-pending";
    if (isTerminalAgent(stopping.status.state)) return ensureTerminalProcess ? terminateSubagentAgent(options, reason, stopped, true) : { snapshot: await readAgentSnapshot(options.stateRoot, options.agentId), disposition };
    if (snapshot.agent.harness !== "pi") await waitForExternalStopAcknowledgement(options.stateRoot, options.agentId);
    try {
        if (!await stopAgentSession(options.exec, options.tmux, snapshot.agent.tmux)) throw new Error("The recorded tmux server is unavailable or its identity changed");
    } catch (error) {
        const inspected = await inspectAgentTmux(options.exec, options.tmux, snapshot.agent.tmux).catch(async () => {
            await restoreAgentAfterStopFailure(options.stateRoot, options.agentId);
            throw error;
        });
        if (inspected.server === "unavailable" || inspected.server === "match" && inspected.paneState !== "dead") {
            await restoreAgentAfterStopFailure(options.stateRoot, options.agentId);
            throw error;
        }
    }
    await failAgent(options.stateRoot, options.agentId, reason, stopped, { overrideTerminalReason: stopped });
    return { snapshot: await readAgentSnapshot(options.stateRoot, options.agentId), disposition };
}
const activeAgentStops = new Map<string, Promise<TerminateAgentResult>>();
async function coordinatedTerminateSubagentAgent(options: TerminateAgentOptions, reason: string, stopped: boolean, ensureTerminalProcess = false): Promise<TerminateAgentResult> {
    const key = `${options.stateRoot}:${options.agentId}`;
    const active = activeAgentStops.get(key);
    if (active) return { ...(await active), disposition: "stop-pending" };
    const attempt = terminateSubagentAgent(options, reason, stopped, ensureTerminalProcess);
    activeAgentStops.set(key, attempt);
    try { return await attempt; }
    finally { if (activeAgentStops.get(key) === attempt) activeAgentStops.delete(key); }
}
export async function stopSubagentAgentWithDisposition(options: TerminateAgentOptions): Promise<TerminateAgentResult> { return coordinatedTerminateSubagentAgent(options, "Stopped by parent", true); }
export async function stopSubagentAgent(options: TerminateAgentOptions): Promise<AgentSnapshot> { return (await stopSubagentAgentWithDisposition(options)).snapshot; }
export async function stopSubagentTaskWithDisposition(options: { stateRoot: string; agentId: string; taskId: string; originSessionId: string; reason?: string; acknowledgementTimeoutMs?: number }): Promise<{ snapshot: AgentSnapshot; disposition: StopDisposition }> {
    const snapshot = await readAgentSnapshot(options.stateRoot, options.agentId, options.taskId);
    if (snapshot.agent.originSessionId !== options.originSessionId) throw new Error(`Agent ${options.agentId} belongs to a different origin session`);
    if (!snapshot.task) throw new Error(`Task ${options.taskId} was not found for agent ${options.agentId}`);
    if (isTerminalTask(snapshot.task.status.state)) return { snapshot, disposition: "already-terminal" };
    const requested = await requestTaskCancellation(options.stateRoot, options.agentId, options.taskId, options.reason ?? "Stopped by parent");
    if (!requested.created && !requested.request) return { snapshot: requested.snapshot, disposition: "already-terminal" };
    const disposition: StopDisposition = requested.created ? "stopped-now" : "stop-pending";
    if (requested.snapshot.task && isTerminalTask(requested.snapshot.task.status.state)) return { snapshot: requested.snapshot, disposition };
    const deadline = Date.now() + (options.acknowledgementTimeoutMs ?? 5000);
    while (Date.now() < deadline) {
        const current = await readAgentSnapshot(options.stateRoot, options.agentId, options.taskId);
        if (current.task && isTerminalTask(current.task.status.state)) return { snapshot: current, disposition };
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Cancellation acknowledgement timed out for agent ${options.agentId}, task ${options.taskId}; durable cancellation request remains active`);
}
export async function stopSubagentTask(options: Parameters<typeof stopSubagentTaskWithDisposition>[0]): Promise<AgentSnapshot> { return (await stopSubagentTaskWithDisposition(options)).snapshot; }
export async function failStartedSubagentAgent(options: TerminateAgentOptions, reason: string): Promise<AgentSnapshot> { return (await coordinatedTerminateSubagentAgent(options, reason, false, true)).snapshot; }
export async function cleanupOriginAgents(options: { stateRoot: string; originSessionId: string; exec: CommandExecutor; tmux: string; shutdownReason: string; hubContext?: TmuxContext }): Promise<void> {
    const agents = await listOriginAgents(options.stateRoot, options.originSessionId);
    const reason = `Parent session shut down (${options.shutdownReason})`;
    let failures: Array<{ agentId: string; error: unknown }> = [];
    for (const snapshot of agents) {
        try { await coordinatedTerminateSubagentAgent({ ...options, agentId: snapshot.agent.agentId }, reason, true, true); }
        catch (error) { failures.push({ agentId: snapshot.agent.agentId, error }); }
    }
    const recordedHub = agents.find(snapshot => tmuxOwnership(snapshot.agent) === "origin-hub")?.agent.tmux;
    const hub = options.hubContext ? { socket: options.hubContext.socket, serverPid: options.hubContext.serverPid, sessionName: originHubName(options.originSessionId) } : recordedHub;
    let hubError: unknown;
    if (hub) try { await stopOriginHub(options.exec, options.tmux, hub); } catch (error) { hubError = error; }
    if (!hubError && hub && failures.length) {
        const retry = failures;
        failures = [];
        for (const failure of retry) {
            const snapshot = agents.find(agent => agent.agent.agentId === failure.agentId);
            const belongsToKilledHub = snapshot && tmuxOwnership(snapshot.agent) === "origin-hub" && snapshot.agent.tmux.socket === hub.socket && snapshot.agent.tmux.serverPid === hub.serverPid;
            if (!belongsToKilledHub) { failures.push(failure); continue; }
            try { await coordinatedTerminateSubagentAgent({ ...options, agentId: failure.agentId }, reason, true, true); }
            catch (error) { failures.push({ agentId: failure.agentId, error }); }
        }
    }
    const errors = [...failures.map(failure => new Error(`Agent ${failure.agentId} cleanup failed`, { cause: failure.error })), ...(hubError ? [new Error("Origin hub cleanup failed", { cause: hubError })] : [])];
    if (errors.length) throw new AggregateError(errors, `Origin ${options.originSessionId} cleanup remains incomplete`);
}
