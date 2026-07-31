import { randomUUID } from "node:crypto";
import { access, copyFile, chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { isTerminalAgent, type AgentSnapshot } from "./subagent_types.ts";
import { inspectAgentTmux, launchHubWindow, openAgentWindow, stopAgentSession, type CommandExecutor, type TmuxContext } from "./subagent_tmux.ts";

function quote(value: string): string { return `'${value.replaceAll("'", `'"'"'`)}'`; }
async function sessionId(path: string): Promise<string | undefined> {
    const first = (await readFile(path, "utf8")).split("\n", 1)[0];
    if (!first) return undefined;
    try { const value = JSON.parse(first) as Record<string, unknown>; return value.type === "session" && typeof value.id === "string" ? value.id : undefined; }
    catch { return undefined; }
}
export function historyAvailability(snapshot: AgentSnapshot): { available: boolean; reason?: string } {
    if (!isTerminalAgent(snapshot.status.state)) return { available: false, reason: "agent is live" };
    if (snapshot.agent.capabilities.terminalHistory === false) return { available: false, reason: `history unavailable for ${snapshot.agent.harness} harness` };
    if (!snapshot.status.childSessionId || !snapshot.status.childSessionFile) return { available: false, reason: "history unavailable" };
    return { available: true };
}
export interface HistoryLaunchDependencies { waitUntilReady?: (readyFile: string) => Promise<void>; now?: () => number; sleep?: (ms: number) => Promise<void>; readyTimeoutMs?: number }
async function waitUntilViewerReady(exec: CommandExecutor, tmux: string, readyFile: string, window: NonNullable<Awaited<ReturnType<typeof launchHubWindow>>>, dependencies: HistoryLaunchDependencies): Promise<void> {
    if (dependencies.waitUntilReady) { await dependencies.waitUntilReady(readyFile); return; }
    const now = dependencies.now ?? Date.now;
    const sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const deadline = now() + (dependencies.readyTimeoutMs ?? 5000);
    while (now() < deadline) {
        if (await access(readyFile).then(() => true).catch(() => false)) return;
        const inspected = await inspectAgentTmux(exec, tmux, window);
        if (inspected.server !== "match" || inspected.paneState === "dead") throw new Error("History viewer exited before assuming snapshot cleanup ownership");
        await sleep(25);
    }
    throw new Error("History viewer readiness timed out");
}
export async function openSubagentHistory(exec: CommandExecutor, config: { tmux: string; historyViewerExtension: string; piCommand: string }, context: TmuxContext, snapshot: AgentSnapshot, dependencies: HistoryLaunchDependencies = {}): Promise<void> {
    const availability = historyAvailability(snapshot);
    if (!availability.available) throw new Error(availability.reason);
    const canonical = snapshot.status.childSessionFile!;
    if (await sessionId(canonical) !== snapshot.status.childSessionId) throw new Error("Child session identity does not match its canonical file");
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-subagent-history-"));
    await chmod(temporaryDirectory, 0o700);
    const copy = join(temporaryDirectory, basename(canonical));
    const readyFile = join(temporaryDirectory, ".viewer-ready");
    let window;
    try {
        await copyFile(canonical, copy);
        await chmod(copy, 0o600);
        const short = snapshot.agent.agentId.slice(0, 8);
        const env = {
            PI_SUBAGENT_VIEWER_TMUX: config.tmux,
            PI_SUBAGENT_VIEWER_SOCKET: context.socket,
            PI_SUBAGENT_VIEWER_TEMP_DIR: temporaryDirectory,
            PI_SUBAGENT_VIEWER_READY_FILE: readyFile,
        };
        const baseArgs = ["--no-extensions", "-e", config.historyViewerExtension, "--no-tools", "--session", copy];
        const command = ["env", ...Object.entries(env).map(([key, value]) => `${key}=${value}`), config.piCommand, ...baseArgs].map(quote).join(" ");
        window = await launchHubWindow(exec, config.tmux, context, { originSessionId: snapshot.agent.originSessionId, windowName: `history-${short}-${randomUUID()}`, cwd: snapshot.agent.cwd, command, remainOnExit: false });
        await openAgentWindow(exec, config.tmux, context, window);
        await waitUntilViewerReady(exec, config.tmux, readyFile, window, dependencies);
    } catch (error) {
        let cleanupConfirmed = window === undefined;
        let cleanupError: unknown;
        if (window) {
            try {
                cleanupConfirmed = await stopAgentSession(exec, config.tmux, window);
                if (!cleanupConfirmed) { const inspected = await inspectAgentTmux(exec, config.tmux, window); cleanupConfirmed = inspected.server === "absent" || inspected.server === "mismatch" || inspected.server === "match" && inspected.paneState === "dead"; }
            } catch (failure) {
                const inspected = await inspectAgentTmux(exec, config.tmux, window).catch(() => undefined);
                cleanupConfirmed = inspected !== undefined && (inspected.server === "absent" || inspected.server === "mismatch" || inspected.server === "match" && inspected.paneState === "dead");
                if (!cleanupConfirmed) cleanupError = failure;
            }
        }
        if (cleanupConfirmed) await rm(temporaryDirectory, { recursive: true, force: true });
        if (cleanupError || !cleanupConfirmed) throw new Error(`${error instanceof Error ? error.message : String(error)}; history viewer cleanup remains incomplete and snapshot was retained`, { cause: cleanupError });
        throw error;
    }
}
