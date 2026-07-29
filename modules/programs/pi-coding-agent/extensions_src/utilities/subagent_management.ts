import { agentPaths, failAgent, listOriginAgents, markAgentCleanupPending, markAgentStopping, readAgentSnapshot, restoreAgentAfterStopFailure } from "./subagent_store.ts";
import { isTerminalAgent, type AgentSnapshot } from "./subagent_types.ts";
import { inspectAgentTmux, stopAgentSession, type CommandExecutor } from "./subagent_tmux.ts";
export type ManagedSubagentAgent = AgentSnapshot;
export async function readReconciledAgentSnapshot(exec: CommandExecutor, tmux: string, stateRoot: string, agentId: string, taskId?: string): Promise<AgentSnapshot> {
    let snapshot = await readAgentSnapshot(stateRoot, agentId, taskId);
    if (isTerminalAgent(snapshot.status.state)) return snapshot;
    const inspected = await inspectAgentTmux(exec, tmux, snapshot.agent.tmux);
    if (inspected.server === "unavailable") throw new Error("The recorded tmux server is temporarily unavailable");
    if (inspected.server === "match" && !inspected.sessionAlive && inspected.paneAlive) {
        if (!await stopAgentSession(exec, tmux, snapshot.agent.tmux)) throw new Error("Could not terminate the orphaned linked agent window");
    }
    if (inspected.server !== "match" || !inspected.sessionAlive || !inspected.paneAlive) {
        const reason = inspected.server === "mismatch" ? "The recorded tmux server identity changed" : inspected.server === "absent" ? "The recorded tmux server disappeared" : !inspected.sessionAlive ? "The dedicated tmux agent session disappeared" : "The tmux agent pane disappeared before shutdown completed";
        await failAgent(stateRoot, agentId, reason, snapshot.status.state === "stopping");
        snapshot = await readAgentSnapshot(stateRoot, agentId, taskId);
    }
    return snapshot;
}
export class OriginAgentDiscovery { readonly options: { stateRoot: string; originSessionId: string; exec: CommandExecutor; tmux: string }; constructor(options: { stateRoot: string; originSessionId: string; exec: CommandExecutor; tmux: string }) { this.options = options; } async refresh(): Promise<{ agents: AgentSnapshot[]; malformedCount: number }> { const found = await listOriginAgents(this.options.stateRoot, this.options.originSessionId); const agents: AgentSnapshot[] = []; let malformedCount = 0; for (const item of found) { try { agents.push(await readReconciledAgentSnapshot(this.options.exec, this.options.tmux, this.options.stateRoot, item.agent.agentId)); } catch { malformedCount += 1; } } return { agents, malformedCount }; } }
interface TerminateAgentOptions { stateRoot: string; agentId: string; originSessionId: string; exec: CommandExecutor; tmux: string }
async function terminateSubagentAgent(options: TerminateAgentOptions, reason: string, stopped: boolean, ensureTerminalProcess = false): Promise<AgentSnapshot> {
    const snapshot = await readAgentSnapshot(options.stateRoot, options.agentId);
    if (snapshot.agent.originSessionId !== options.originSessionId) throw new Error(`Agent ${options.agentId} belongs to a different origin session`);
    if (isTerminalAgent(snapshot.status.state)) {
        if (!ensureTerminalProcess) return snapshot;
        try {
            if (!await stopAgentSession(options.exec, options.tmux, snapshot.agent.tmux)) {
                const inspected = await inspectAgentTmux(options.exec, options.tmux, snapshot.agent.tmux);
                if (inspected.server === "unavailable" || inspected.server === "match" && inspected.paneAlive) throw new Error("Could not confirm that the terminal child pane stopped");
            }
        } catch (error) {
            const inspected = await inspectAgentTmux(options.exec, options.tmux, snapshot.agent.tmux).catch(() => undefined);
            if (!inspected || inspected.server === "unavailable" || inspected.server === "match" && inspected.paneAlive) {
                await markAgentCleanupPending(agentPaths(options.stateRoot, options.agentId));
                throw error;
            }
        }
        return readAgentSnapshot(options.stateRoot, options.agentId);
    }
    const stopping = await markAgentStopping(agentPaths(options.stateRoot, options.agentId));
    if (isTerminalAgent(stopping.state)) return ensureTerminalProcess ? terminateSubagentAgent(options, reason, stopped, true) : readAgentSnapshot(options.stateRoot, options.agentId);
    try {
        if (!await stopAgentSession(options.exec, options.tmux, snapshot.agent.tmux)) throw new Error("The recorded tmux server is unavailable or its identity changed");
    } catch (error) {
        const inspected = await inspectAgentTmux(options.exec, options.tmux, snapshot.agent.tmux).catch(async () => {
            await restoreAgentAfterStopFailure(options.stateRoot, options.agentId);
            throw error;
        });
        if (inspected.server === "unavailable" || inspected.server === "match" && inspected.paneAlive) {
            await restoreAgentAfterStopFailure(options.stateRoot, options.agentId);
            throw error;
        }
    }
    await failAgent(options.stateRoot, options.agentId, reason, stopped);
    return readAgentSnapshot(options.stateRoot, options.agentId);
}
export async function stopSubagentAgent(options: TerminateAgentOptions): Promise<AgentSnapshot> { return terminateSubagentAgent(options, "Stopped by parent", true); }
export async function failStartedSubagentAgent(options: TerminateAgentOptions, reason: string): Promise<AgentSnapshot> { return terminateSubagentAgent(options, reason, false, true); }
