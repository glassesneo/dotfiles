import assert from "node:assert/strict";
import test from "node:test";
import commandPalette, { buildCommandPaletteActions, executePaletteAction } from "../extensions_src/command_palette.ts";
import { commandPaletteActionIds } from "../extensions_src/utilities/command_palette_core.ts";
import { provideCommandPaletteContribution } from "../extensions_src/utilities/command_palette_contributions.ts";
import { resolvePaletteKeymap } from "../extensions_src/utilities/command_palette_keymap.ts";
import { PaletteListComponent } from "../extensions_src/utilities/command_palette_tui.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { eventually } from "./test_helpers.ts";

const theme = { fg(_c: string, t: string) { return t; }, bg(_c: string, t: string) { return t; }, bold(t: string) { return t; } } as Theme;

void test("registry builds one action for every declared adapter", () => {
    const pi = { getActiveTools: () => ["read"], getThinkingLevel: () => "medium" } as never;
    const ctx = { model: { provider: "test", id: "model" }, ui: { getToolsExpanded: () => false, theme: { name: "dark" } } } as never;
    const actions = buildCommandPaletteActions(pi, ctx);
    assert.deepEqual(actions.map(action => action.id), commandPaletteActionIds);
    assert.equal(new Set(actions.map(action => action.id)).size, actions.length);
});

void test("the registered shortcut opens the palette whether idle or running", async () => {
    let shortcutHandler: ((ctx: any) => Promise<void>) | undefined;
    let customCalls = 0; let notifications = 0;
    const pi = {
        events: { on() {}, emit() {} }, on() {},
        registerShortcut(_key: string, options: { handler: (ctx: any) => Promise<void> }) {
            shortcutHandler = options.handler;
        },
        getActiveTools: () => ["read"], getThinkingLevel: () => "medium",
    } as never;
    commandPalette(pi, "/nonexistent-agent-dir");
    for (const idle of [true, false]) {
        const ctx = {
            mode: "tui", isIdle: () => idle, model: undefined,
            ui: {
                async custom() { customCalls += 1; return null; }, notify() { notifications += 1; }, getToolsExpanded: () => false, theme: { name: "dark" },
            },
        } as never;
        await shortcutHandler?.(ctx);
    }
    assert.equal(customCalls, 2);
    assert.equal(notifications, 0);
});

void test("a running palette suppresses duplicate opens and can reopen after closing", async () => {
    let shortcutHandler: ((ctx: any) => Promise<void>) | undefined;
    let customCalls = 0; let closeFirst: ((value: null) => void) | undefined;
    const pi = {
        events: { on() {}, emit() {} }, on() {},
        registerShortcut(_key: string, options: { handler: (ctx: any) => Promise<void> }) {
            shortcutHandler = options.handler;
        },
        getActiveTools: () => ["read"], getThinkingLevel: () => "medium",
    } as never;
    commandPalette(pi, "/nonexistent-agent-dir");
    const ctx = {
        mode: "tui", isIdle: () => false, model: undefined,
        ui: {
            custom() {
                customCalls += 1;
                if (customCalls === 1) return new Promise<null>(resolve => { closeFirst = resolve; });
                return Promise.resolve(null);
            },
            notify() {}, getToolsExpanded: () => false, theme: { name: "dark" },
        },
    } as never;
    const firstOpen = shortcutHandler?.(ctx);
    await shortcutHandler?.(ctx);
    assert.equal(customCalls, 1);
    closeFirst?.(null);
    await firstOpen;
    await shortcutHandler?.(ctx);
    assert.equal(customCalls, 2);
});

void test("root palette stays open for nested children and restores query selection after Esc", async () => {
    let shortcutHandler: ((ctx: any) => Promise<void>) | undefined;
    const overlays: Array<{ title: string; component: PaletteListComponent<string> }> = [];
    const eventHandlers = new Map<string, Array<(value: unknown) => void>>();
    const pi = {
        events: {
            on(event: string, handler: (value: unknown) => void) {
                const list = eventHandlers.get(event) ?? [];
                list.push(handler);
                eventHandlers.set(event, list);
                return () => {};
            },
            emit(event: string, value?: unknown) {
                for (const handler of eventHandlers.get(event) ?? []) handler(value);
            },
        },
        on() {},
        registerShortcut(_key: string, options: { handler: (ctx: any) => Promise<void> }) {
            shortcutHandler = options.handler;
        },
        getActiveTools: () => ["read"],
        getThinkingLevel: () => "medium",
        getAllTools: () => [],
        setActiveTools() {},
        setThinkingLevel() {},
        async setModel() { return true; },
    };
    provideCommandPaletteContribution(pi.events, {
        owner: "subagent",
        id: "agents",
        label: "/subagent  Manage agent sessions",
        description: "sessions",
        run: async () => "return" as const,
    });
    commandPalette(pi as never, "/nonexistent-agent-dir");
    let root: PaletteListComponent<string> | undefined;
    const ctx = {
        mode: "tui",
        model: { provider: "test", id: "model" },
        modelRegistry: { refresh() {}, getAvailable: () => [{ provider: "test", id: "model", name: "Model" }] },
        sessionManager: {
            getEntries: () => [], getHeader: () => ({ cwd: "/work" }), getSessionName: () => "s",
            getSessionFile: () => "/s.jsonl", getSessionId: () => "sid", getBranch: () => [],
        },
        getContextUsage: () => undefined,
        cwd: "/work",
        ui: {
            theme: { name: "dark" },
            getToolsExpanded: () => false,
            setToolsExpanded() {},
            getAllThemes: () => [{ name: "dark", path: undefined }],
            setTheme: () => ({ success: true }),
            notify() {},
            async confirm() { return false; },
            async custom(factory: any) {
                let settle: ((value: unknown) => void) | undefined;
                const donePromise = new Promise(resolve => { settle = resolve; });
                const component = factory({ terminal: { rows: 24, columns: 80 }, requestRender() {} } as TUI, theme, {}, (value: unknown) => settle?.(value));
                overlays.push({ title: String((component as any).render?.(80)?.join("\n") ?? ""), component });
                if (!root) root = component;
                if (overlays.length > 1) {
                    component.handleInput("\u001b");
                    return donePromise;
                }
                return donePromise;
            },
        },
    } as never;
    const openPromise = shortcutHandler?.(ctx);
    assert.ok(root);
    root!.handleInput("model");
    assert.equal(root!.query, "model");
    root!.handleInput("\r");
    await eventually(() => root!.busy === false);
    assert.equal(root!.query, "model");
    assert.equal(root!.busy, false);
    root!.handleInput("\u001b");
    await openPromise;
});

void test("contribution close disposition closes the root stack", async () => {
    let shortcutHandler: ((ctx: any) => Promise<void>) | undefined;
    let rootClosed = false;
    const eventHandlers = new Map<string, Array<(value: unknown) => void>>();
    const pi = {
        events: {
            on(event: string, handler: (value: unknown) => void) {
                const list = eventHandlers.get(event) ?? [];
                list.push(handler);
                eventHandlers.set(event, list);
                return () => {};
            },
            emit(event: string, value?: unknown) {
                for (const handler of eventHandlers.get(event) ?? []) handler(value);
            },
        },
        on() {},
        registerShortcut(_key: string, options: { handler: (ctx: any) => Promise<void> }) {
            shortcutHandler = options.handler;
        },
        getActiveTools: () => ["read"], getThinkingLevel: () => "medium",
    };
    provideCommandPaletteContribution(pi.events, {
        owner: "subagent", id: "agents", label: "/subagent  Manage", description: "sessions",
        async run() { return "close" as const; },
    });
    commandPalette(pi as never, "/nonexistent-agent-dir");
    const ctx = {
        mode: "tui", model: undefined,
        ui: {
            theme: { name: "dark" }, getToolsExpanded: () => false, notify() {},
            async custom(factory: any) {
                return await new Promise(resolve => {
                    const component = factory({ terminal: { rows: 24, columns: 80 }, requestRender() {} } as TUI, theme, {}, () => { rootClosed = true; resolve(null); });
                    component.handleInput("subagent");
                    void Promise.resolve(component.handleInput("\r"));
                });
            },
        },
    } as never;
    await shortcutHandler?.(ctx);
    assert.equal(rootClosed, true);
});

void test("session information includes the validated active readable profile", async () => {
    let rendered = "";
    const ctx = {
        model: undefined, cwd: "/work", getContextUsage: () => undefined,
        sessionManager: {
            getEntries: () => [], getHeader: () => ({ cwd: "/work" }), getSessionName: () => undefined,
            getSessionFile: () => undefined, getSessionId: () => "sid",
        },
        ui: {
            async custom(factory: any) {
                return await new Promise(resolve => {
                    const component = factory({ terminal: { rows: 24, columns: 80 }, requestRender() {} } as TUI, theme, {}, resolve);
                    rendered = component.render(80).join("\n");
                    component.handleInput("\r");
                });
            },
        },
    } as never;
    await executePaletteAction("session-info", {} as never, ctx, resolvePaletteKeymap(), undefined, "reviewer");
    assert.match(rendered, /Profile: reviewer/);
});

void test("immediate tool-output action updates root status without closing", async () => {
    const root = new PaletteListComponent<string>({
        tui: { terminal: { rows: 24, columns: 80 }, requestRender() {} } as TUI,
        theme,
        title: "Command Palette",
        keymap: resolvePaletteKeymap(),
        items: [{ value: "tool-output", label: "/tool-output" }],
        done() { assert.fail("root should stay open"); },
    });
    const pi = {
        getActiveTools: () => ["read"], getThinkingLevel: () => "medium",
    } as never;
    let expanded = false;
    const ctx = {
        model: undefined,
        ui: { getToolsExpanded: () => expanded, setToolsExpanded(value: boolean) { expanded = value; }, theme: { name: "dark" } },
    } as never;
    await executePaletteAction("tool-output", pi, ctx, resolvePaletteKeymap(), root);
    assert.match(root.render(80).join("\n"), /expanded/);
    assert.equal(expanded, true);
});
