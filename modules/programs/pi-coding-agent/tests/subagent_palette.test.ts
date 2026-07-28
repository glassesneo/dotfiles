import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { resolvePaletteKeymap } from "../extensions_src/utilities/command_palette_keymap.ts";
import { SubagentPaletteComponent } from "../extensions_src/utilities/subagent_palette.ts";
import { attachTmux, createRun, patchStatus } from "../extensions_src/utilities/subagent_store.ts";
import type { AgentProfile } from "../extensions_src/utilities/profile_types.ts";
import type { SubagentRuntimeConfig } from "../extensions_src/utilities/subagent_types.ts";

const theme = { fg(_color: string, text: string) { return text; }, bg(_color: string, text: string) { return text; }, bold(text: string) { return text; } } as Theme;

test("subagent palette polls serially, renders textual empty state within width, and disposes on cancel", async () => {
    let renders = 0; let closed = 0; let timer: (() => void) | undefined; let clears = 0;
    const component = new SubagentPaletteComponent({
        tui: { terminal: { rows: 24, columns: 80 }, requestRender() { renders += 1; } } as TUI,
        theme,
        ui: { async confirm() { return false; } },
        keymap: resolvePaletteKeymap(),
        deps: {
            stateRoot: "/definitely-missing/subagent-palette-test", originSessionId: "session",
            exec: async () => ({ stdout: "", stderr: "", code: 1 }),
            setTimeout: ((callback: () => void) => { timer = callback; return 1 as never; }) as typeof setTimeout,
            clearTimeout: (() => { clears += 1; timer = undefined; }) as typeof clearTimeout,
        },
        done: () => { closed += 1; },
    });
    component.focused = true;
    await component.refresh();
    assert.match(component.render(80).join("\n"), /No runs for this origin session/);
    assert.match(component.render(80).join("\n"), /ctrl\+r refresh/);
    assert.doesNotMatch(component.render(80).join("\n"), /stop|copy ID|open tmux/);
    for (const width of [80, 20, 1]) for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
    assert.ok(timer);
    const pendingTimer = timer;
    component.handleInput("\u0003");
    assert.equal(closed, 1);
    assert.ok(clears >= 1);
    const before = renders;
    pendingTimer?.();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(renders, before);
});

test("list and detail preserve query and selection while exposing only available run actions", async () => {
    const root = await mkdtemp(join(tmpdir(), "subagent-palette-ui-"));
    const config: SubagentRuntimeConfig = { schemaVersion: 1, stateRoot: join(root, "runs"), runner: { node: "/node", script: "/runner", extensions: ["/extension"] }, harnesses: { pi: { command: "/pi" } }, maxDepth: 3 };
    const profile: AgentProfile = { model: "provider/model", description: "Test.", allowAllTools: true, tools: [], extensions: {} };
    const run = await createRun(config, "full", profile, "Run palette flow", "task", root, { callerProfile: "full", depth: 1, originSessionId: "session" });
    await patchStatus(run.paths, { status: "starting" });
    await attachTmux(run.paths, { sessionId: "$1", session: "main", windowId: "@1", paneId: "%1", windowName: "sa-run" });
    await patchStatus(run.paths, { status: "running", startedAt: new Date().toISOString() });
    const second = await createRun(config, "full", profile, "Run second flow", "task", root, { callerProfile: "full", depth: 1, originSessionId: "session" });
    await patchStatus(second.paths, { status: "starting" });
    await attachTmux(second.paths, { sessionId: "$1", session: "main", windowId: "@2", paneId: "%2", windowName: "sa-second" });
    await patchStatus(second.paths, { status: "running", startedAt: new Date().toISOString() });
    let copied = ""; let timer: (() => void) | undefined; let blockNextProbe = false; let releaseProbe: (() => void) | undefined;
    const component = new SubagentPaletteComponent({
        tui: { terminal: { rows: 30, columns: 100 }, requestRender() {} } as TUI, theme,
        ui: { async confirm() { return false; } }, keymap: resolvePaletteKeymap(),
        deps: {
            stateRoot: config.stateRoot, originSessionId: "session", exec: async () => {
                if (blockNextProbe) { blockNextProbe = false; await new Promise<void>(resolve => { releaseProbe = resolve; }); }
                return { stdout: "0\n", stderr: "", code: 0 };
            },
            copy: async value => { copied = value; },
            setTimeout: ((callback: () => void) => { timer = callback; return 1 as never; }) as typeof setTimeout,
            clearTimeout: (() => { timer = undefined; }) as typeof clearTimeout,
        }, done() {},
    });
    component.focused = true; await component.refresh();
    blockNextProbe = true;
    const polling = component.refresh();
    for (let attempt = 0; attempt < 20 && !releaseProbe; attempt += 1) await new Promise(resolve => setImmediate(resolve));
    assert.ok(releaseProbe);
    component.handleInput("\u000e");
    const movedDuringRefresh = component.selectedRunId;
    releaseProbe?.();
    await polling;
    assert.equal(component.selectedRunId, movedDuringRefresh);
    component.handleInput("R");
    const list = component.render(160).join("\n");
    assert.match(list, /Run palette flow.*running/);
    assert.match(list, /ctrl\+s stop.*ctrl\+y copy ID.*ctrl\+a open tmux/);
    const selected = component.selectedRunId;
    component.handleInput("\r");
    assert.equal(component.mode, "detail");
    assert.equal(component.query, "R");
    assert.equal(component.selectedRunId, selected);
    assert.match(component.render(100).join("\n"), new RegExp(selected!));
    component.handleInput("\u0010");
    component.handleInput("\u001b");
    assert.equal(component.mode, "list");
    assert.equal(component.selectedRunId, selected);
    component.handleInput("\u0019");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(copied, selected);
    component.close();
});
