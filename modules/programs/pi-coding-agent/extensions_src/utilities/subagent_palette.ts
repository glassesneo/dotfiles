import { type ExtensionContext, type ExtensionUIContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Input, truncateToWidth, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { paletteKeyAction, type ResolvedPaletteKeymap } from "./command_palette_keymap.ts";
import { historyAvailability, openSubagentHistory } from "./subagent_history.ts";
import { OriginAgentDiscovery, stopSubagentAgent } from "./subagent_management.ts";
import { openAgentWindow, probeTmux, unlinkAgentWindow, type CommandExecutor } from "./subagent_tmux.ts";
import { isTerminalAgent, type AgentSnapshot } from "./subagent_types.ts";

export interface SubagentPaletteDependencies {
    stateRoot: string;
    originSessionId: string;
    exec: CommandExecutor;
    tmux: string;
    historyViewerExtension: string;
    piCommand: string;
    env?: NodeJS.ProcessEnv;
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
}

export class SubagentPaletteComponent implements Component, Focusable {
    readonly #tui: TUI;
    readonly #theme: Theme;
    readonly #ui: Pick<ExtensionUIContext, "confirm">;
    readonly #keymap: ResolvedPaletteKeymap;
    readonly #deps: SubagentPaletteDependencies;
    readonly #done: (value: null) => void;
    readonly #input = new Input();
    #agents: AgentSnapshot[] = [];
    #index = 0;
    #focused = false;
    #status = "Loading…";
    #timer?: NodeJS.Timeout;
    #refreshing = false;
    #refreshQueued = false;
    #acting = false;
    #disposed = false;

    constructor(options: { tui: TUI; theme: Theme; ui: Pick<ExtensionUIContext, "confirm">; keymap: ResolvedPaletteKeymap; deps: SubagentPaletteDependencies; done: (value: null) => void }) {
        this.#tui = options.tui;
        this.#theme = options.theme;
        this.#ui = options.ui;
        this.#keymap = options.keymap;
        this.#deps = options.deps;
        this.#done = options.done;
    }

    get focused() { return this.#focused; }
    set focused(value: boolean) { this.#focused = value; this.#input.focused = value; }
    invalidate() { this.#input.invalidate(); }
    start() { void this.refresh(); }
    selected() { return this.#agents[this.#index]; }

    close() {
        if (this.#disposed) return;
        this.#disposed = true;
        if (this.#timer) (this.#deps.clearTimeout ?? clearTimeout)(this.#timer);
        this.#timer = undefined;
        this.#input.focused = false;
        this.#done(null);
    }

    async refresh() {
        if (this.#disposed) return;
        if (this.#refreshing) { this.#refreshQueued = true; return; }
        if (this.#timer) (this.#deps.clearTimeout ?? clearTimeout)(this.#timer);
        this.#timer = undefined;
        this.#refreshing = true;
        try {
            const found = await new OriginAgentDiscovery(this.#deps).refresh();
            if (this.#disposed) return;
            this.#agents = found.agents;
            this.#index = Math.max(0, Math.min(this.#index, Math.max(0, this.#agents.length - 1)));
            this.#status = found.malformedCount ? `${found.malformedCount} incomplete agent record(s)` : `${found.agents.length} agent session(s)`;
        } catch (error) {
            if (!this.#disposed) this.#status = `Refresh failed: ${error instanceof Error ? error.message : String(error)}`;
        } finally {
            this.#refreshing = false;
            if (!this.#disposed) {
                this.#tui.requestRender();
                if (this.#refreshQueued) {
                    this.#refreshQueued = false;
                    void this.refresh();
                } else {
                    this.#timer = (this.#deps.setTimeout ?? setTimeout)(() => {
                        this.#timer = undefined;
                        void this.refresh();
                    }, 1000);
                }
            }
        }
    }

    async action(kind: "open" | "unlink" | "stop") {
        const selected = this.selected();
        if (!selected || this.#acting || this.#disposed) return;
        this.#acting = true;
        try {
            if (kind === "stop") {
                const confirmed = await this.#ui.confirm(`Stop ${selected.agent.purpose}?`, "This kills the agent window and every linked view. Use Unlink to close only this view.");
                if (confirmed) await stopSubagentAgent({ ...this.#deps, agentId: selected.agent.agentId });
            } else {
                if (kind === "open" && isTerminalAgent(selected.status.state)) {
                    const availability = historyAvailability(selected);
                    if (!availability.available) { this.#status = availability.reason ?? "history unavailable"; this.#tui.requestRender(); return; }
                }
                const context = await probeTmux(this.#deps.exec, this.#deps.tmux, this.#deps.env);
                if (!context) throw new Error("Current Pi is not attached to a usable tmux client");
                if (kind === "open") {
                    if (isTerminalAgent(selected.status.state)) await openSubagentHistory(this.#deps.exec, this.#deps, context, selected);
                    else await openAgentWindow(this.#deps.exec, this.#deps.tmux, context, selected.agent.tmux);
                    this.close();
                    return;
                }
                await unlinkAgentWindow(this.#deps.exec, this.#deps.tmux, context, selected.agent.tmux);
            }
            await this.refresh();
        } catch (error) {
            if (!this.#disposed) {
                this.#status = `${kind} failed: ${error instanceof Error ? error.message : String(error)}`;
                this.#tui.requestRender();
            }
        } finally { this.#acting = false; }
    }

    handleInput(data: string) {
        if (this.#disposed) return;
        const action = paletteKeyAction(data, this.#keymap);
        if (action === "cancel") { this.close(); return; }
        if (action === "moveUp") this.#index = Math.max(0, this.#index - 1);
        else if (action === "moveDown" && this.#agents.length) this.#index = Math.min(this.#agents.length - 1, this.#index + 1);
        else if (action === "confirm") void this.action("open");
        else if (action === "stop") void this.action("stop");
        else if (action === "refresh") void this.refresh();
        else if (data === "u") void this.action("unlink");
        this.#tui.requestRender();
    }

    render(width: number): string[] {
        const lines = [
            this.#theme.fg("accent", this.#theme.bold("Subagent sessions")),
            this.#theme.fg("muted", "Enter Open/history · u Unlink view · Stop ends a live agent window"),
            "",
        ];
        if (!this.#agents.length) lines.push("No agents for this origin session.");
        this.#agents.forEach((snapshot, index) => {
            const task = snapshot.task;
            const marker = index === this.#index ? ">" : " ";
            const intervention = (task?.interventions.length ?? 0) > 0 ? " · intervention" : "";
            const child = snapshot.status.childSessionId?.slice(0, 8) ?? (snapshot.status.bridgeReady ? "unavailable" : "pending");
            const unavailable = isTerminalAgent(snapshot.status.state) && !historyAvailability(snapshot).available ? " · history unavailable" : "";
            lines.push(`${marker} ${snapshot.agent.profile} — ${snapshot.agent.purpose} — ${snapshot.status.state}/${task?.status.state ?? "no-task"} — ${snapshot.agent.agentId.slice(0, 8)} · child ${child}${intervention}${unavailable}`);
        });
        lines.push("", this.#theme.fg("dim", this.#status));
        return lines.map(line => truncateToWidth(line, Math.max(1, width), ""));
    }
}

export async function openSubagentPalette(ctx: ExtensionContext, keymap: ResolvedPaletteKeymap, deps: SubagentPaletteDependencies): Promise<void> {
    if (ctx.mode !== "tui") { ctx.ui.notify("Subagent management requires TUI mode", "warning"); return; }
    await ctx.ui.custom<null>((tui, theme, _bindings, done) => {
        const component = new SubagentPaletteComponent({ tui, theme, ui: ctx.ui, keymap, deps, done });
        component.start();
        return component;
    }, { overlay: true, overlayOptions: { anchor: "center", width: "70%", minWidth: 60, maxHeight: "80%", margin: 1 } });
}
