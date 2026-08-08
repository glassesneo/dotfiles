import { access, chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
    allocatePreviewView,
    cleanupPreviewView,
    inspectAgentTmux,
    type CommandExecutor,
    type TmuxContext,
    type TmuxPreviewView,
} from "./orchestration_tmux.ts";
import type { TmuxAgentReference } from "./orchestration_types.ts";

export type LivePreviewDisposition = "dismissed" | "open-full";

export interface LivePreviewTestSeams {
    makeTempDirectory?: () => Promise<string>;
    removeTempDirectory?: (path: string) => Promise<void>;
    markerExists?: (path: string) => Promise<boolean>;
    uniqueId?: () => string;
    sleep?: (ms: number) => Promise<void>;
    inspectTarget?: typeof inspectAgentTmux;
    monitorIntervalMs?: number;
    bindings?: Record<string, readonly string[]>;
}

const at = (socket: string, args: string[]): string[] => ["-S", socket, ...args];
const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;
const ABSENT_WRAPPER_ERROR = /no server running|no such file or directory|connection refused/iu;

const TMUX_KEY_NAMES: Record<string, string> = {
    escape: "Escape", esc: "Escape", enter: "Enter", return: "Enter", tab: "Tab", space: "Space",
    backspace: "BSpace", delete: "DC", home: "Home", end: "End", pageUp: "PPage", pageDown: "NPage",
    up: "Up", down: "Down", left: "Left", right: "Right",
};

export function tmuxKeyToken(key: string): string {
    const parts = key.split("+");
    const base = parts.at(-1)!;
    const modifiers = parts.slice(0, -1);
    if (modifiers.some(modifier => modifier !== "ctrl" && modifier !== "shift")) throw new Error(`Unsupported tmux key modifier in ${key}`);
    const token = TMUX_KEY_NAMES[base] ?? (/^[a-z0-9]$/u.test(base) || /^f(?:[1-9]|1[0-2])$/u.test(base) ? base : undefined);
    if (!token) throw new Error(`Unsupported tmux key ${key}`);
    const prefix = modifiers.map(modifier => modifier === "ctrl" ? "C" : "S").join("-");
    return prefix ? `${prefix}-${token}` : token;
}

async function requireSuccess(result: { stderr: string; code: number }, fallback: string): Promise<void> {
    if (result.code !== 0) throw new Error(result.stderr.trim() || fallback);
}

async function stopWrapperServer(exec: CommandExecutor, tmux: string, socket: string): Promise<void> {
    const result = await exec(tmux, at(socket, ["kill-server"]));
    if (result.code !== 0 && !ABSENT_WRAPPER_ERROR.test(result.stderr)) {
        throw new Error(result.stderr.trim() || "Could not stop preview wrapper server");
    }
}

function popupCleanupScript(tmux: string, wrapperSocket: string, realContext: TmuxContext, view: TmuxPreviewView, directory: string): string {
    const qTmux = shellQuote(tmux);
    const qWrapper = shellQuote(wrapperSocket);
    const qReal = shellQuote(realContext.socket);
    const qPid = shellQuote(realContext.serverPid);
    const qSession = shellQuote(view.sessionId);
    const qDirectory = shellQuote(directory);
    const detachedTmux = `env -u TMUX -u TMUX_PANE ${qTmux}`;
    return [
        "cleanup() {",
        `  ${qTmux} -S ${qWrapper} kill-server >/dev/null 2>&1 || :`,
        `  if [ "$(${qTmux} -S ${qReal} display-message -p '#{pid}' 2>/dev/null)" = ${qPid} ]; then`,
        `    ${qTmux} -S ${qReal} kill-session -t ${qSession} >/dev/null 2>&1 || :`,
        "  fi",
        "}",
        `emergency() { trap - HUP INT TERM; cleanup; rm -rf -- ${qDirectory}; exit 130; }`,
        "trap emergency HUP INT TERM",
        `${detachedTmux} -S ${qWrapper} attach-session`,
        "status=$?",
        "trap - HUP INT TERM",
        "cleanup",
        "exit $status",
    ].join("\n");
}

export async function openLivePreview(
    exec: CommandExecutor,
    tmux: string,
    context: TmuxContext,
    target: TmuxAgentReference,
    title: string,
    seams: LivePreviewTestSeams = {},
): Promise<LivePreviewDisposition> {
    if (!context.clientName) throw new Error("Current tmux client could not be identified for preview popup");
    const uniqueId = (seams.uniqueId ?? randomUUID)().replaceAll("-", "").slice(0, 20);
    const directory = seams.makeTempDirectory
        ? await seams.makeTempDirectory()
        : await mkdtemp(join(tmpdir(), "pi-mesh-preview-"));
    if (!seams.makeTempDirectory) await chmod(directory, 0o700);
    const marker = join(directory, "open-full");
    const wrapperSocket = join(directory, "wrapper.sock");
    const viewName = `pi-mesh-view-${uniqueId}`;
    let view: TmuxPreviewView | undefined;
    let wrapperStarted = false;
    let failure: unknown;
    let disposition: LivePreviewDisposition = "dismissed";

    try {
        view = await allocatePreviewView(exec, tmux, context, target, viewName);
        const qTmux = shellQuote(tmux);
        const qWrapper = shellQuote(wrapperSocket);
        const qReal = shellQuote(context.socket);
        const qView = shellQuote(view.sessionId);
        const waitForPopupClient = [
            `while [ -z "$(${qTmux} -S ${qWrapper} list-clients -F '#{client_name}' 2>/dev/null)" ]; do sleep 0.02; done`,
            `${qTmux} -S ${qWrapper} resize-window -A`,
            `set -- $(${qTmux} -S ${qWrapper} list-clients -F '#{client_width} #{client_height}')`,
            `env -u TMUX -u TMUX_PANE ${qTmux} -S ${qReal} resize-window -x "$1" -y "$2" -t ${qView}:${shellQuote(target.windowId)}`,
            `exec env -u TMUX -u TMUX_PANE ${qTmux} -S ${qReal} attach-session -r -t ${qView}`,
        ].join("; ");
        const nestedAttach = `/bin/sh -c ${shellQuote(waitForPopupClient)}`;
        const wrapper = await exec(tmux, ["-S", wrapperSocket, "-f", "/dev/null", "new-session", "-d", "-P", "-F", "#{session_id}", nestedAttach]);
        await requireSuccess(wrapper, "Could not create preview wrapper session");
        wrapperStarted = true;
        if (!wrapper.stdout.trim()) throw new Error("Preview wrapper session did not return a canonical ID");
        await requireSuccess(await exec(tmux, at(wrapperSocket, ["set-option", "-g", "status", "off"])), "Could not hide preview wrapper status");
        await requireSuccess(await exec(tmux, at(wrapperSocket, ["set-option", "-g", "prefix", "None"])), "Could not disable preview wrapper prefix");
        await requireSuccess(await exec(tmux, at(wrapperSocket, ["set-option", "-g", "prefix2", "None"])), "Could not disable preview wrapper secondary prefix");
        const bindings = seams.bindings ?? { openFull: ["enter"], cancel: ["escape", "ctrl+c"] };
        for (const key of bindings.openFull ?? []) {
            const token = tmuxKeyToken(key);
            await requireSuccess(await exec(tmux, at(wrapperSocket, ["bind-key", "-n", token, "run-shell", `touch -- ${shellQuote(marker)}`, "\\;", "detach-client"])), `Could not bind preview promotion key ${token}`);
        }
        for (const key of bindings.cancel ?? []) {
            const token = tmuxKeyToken(key);
            await requireSuccess(await exec(tmux, at(wrapperSocket, ["bind-key", "-n", token, "detach-client"])), `Could not bind preview dismissal key ${token}`);
        }

        const popupCommand = `/bin/sh -c ${shellQuote(popupCleanupScript(tmux, wrapperSocket, context, view, directory))}`;
        let popupSettled = false;
        let targetEnded = false;
        const popupPromise = exec(tmux, at(context.socket, ["display-popup", "-E", "-w", "80%", "-h", "80%", "-T", title, "-t", context.clientName, popupCommand]))
            .finally(() => { popupSettled = true; });
        const monitorPromise = (async () => {
            while (!popupSettled) {
                await Promise.race([
                    popupPromise.then(() => undefined),
                    (seams.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(seams.monitorIntervalMs ?? 250),
                ]);
                if (popupSettled) return;
                const inspected = await (seams.inspectTarget ?? inspectAgentTmux)(exec, tmux, target);
                if (inspected.server === "match" && inspected.paneState === "alive") continue;
                targetEnded = true;
                await stopWrapperServer(exec, tmux, wrapperSocket);
                return;
            }
        })();
        const [popup] = await Promise.all([popupPromise, monitorPromise]);
        if (!targetEnded && popup.code !== 0 && popup.code !== 129) await requireSuccess(popup, "Could not display live preview popup");
        const exists = seams.markerExists
            ? await seams.markerExists(marker)
            : await access(marker).then(() => true, () => false);
        disposition = exists ? "open-full" : "dismissed";
    } catch (error) {
        failure = error;
    }

    const cleanupErrors: unknown[] = [];
    if (wrapperStarted) {
        try { await stopWrapperServer(exec, tmux, wrapperSocket); }
        catch (error) { cleanupErrors.push(error); }
    }
    if (view) {
        try { await cleanupPreviewView(exec, tmux, context, view); }
        catch (error) { cleanupErrors.push(error); }
    }
    try {
        if (seams.removeTempDirectory) await seams.removeTempDirectory(directory);
        else await rm(directory, { recursive: true, force: true });
    } catch (error) { cleanupErrors.push(error); }
    if (failure && cleanupErrors.length > 0) throw new AggregateError([failure, ...cleanupErrors], "Live preview failed and cleanup was incomplete");
    if (failure) throw failure;
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Live preview cleanup was incomplete");
    return disposition;
}
