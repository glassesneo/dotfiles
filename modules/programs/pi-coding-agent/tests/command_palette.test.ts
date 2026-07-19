import assert from "node:assert/strict";
import test from "node:test";
import commandPalette, { buildCommandPaletteActions } from "../extensions/command_palette.ts";
import { commandPaletteActionIds } from "../extensions/utilities/command_palette_core.ts";

test("registry contains only the seven explicit draft-orthogonal adapters", () => {
    const pi = { getActiveTools: () => ["read"], getThinkingLevel: () => "medium" } as never;
    const ctx = { model: { provider: "test", id: "model" }, ui: { getToolsExpanded: () => false, theme: { name: "dark" } } } as never;
    const actions = buildCommandPaletteActions(pi, ctx);
    assert.deepEqual(actions.map(action => action.id), commandPaletteActionIds);
    assert.equal(actions.length, 7);
    assert.deepEqual(actions.map(action => action.label.split(/\s+/)[0]), ["/model", "/thinking", "/tools", "/tool-output", "/session", "/copy", "/theme"]);
});

test("one registered Ctrl-Shift-P shortcut invocation opens the palette whether idle or running", async () => {
    let shortcutHandler: ((ctx: any) => Promise<void>) | undefined;
    let customCalls = 0; let notifications = 0;
    const pi = {
        registerShortcut(key: string, options: { handler: (ctx: any) => Promise<void> }) {
            if (key === "ctrl+shift+p") shortcutHandler = options.handler;
        },
        getActiveTools: () => ["read"], getThinkingLevel: () => "medium",
    } as never;
    commandPalette(pi);
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

test("a running palette suppresses duplicate opens and can reopen after closing", async () => {
    let shortcutHandler: ((ctx: any) => Promise<void>) | undefined;
    let customCalls = 0; let closeFirst: ((value: null) => void) | undefined;
    const pi = {
        registerShortcut(key: string, options: { handler: (ctx: any) => Promise<void> }) {
            if (key === "ctrl+shift+p") shortcutHandler = options.handler;
        },
        getActiveTools: () => ["read"], getThinkingLevel: () => "medium",
    } as never;
    commandPalette(pi);
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

test("palette source does not expose editor, prompt, message-send, abort, or idle-wait dependencies", async () => {
    const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("../extensions/command_palette.ts", import.meta.url), "utf8"));
    for (const forbidden of ["getEditorText(", "setEditorText(", "pasteToEditor(", "sendUserMessage(", "sendMessage(", "getCommands(", "abort(", "waitForIdle("]) assert.doesNotMatch(source, new RegExp(forbidden.replace(/[()]/g, "\\$&")));
});
