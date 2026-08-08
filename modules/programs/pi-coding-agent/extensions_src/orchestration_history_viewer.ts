import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorComponent } from "@earendil-works/pi-tui";
import { keyLabel, loadFeatureKeybindings } from "./utilities/extension_keybindings.ts";

const run = promisify(execFile);

function readOnlyEditor(ctx: ExtensionContext, keybindings: Pick<KeybindingsManager, "matches" | "getKeys">): EditorComponent {
    const hint = keybindings.getKeys("app.exit").map(keyLabel).join("/");
    return {
        getText: () => "",
        setText: () => {},
        handleInput: data => { if (keybindings.matches(data, "app.exit")) ctx.shutdown(); },
        render: width => [`History snapshot is read-only · ${hint} exits`.slice(0, Math.max(0, width))],
        invalidate: () => {},
    };
}

export interface HistoryViewerDependencies {
    exec?: (command: string, args: string[]) => Promise<{ stdout: string }>;
    remove?: typeof rm;
    setInterval?: typeof setInterval;
    clearInterval?: typeof clearInterval;
    writeReady?: (path: string) => Promise<void>;
}
export function registerMeshHistoryViewer(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env, dependencies: HistoryViewerDependencies = {}): boolean {
    loadFeatureKeybindings("historyViewer");
    const tmux = env.PI_MESH_VIEWER_TMUX;
    const socket = env.PI_MESH_VIEWER_SOCKET;
    let windowId = env.PI_MESH_VIEWER_WINDOW_ID;
    const paneId = env.TMUX_PANE;
    const temporaryDirectory = env.PI_MESH_VIEWER_TEMP_DIR;
    const readyFile = env.PI_MESH_VIEWER_READY_FILE;
    if (!tmux || !socket || (!windowId && !paneId) || !temporaryDirectory || !readyFile) return false;
    let timer: NodeJS.Timeout | undefined;
    let seen = false;
    let stopping = false;
    let polling = false;
    const count = async (): Promise<number> => {
        if (!windowId) {
            const identified = await (dependencies.exec ?? run)(tmux, ["-S", socket, "display-message", "-p", "-t", paneId!, "#{window_id}"]);
            windowId = identified.stdout.trim();
        }
        const result = await (dependencies.exec ?? run)(tmux, ["-S", socket, "display-message", "-p", "-t", windowId, "#{window_active_clients}"]);
        return Number.parseInt(result.stdout.trim(), 10) || 0;
    };
    const poll = async (ctx: ExtensionContext) => {
        if (stopping || polling) return;
        polling = true;
        try {
            const active = await count();
            if (active > 0) seen = true;
            else if (seen) { stopping = true; ctx.shutdown(); }
        } finally { polling = false; }
    };
    pi.on("session_start", async (_event, ctx) => {
        pi.setActiveTools([]);
        if (ctx.mode === "tui") ctx.ui.setEditorComponent((_tui, _theme, keybindings) => readOnlyEditor(ctx, keybindings));
        timer = (dependencies.setInterval ?? setInterval)(() => { void poll(ctx).catch(() => {}); }, 250);
        await poll(ctx);
        await (dependencies.writeReady ?? (path => writeFile(path, "ready\n", { mode: 0o600 })))(readyFile);
    });
    pi.on("input", () => ({ action: "handled" as const }));
    pi.on("tool_call", () => ({ block: true, reason: "History viewer is read-only" }));
    pi.on("session_shutdown", async () => {
        if (timer) (dependencies.clearInterval ?? clearInterval)(timer);
        timer = undefined;
        await (dependencies.remove ?? rm)(temporaryDirectory, { recursive: true, force: true });
    });
    return true;
}

export default registerMeshHistoryViewer;
