import { createHash } from "node:crypto";
import type { NativeLaunchDescriptor } from "./subagent_harness.ts";
import type { TmuxAgentReference } from "./subagent_types.ts";

export interface CommandResult { stdout: string; stderr: string; code: number }
export type CommandExecutor = (command: string, args: string[]) => Promise<CommandResult>;
export interface TmuxContext { socket: string; serverPid: string; sessionId: string; sessionName: string; paneId: string }
const FORMAT = "#{pid}\t#{session_id}\t#{session_name}\t#{pane_id}";
const at = (socket: string, args: string[]): string[] => ["-S", socket, ...args];

export async function probeTmux(exec: CommandExecutor, tmux: string, env: NodeJS.ProcessEnv = process.env): Promise<TmuxContext | null> {
    const socket = env.TMUX?.split(",", 1)[0];
    if (!socket) return null;
    const result = await exec(tmux, at(socket, ["display-message", "-p", FORMAT]));
    if (result.code !== 0) return null;
    const [serverPid, sessionId, sessionName, paneId] = result.stdout.trim().split("\t");
    return serverPid && sessionId && sessionName && paneId ? { socket, serverPid, sessionId, sessionName, paneId } : null;
}
function quote(value: string): string { return `'${value.replaceAll("'", `'"'"'`)}'`; }
export type TmuxServerState = "match" | "mismatch" | "absent" | "unavailable";
const ABSENT_SERVER_ERROR = /(?:no server running|no such file or directory|connection refused)/iu;
async function serverState(exec: CommandExecutor, tmux: string, target: Pick<TmuxAgentReference, "socket" | "serverPid">): Promise<TmuxServerState> { const result = await exec(tmux, at(target.socket, ["display-message", "-p", "#{pid}"])); if (result.code !== 0) return ABSENT_SERVER_ERROR.test(`${result.stderr}\n${result.stdout}`) ? "absent" : "unavailable"; return result.stdout.trim() === target.serverPid ? "match" : "mismatch"; }
async function serverMatches(exec: CommandExecutor, tmux: string, target: Pick<TmuxAgentReference, "socket" | "serverPid">): Promise<boolean> { return await serverState(exec, tmux, target) === "match"; }
export type TmuxPaneState = "alive" | "dead" | "unavailable";
export async function inspectAgentTmux(exec: CommandExecutor, tmux: string, target: TmuxAgentReference): Promise<{ server: TmuxServerState; paneAlive: boolean; paneState: TmuxPaneState; sessionAlive: boolean }> { const server = await serverState(exec, tmux, target); if (server !== "match") return { server, paneAlive: false, paneState: "dead", sessionAlive: false }; const [panes, session] = await Promise.all([exec(tmux, at(target.socket, ["list-panes", "-a", "-F", "#{pane_id}\t#{pane_dead}"])), exec(tmux, at(target.socket, ["has-session", "-t", target.sessionId]))]); const paneState: TmuxPaneState = panes.code !== 0 ? "unavailable" : panes.stdout.split("\n").some(line => { const [paneId, paneDead] = line.split("\t"); return paneId === target.paneId && paneDead === "0"; }) ? "alive" : "dead"; return { server, paneAlive: paneState === "alive", paneState, sessionAlive: session.code === 0 }; }
export function originHubName(originSessionId: string): string { return `pi-sa-hub-${createHash("sha256").update(originSessionId).digest("hex").slice(0, 24)}`; }
async function allocateHubWindow(exec: CommandExecutor, tmux: string, context: TmuxContext, input: { originSessionId: string; windowName: string; cwd: string; command: string }): Promise<TmuxAgentReference> {
    if (!await serverMatches(exec, tmux, context)) throw new Error("Current tmux server identity changed before window launch");
    const sessionName = originHubName(input.originSessionId);
    const format = "#{session_id}\t#{window_id}\t#{pane_id}";
    const createWindow = () => exec(tmux, at(context.socket, ["new-window", "-d", "-P", "-F", format, "-t", `${sessionName}:`, "-n", input.windowName, "-c", input.cwd, input.command]));
    const exists = await exec(tmux, at(context.socket, ["has-session", "-t", sessionName]));
    let created = exists.code === 0 ? await createWindow() : await exec(tmux, at(context.socket, ["new-session", "-d", "-P", "-F", format, "-s", sessionName, "-n", input.windowName, "-c", input.cwd, input.command]));
    if (exists.code !== 0 && created.code !== 0) created = await createWindow();
    if (created.code !== 0) throw new Error(created.stderr.trim() || "tmux hub window creation failed");
    const [sessionId, windowId, paneId] = created.stdout.trim().split("\t");
    if (!sessionId || !windowId || !paneId) {
        const listed = await exec(tmux, at(context.socket, ["list-windows", "-t", sessionName, "-F", "#{session_id}\t#{window_id}\t#{pane_id}\t#{window_name}"]));
        if (listed.code !== 0) throw new Error("tmux window creation did not return canonical IDs; allocated window cleanup could not be inspected");
        const matches = listed.stdout.split("\n").map(line => line.split("\t")).filter(([, , , name]) => name === input.windowName);
        if (matches.length > 1) throw new Error("tmux window creation did not return canonical IDs; allocation ownership is ambiguous");
        const match = matches[0];
        if (match) {
            const [allocatedSessionId, allocatedWindowId, allocatedPaneId] = match;
            if (!allocatedSessionId || !allocatedWindowId || !allocatedPaneId) throw new Error("tmux window creation did not return canonical IDs; allocated window cleanup could not be identified");
            const allocated: TmuxAgentReference = { socket: context.socket, serverPid: context.serverPid, sessionId: allocatedSessionId, sessionName, windowId: allocatedWindowId, paneId: allocatedPaneId, windowName: input.windowName };
            if (!await stopAgentSession(exec, tmux, allocated)) throw new Error("tmux window creation did not return canonical IDs; allocated window cleanup was not confirmed");
        }
        throw new Error("tmux window creation did not return canonical IDs");
    }
    return { socket: context.socket, serverPid: context.serverPid, sessionId, sessionName, windowId, paneId, windowName: input.windowName };
}
export async function launchHubWindow(exec: CommandExecutor, tmux: string, context: TmuxContext, input: { originSessionId: string; windowName: string; cwd: string; command: string; remainOnExit?: boolean }): Promise<TmuxAgentReference> {
    const target = await allocateHubWindow(exec, tmux, context, input);
    if (input.remainOnExit !== false) {
        const remain = await exec(tmux, at(target.socket, ["set-option", "-w", "-t", target.windowId, "remain-on-exit", "on"]));
        if (remain.code !== 0) { await stopAgentSession(exec, tmux, target); throw new Error(remain.stderr.trim() || "Could not enable remain-on-exit"); }
    }
    return target;
}
export async function launchAgentSession(exec: CommandExecutor, tmux: string, context: TmuxContext, input: { agentId: string; profile: string; originSessionId: string; cwd: string; launch: NativeLaunchDescriptor }): Promise<TmuxAgentReference> {
    const short = input.agentId.slice(0, 8);
    const safeProfile = input.profile.replace(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 24);
    const command = ["env", ...Object.entries(input.launch.env).map(([key, value]) => `${key}=${value}`), input.launch.command, ...input.launch.args].map(quote).join(" ");
    return launchHubWindow(exec, tmux, context, { originSessionId: input.originSessionId, windowName: `sa-${safeProfile}-${short}-${input.agentId}`, cwd: input.cwd, command });
}
export async function stopOriginHub(exec: CommandExecutor, tmux: string, target: Pick<TmuxAgentReference, "socket" | "serverPid" | "sessionName">): Promise<boolean> {
    if (await serverState(exec, tmux, target) !== "match") return false;
    const result = await exec(tmux, at(target.socket, ["kill-session", "-t", target.sessionName]));
    if (result.code !== 0 && !/can't find session|no such session/iu.test(result.stderr)) throw new Error(result.stderr.trim() || `Could not stop tmux hub ${target.sessionName}`);
    return result.code === 0;
}
export async function isAgentPaneAlive(exec: CommandExecutor, tmux: string, target: TmuxAgentReference): Promise<boolean> { const inspected = await inspectAgentTmux(exec, tmux, target); if (inspected.paneState === "unavailable") throw new Error(`Could not inspect tmux pane ${target.paneId}`); return inspected.paneAlive; }
export async function stopAgentSession(exec: CommandExecutor, tmux: string, target: TmuxAgentReference): Promise<boolean> {
    if (await serverState(exec, tmux, target) !== "match") return false;
    const result = await exec(tmux, at(target.socket, ["kill-window", "-t", target.windowId]));
    if (result.code !== 0 && !/can't find window|no such window/iu.test(result.stderr)) throw new Error(result.stderr.trim() || `Could not stop tmux window ${target.windowId}`);
    if (await isAgentPaneAlive(exec, tmux, target)) throw new Error(`Tmux agent pane ${target.paneId} remained alive after stopping window ${target.windowId}`);
    return result.code === 0;
}
async function currentWindows(exec: CommandExecutor, tmux: string, context: TmuxContext): Promise<Set<string>> {
    const result = await exec(tmux, at(context.socket, ["list-windows", "-t", context.sessionId, "-F", "#{window_id}"]));
    if (result.code !== 0) throw new Error(result.stderr.trim() || "Could not list current tmux windows");
    return new Set(result.stdout.trim().split("\n").filter(Boolean));
}
function assertSameServer(context: TmuxContext, target: TmuxAgentReference): void {
    if (context.socket !== target.socket || context.serverPid !== target.serverPid) throw new Error("Agent belongs to a different tmux server");
}
export async function openAgentWindow(exec: CommandExecutor, tmux: string, context: TmuxContext, target: TmuxAgentReference): Promise<void> {
    assertSameServer(context, target);
    if (!await isAgentPaneAlive(exec, tmux, target)) throw new Error("Agent tmux pane is no longer live");
    const windows = await currentWindows(exec, tmux, context);
    if (!windows.has(target.windowId)) {
        const linked = await exec(tmux, at(target.socket, ["link-window", "-a", "-s", target.windowId, "-t", `${context.sessionId}:`]));
        if (linked.code !== 0) throw new Error(linked.stderr.trim() || "Could not link agent window");
    }
    const selected = await exec(tmux, at(target.socket, ["select-window", "-t", target.windowId]));
    if (selected.code !== 0) throw new Error(selected.stderr.trim() || "Could not select agent window");
}
export async function unlinkAgentWindow(exec: CommandExecutor, tmux: string, context: TmuxContext, target: TmuxAgentReference): Promise<void> {
    assertSameServer(context, target);
    if (!await serverMatches(exec, tmux, target)) throw new Error("Agent tmux server is no longer live");
    const windows = await currentWindows(exec, tmux, context);
    if (!windows.has(target.windowId)) return;
    const result = await exec(tmux, at(target.socket, ["unlink-window", "-t", `${context.sessionId}:${target.windowId}`]));
    if (result.code !== 0) throw new Error(result.stderr.trim() || "Could not unlink agent window");
}
