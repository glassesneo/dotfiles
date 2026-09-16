import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { resolvePaletteKeymap } from "../extensions_src/utilities/command_palette_keymap.ts";
import { ChildHistoryBodyComponent, ChildHistoryListComponent } from "../extensions_src/utilities/orchestration_history_views.ts";
import type { ChildHistoryItem } from "../extensions_src/utilities/orchestration_history_read.ts";
import { unknownAgentActivityProjection } from "../extensions_src/utilities/orchestration_activity.ts";
import { emptyUsage, type AgentSnapshot } from "../extensions_src/utilities/orchestration_types.ts";
import type { ChildDefinition } from "../extensions_src/utilities/agent_types.ts";
import { PopupStack } from "../extensions_src/popup.ts";
import type { PopupViewFactory } from "../extensions_src/utilities/popup_types.ts";
import { yieldToIO } from "./test_helpers.ts";

const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const meshId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const theme = { fg: (_role: string, text: string) => text, bg: (_role: string, text: string) => text, bold: (text: string) => text };
const keymap = resolvePaletteKeymap({ history: ["h"] });
const keys = { down: "\u000e", enter: "\r", escape: "\u001b", end: "\u001b[F" };

function snapshot(): AgentSnapshot {
    const definition: ChildDefinition = { selector: { agent: "worker", access: "read" }, description: "Synthetic worker", tools: [], instructions: "Return the bounded result.", contextPolicy: "project", childExtensionContributions: [], execution: { models: ["provider/model"], thinkingLevel: "medium", harness: "pi" }, targets: [], gc: { collectAt: 2, retain: 1, pressureFloor: 0 } };
    return {
        agent: { schemaVersion: 7, meshId, agentId, epochId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", childId: "worker", harness: "pi", cwd: "/work", createdAt: "2026-01-01T00:00:00Z", definitionSnapshot: definition, launchEnvelope: "/envelope", launchEnvelopeDigest: "digest", tmux: { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true }, creatorSessionId: "creator" },
        status: { schemaVersion: 2, meshId, agentId, state: "idle", bridgeReady: true, meshToolsEnabled: true, agentUsage: emptyUsage(), accountedTaskIds: [], updatedAt: "2026-01-01T00:00:00Z" },
        activity: unknownAgentActivityProjection(),
        stop: null,
    };
}

function item(id: string, kind: ChildHistoryItem["kind"] = "request", extra: Partial<ChildHistoryItem> = {}): ChildHistoryItem {
    return {
        id, kind, at: "2026-01-01T00:00:00Z",
        from: { endpointId: "root:mesh", label: "root" },
        to: { endpointId: `agent:${agentId}`, label: "May-child" },
        purpose: extra.purpose ?? "Investigate",
        taskState: extra.taskState ?? "succeeded",
        preview: extra.preview ?? "preview",
        truncated: extra.truncated ?? false,
        bodyRef: extra.bodyRef ?? { kind: kind === "request" ? "task-prompt" : "event", id },
        ...extra,
    };
}

function tui(rows = 24) {
    return { terminal: { rows }, requestRender() {} } as never;
}

function assertFits(lines: readonly string[], width: number, rows?: number): void {
    assert.ok(lines.every(line => visibleWidth(line) <= width));
    if (rows !== undefined) assert.ok(lines.length <= rows);
}

function containsInOrder(haystack: string, needle: string): boolean {
    let offset = 0;
    for (const character of needle) {
        const next = haystack.indexOf(character, offset);
        if (next < 0) return false;
        offset = next + character.length;
    }
    return true;
}

function innerVisible(lines: readonly string[]): string {
    return lines.slice(1, -1).map(line => line.replace(/^\s*│/u, "").replace(/│\s*$/u, "").replace(/\s+$/u, "")).join("");
}

// Admission: nested history views own focus restoration, overflow clipping, Japanese end-reach, and stale-load fencing; popup host tests do not observe these bodies.
void test("history list and body keep width, restore selection, reach japanese end, and fence stale loads", async () => {
    const items = [item("one"), item("two"), item("three")];
    let opened: string[] = [];
    const list = new ChildHistoryListComponent({
        tui: tui(), theme: theme as never, keymap, snapshot: snapshot(),
        deps: {
            stateRoot: "/state", meshId, natureHandleWords: ["May"],
            listHistory: async () => ({ items, unavailableCount: 0, loadFailed: false }),
            openBody: async selected => { opened.push(selected.id); },
        },
        done() {},
    });
    list.start(); await yieldToIO();
    list.handleInput(keys.down);
    assert.equal(list.selected()?.id, "two");
    const selected = list.selectedIndex;
    list.handleInput(keys.enter);
    await yieldToIO();
    assert.deepEqual(opened, ["two"]);
    assert.equal(list.selectedIndex, selected);
    for (const width of [20, 40, 60, 80]) {
        const rendered = list.render(width);
        assertFits(rendered, width, 24);
        assert.doesNotMatch(rendered.join("\n"), /role:|profile:/u);
    }
    const readable = list.render(80).join("\n");
    assert.match(readable, /succeeded/u);
    assert.match(readable, /2026-01-01T00:00:00Z/u);
    list.dispose();

    const purpose = "調査対象の長い目的名を本文ヘッダで最後まで読む必要";
    const japaneseEnd = "末尾印";
    const japanese = `${"終".repeat(80)}\n`.repeat(40) + japaneseEnd;
    const headerView = new ChildHistoryBodyComponent({
        tui: tui(24), theme: theme as never, keymap, item: item("header", "request", { purpose }),
        deps: { stateRoot: "/state", meshId, natureHandleWords: ["May"], readBody: async () => "body" },
        done() {},
    });
    headerView.start(); await yieldToIO();
    const headed = headerView.render(80);
    assertFits(headed, 80, 24);
    assert.equal(containsInOrder(innerVisible(headed), purpose), true);
    headerView.dispose();
    const body = new ChildHistoryBodyComponent({
        tui: tui(12), theme: theme as never, keymap, item: item("body", "request", { purpose }),
        deps: { stateRoot: "/state", meshId, natureHandleWords: ["May"], readBody: async () => japanese },
        done() {},
    });
    body.start(); await yieldToIO();
    const narrow = body.render(24);
    assertFits(narrow, 24, 12);
    body.handleInput(keys.end);
    assert.equal(body.canReachEnd(), true);
    const ended = body.render(24);
    assertFits(ended, 24, 12);
    assert.equal(containsInOrder(innerVisible(ended), japaneseEnd), true);
    body.dispose();

    let resolveLate!: (value: string) => void;
    const late = new Promise<string>(resolve => { resolveLate = resolve; });
    const stale = new ChildHistoryBodyComponent({
        tui: tui(), theme: theme as never, keymap, item: item("stale"),
        deps: { stateRoot: "/state", meshId, natureHandleWords: ["May"], readBody: async () => late },
        done() {},
    });
    stale.start();
    stale.dispose();
    resolveLate("should-not-appear");
    await yieldToIO();
    assert.equal(stale.body, "");

    let calls = 0;
    const generations = new ChildHistoryListComponent({
        tui: tui(), theme: theme as never, keymap, snapshot: snapshot(),
        deps: {
            stateRoot: "/state", meshId, natureHandleWords: ["May"],
            listHistory: async () => {
                calls += 1;
                if (calls === 1) {
                    await new Promise(resolve => setTimeout(resolve, 20));
                    return { items: [item("stale-row")], unavailableCount: 0, loadFailed: false };
                }
                return { items: [item("fresh-row")], unavailableCount: 0, loadFailed: false };
            },
            openBody: async () => {},
        },
        done() {},
    });
    generations.start();
    generations.start();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(generations.items[0]?.id, "fresh-row");
    generations.dispose();
});

void test("history list surfaces empty, unavailable, and failed states as text without blocking cancel", async () => {
    const failed = new ChildHistoryListComponent({
        tui: tui(), theme: theme as never, keymap, snapshot: snapshot(),
        deps: {
            stateRoot: "/state", meshId, natureHandleWords: ["May"],
            listHistory: async () => { throw new Error("disk"); },
            openBody: async () => {},
        },
        done() {},
    });
    failed.start(); await yieldToIO();
    assert.match(failed.status, /could not be loaded/u);
    let cancelled = false;
    const empty = new ChildHistoryListComponent({
        tui: tui(), theme: theme as never, keymap, snapshot: snapshot(),
        deps: {
            stateRoot: "/state", meshId, natureHandleWords: ["May"],
            listHistory: async () => ({ items: [], unavailableCount: 2, loadFailed: false }),
            openBody: async () => {},
        },
        done: () => { cancelled = true; },
    });
    empty.start(); await yieldToIO();
    assert.match(empty.status, /unavailable/u);
    empty.handleInput(keys.escape);
    assert.equal(cancelled, true);
    empty.dispose();
    failed.dispose();

    let bodyCancelled = false;
    const failedBody = new ChildHistoryBodyComponent({
        tui: tui(), theme: theme as never, keymap, item: item("missing"),
        deps: { stateRoot: "/state", meshId, natureHandleWords: ["May"], readBody: async () => { throw new Error("missing body"); } },
        done: () => { bodyCancelled = true; },
    });
    failedBody.start(); await yieldToIO();
    assert.match(failedBody.status, /could not be loaded/u);
    failedBody.handleInput(keys.escape);
    assert.equal(bodyCancelled, true);
    failedBody.dispose();
});

// Admission: overlay height and unsafe body sequences are view-owned; width-only cache and raw CSI would overflow or hijack the terminal.
void test("history views bound height after shrink and strip unsafe body sequences without truncating visible text", async () => {
    const terminal = { rows: 24 };
    const list = new ChildHistoryListComponent({
        tui: { terminal, requestRender() {} } as never, theme: theme as never, keymap, snapshot: snapshot(),
        deps: {
            stateRoot: "/state", meshId, natureHandleWords: ["May"],
            listHistory: async () => ({ items: [item("one")], unavailableCount: 0, loadFailed: false }),
            openBody: async () => {},
        },
        done() {},
    });
    list.start(); await yieldToIO();
    const tall = list.render(40);
    assertFits(tall, 40, 24);
    terminal.rows = 5;
    const short = list.render(40);
    assertFits(short, 40, 5);
    assert.ok(short.length <= 5);
    list.dispose();

    const marker = "visible-secret-and-the-rest-of-the-untruncated-body";
    const unsafe = `\u001b[31m${marker}\u001b[0m\u001b]8;;https://example.invalid\u0007more`;
    const bodyTerminal = { rows: 24 };
    const body = new ChildHistoryBodyComponent({
        tui: { terminal: bodyTerminal, requestRender() {} } as never, theme: theme as never, keymap, item: item("ansi"),
        deps: { stateRoot: "/state", meshId, natureHandleWords: ["May"], readBody: async () => unsafe },
        done() {},
    });
    body.start(); await yieldToIO();
    const rendered = body.render(40);
    const shown = rendered.join("\n");
    assert.equal(containsInOrder(innerVisible(rendered), marker), true);
    assert.equal(shown.includes("\u001b[31m"), false);
    assert.equal(shown.includes("\u001b]8"), false);
    bodyTerminal.rows = 6;
    const shrunk = body.render(40);
    assertFits(shrunk, 40, 6);
    body.dispose();
});

// Admission: reentrant body opens and failed push must not drop cancel or apply stale completion; component fencing is not observed by popup host tests.
void test("history list fences reentrant opens, reports async open failure, and still allows cancel", async () => {
    let opens = 0;
    let release!: () => void;
    const blocked = new ChildHistoryListComponent({
        tui: tui(), theme: theme as never, keymap, snapshot: snapshot(),
        deps: {
            stateRoot: "/state", meshId, natureHandleWords: ["May"],
            listHistory: async () => ({ items: [item("one"), item("two")], unavailableCount: 0, loadFailed: false }),
            openBody: async () => {
                opens += 1;
                await new Promise<void>(resolve => { release = resolve; });
            },
        },
        done() {},
    });
    blocked.start(); await yieldToIO();
    blocked.handleInput(keys.enter);
    await yieldToIO();
    blocked.handleInput(keys.enter);
    blocked.handleInput(keys.down);
    assert.equal(opens, 1);
    assert.equal(blocked.requestClose(), false);
    assert.equal(blocked.selected()?.id, "one");
    blocked.dispose();
    release();
    await yieldToIO();
    assert.equal(blocked.opening, false);

    let cancelled = false;
    const failing = new ChildHistoryListComponent({
        tui: tui(), theme: theme as never, keymap, snapshot: snapshot(),
        deps: {
            stateRoot: "/state", meshId, natureHandleWords: ["May"],
            listHistory: async () => ({ items: [item("one")], unavailableCount: 0, loadFailed: false }),
            openBody: async () => { throw new Error("push failed"); },
        },
        done: () => { cancelled = true; },
    });
    failing.start(); await yieldToIO();
    failing.handleInput(keys.enter);
    await yieldToIO();
    assert.match(failing.status, /could not be opened/u);
    failing.handleInput(keys.escape);
    assert.equal(cancelled, true);
    failing.dispose();
});

// Admission: AC8 back/focus restoration through the real popup stack is not covered by host-only tests or isolated component enter stubs.
void test("history list and body restore selection through PopupStack push and back", async () => {
    const items = [item("one"), item("two"), item("three")];
    let stack!: PopupStack;
    let current: ChildHistoryItem | undefined;
    let list!: ChildHistoryListComponent;
    const factories = new Map<string, PopupViewFactory>([
        ["child-history", {
            id: "child-history",
            title: "Child history",
            create(ctx) {
                list = new ChildHistoryListComponent({
                    tui: ctx.tui, theme: theme as never, keymap, snapshot: snapshot(),
                    deps: {
                        stateRoot: "/state", meshId, natureHandleWords: ["May"],
                        listHistory: async () => ({ items, unavailableCount: 0, loadFailed: false }),
                        openBody: async selected => {
                            current = selected;
                            await stack.open("child-history-body");
                        },
                    },
                    done: disposition => ctx.done(disposition),
                });
                list.start();
                return list;
            },
        }],
        ["child-history-body", {
            id: "child-history-body",
            title: "Body",
            create(ctx) {
                const body = new ChildHistoryBodyComponent({
                    tui: ctx.tui, theme: theme as never, keymap, item: current!,
                    deps: { stateRoot: "/state", meshId, natureHandleWords: ["May"], readBody: async () => "full nested body" },
                    done: disposition => ctx.done(disposition),
                });
                body.start();
                return body;
            },
        }],
    ]);
    const host = { terminal: { rows: 24, columns: 80 }, requestRender() {} };
    stack = new PopupStack(host as never, theme as never, {} as never, factories, () => {});
    stack.focused = true;
    const root = stack.open("child-history");
    await yieldToIO();
    list.handleInput(keys.down);
    assert.equal(list.selected()?.id, "two");
    const selected = list.selectedIndex;
    list.handleInput(keys.enter);
    await yieldToIO();
    assert.match(stack.render(80).join("\n"), /full nested body/u);
    stack.handleInput("\x1b");
    await yieldToIO();
    assert.equal(list.selectedIndex, selected);
    assert.equal(list.selected()?.id, "two");
    assert.equal(list.focused, true);
    stack.handleInput("\x1b");
    assert.equal(await root, "back");
});
