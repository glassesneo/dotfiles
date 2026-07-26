import type { TmuxRunReference } from "./subagent_types.ts";

export interface CommandResult {
    stdout: string;
    stderr: string;
    code: number;
}

export type CommandExecutor = (command: string, args: string[]) => Promise<CommandResult>;

export interface TmuxContext {
    sessionId: string;
    session: string;
    paneId: string;
}

const CONTEXT_FORMAT = "#{session_id}\t#{session_name}\t#{pane_id}";

export async function probeTmux(exec: CommandExecutor, env: NodeJS.ProcessEnv = process.env): Promise<TmuxContext | null> {
    if (!env.TMUX) return null;
    const result = await exec("tmux", ["display-message", "-p", CONTEXT_FORMAT]);
    if (result.code !== 0) return null;
    const [sessionId, session, paneId] = result.stdout.trim().split("\t");
    if (!sessionId || !session || !paneId) return null;
    return { sessionId, session, paneId };
}

export async function launchTmuxWindow(
    exec: CommandExecutor,
    context: TmuxContext,
    options: { runId: string; cwd: string; launcher: string },
): Promise<TmuxRunReference> {
    const windowName = `sa-${options.runId.slice(0, 8)}`;
    const created = await exec("tmux", [
        "new-window",
        "-d",
        "-P",
        "-F",
        "#{window_id}\t#{pane_id}",
        "-t",
        `${context.sessionId}:`,
        "-c",
        options.cwd,
        "-n",
        windowName,
        options.launcher,
    ]);
    if (created.code !== 0) throw new Error(created.stderr.trim() || "tmux new-window failed");
    const [windowId, paneId] = created.stdout.trim().split("\t");
    if (!windowId || !paneId) throw new Error("tmux new-window did not return window and pane IDs");

    const remain = await exec("tmux", ["set-option", "-w", "-t", windowId, "remain-on-exit", "on"]);
    if (remain.code !== 0) {
        await exec("tmux", ["kill-window", "-t", windowId]);
        throw new Error(remain.stderr.trim() || "Could not enable tmux remain-on-exit");
    }

    return { sessionId: context.sessionId, session: context.session, windowId, paneId, windowName };
}

export async function isTmuxPaneAlive(exec: CommandExecutor, paneId: string): Promise<boolean> {
    const result = await exec("tmux", ["display-message", "-p", "-t", paneId, "#{pane_dead}"]);
    return result.code === 0 && result.stdout.trim() === "0";
}
