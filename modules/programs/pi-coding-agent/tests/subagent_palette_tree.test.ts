import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { defaultPaletteKeymap } from "../extensions_src/utilities/command_palette_keymap.ts";
import { composeIdentityLine, evenViewportRows, SubagentPaletteComponent } from "../extensions_src/utilities/subagent_palette.ts";
import { emptyUsage, type AgentRecord, type AgentSnapshot, type AgentState } from "../extensions_src/utilities/subagent_types.ts";

const theme = {
    fg(color: string, text: string) { return `[${color}]${text}`; },
    bg(color: string, text: string) { return `{${color}}${text}`; },
    bold(text: string) { return `*${text}*`; },
} as Theme;

function snapshot(options: {
    agentId: string;
    purpose: string;
    state: AgentState;
    parentAgentId?: string;
    createdAt: string;
    profile?: string;
    childSessionId?: string;
    childSessionFile?: string;
}): AgentSnapshot {
    const agent: AgentRecord = {
        schemaVersion: 1,
        agentId: options.agentId,
        profile: options.profile ?? "tester",
        purpose: options.purpose,
        harness: "pi",
        cwd: "/work",
        createdAt: options.createdAt,
        profileSnapshot: { name: options.profile ?? "tester", tools: [], thinking: "off" } as never,
        tmux: { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "s", windowId: `@${options.agentId.slice(0, 4)}`, paneId: `%${options.agentId.slice(0, 4)}`, windowName: "w" },
        capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true },
        callerProfile: "taskmaster",
        targetProfile: options.profile ?? "tester",
        depth: options.parentAgentId ? 2 : 1,
        originSessionId: "origin",
        ...(options.parentAgentId ? { parentAgentId: options.parentAgentId } : {}),
    };
    return {
        agent,
        status: {
            schemaVersion: 1,
            agentId: options.agentId,
            state: options.state,
            bridgeReady: true,
            agentUsage: emptyUsage(),
            accountedTaskIds: [],
            updatedAt: options.createdAt,
            ...(options.childSessionId ? { childSessionId: options.childSessionId } : {}),
            ...(options.childSessionFile ? { childSessionFile: options.childSessionFile } : {}),
        },
    };
}

function component(done: (value: "return" | "close") => void = () => {}) {
    let nextTimer = 0;
    const timers = new Map<number, () => void>();
    return new SubagentPaletteComponent({
        tui: { terminal: { rows: 24, columns: 100 }, requestRender() {} } as never,
        theme,
        ui: { confirm: async () => true },
        keymap: defaultPaletteKeymap,
        deps: {
            stateRoot: "/tmp/unused",
            originSessionId: "origin",
            tmux: "/tmux",
            historyViewerExtension: "/history.ts",
            piCommand: "/pi",
            natureHandleWords: ["Maple", "Cedar"],
            exec: async () => ({ stdout: "", stderr: "no", code: 1 }),
            setTimeout: ((callback: () => void) => { nextTimer += 1; timers.set(nextTimer, callback); return nextTimer; }) as unknown as typeof setTimeout,
            clearTimeout: ((timer: number) => { timers.delete(timer); }) as unknown as typeof clearTimeout,
        },
        done,
    });
}

void test("subagent palette renders framed two-line tree with handles, profile role, and state badge", () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const c = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const palette = component();
    palette.replaceAgents([
        snapshot({ agentId: a, purpose: "root task", state: "idle", createdAt: "2026-01-01T00:00:00.000Z", profile: "reviewer" }),
        snapshot({ agentId: b, purpose: "middle task", state: "stopped", parentAgentId: a, createdAt: "2026-01-01T00:01:00.000Z", profile: "tester" }),
        snapshot({ agentId: c, purpose: "leaf task", state: "busy", parentAgentId: b, createdAt: "2026-01-01T00:02:00.000Z", profile: "tester" }),
    ]);
    const rendered = palette.render(100).join("\n");
    assert.match(rendered, /Command Palette › Subagent Sessions/);
    assert.match(rendered, /┌/);
    assert.match(rendered, /STOPPED/);
    assert.match(rendered, /BUSY/);
    assert.match(rendered, /via /);
    assert.match(rendered, /\[accent\]|\[toolTitle\]|\[mdHeading\]|\[syntax|\[customMessageLabel\]|\[mdCode\]|\[mdLink\]|\[bashMode\]|\[thinkingText\]|\[userMessageText\]/);
    for (const width of [80, 60, 20, 8, 1]) {
        for (const line of palette.render(width)) assert.ok(visibleWidth(line) <= width, `overflow at ${width}: ${line}`);
    }
    palette.close();
});

void test("left/right collapse and expand keep selection by agentId across refresh", () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const agents = [
        snapshot({ agentId: a, purpose: "root", state: "idle", createdAt: "2026-01-01T00:00:00.000Z" }),
        snapshot({ agentId: b, purpose: "child", state: "idle", parentAgentId: a, createdAt: "2026-01-01T00:01:00.000Z" }),
    ];
    const palette = component();
    palette.replaceAgents(agents);
    palette.handleInput("\u000e");
    assert.equal(palette.selectedAgentId, b);
    palette.handleInput("\u001b[D");
    assert.equal(palette.selectedAgentId, a);
    palette.handleInput("\u001b[D");
    assert.ok(palette.collapsedIds.has(a));
    assert.equal(palette.visibleNodes().length, 1);
    palette.handleInput("\u001b[C");
    assert.equal(palette.visibleNodes().length, 2);
    const selected = palette.selectedAgentId;
    palette.replaceAgents(agents);
    assert.equal(palette.selectedAgentId, selected);
    palette.close();
});

void test("stop remains selected as ghost and disabled actions report status reasons", async () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const palette = component();
    palette.replaceAgents([snapshot({ agentId: a, purpose: "only", state: "stopped", createdAt: "2026-01-01T00:00:00.000Z" })]);
    await palette.action("stop");
    assert.match(palette.render(80).join("\n"), /Stop is available only for live agents/);
    await palette.action("open");
    assert.match(palette.render(80).join("\n"), /history unavailable/);
    palette.close();
});

void test("live open closes the palette stack with close disposition", async () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let disposition: "return" | "close" | undefined;
    let nextTimer = 0;
    const timers = new Map<number, () => void>();
    const palette = new SubagentPaletteComponent({
        tui: { terminal: { rows: 24, columns: 100 }, requestRender() {} } as never,
        theme,
        ui: { confirm: async () => true },
        keymap: defaultPaletteKeymap,
        deps: {
            stateRoot: "/tmp/unused", originSessionId: "origin", tmux: "/tmux", historyViewerExtension: "/history.ts", piCommand: "/pi", natureHandleWords: ["Maple", "Cedar"],
            env: { TMUX: "/tmp/tmux,1,0" },
            exec: async (_command, args) => {
                const joined = args.join(" ");
                if (joined.includes("#{pid}\t#{session_id}\t#{session_name}\t#{pane_id}")) {
                    return { stdout: "10\t$parent\tmain\t%parent\n", stderr: "", code: 0 };
                }
                if (joined.includes("#{pid}")) return { stdout: "10\n", stderr: "", code: 0 };
                if (joined.includes("list-panes")) return { stdout: "%aaaa\t0\n", stderr: "", code: 0 };
                if (joined.includes("has-session")) return { stdout: "", stderr: "", code: 0 };
                if (joined.includes("list-windows")) return { stdout: "@aaaa\n", stderr: "", code: 0 };
                if (joined.includes("link-window") || joined.includes("select-window")) return { stdout: "", stderr: "", code: 0 };
                return { stdout: "", stderr: "", code: 0 };
            },
            setTimeout: ((callback: () => void) => { nextTimer += 1; timers.set(nextTimer, callback); return nextTimer; }) as unknown as typeof setTimeout,
            clearTimeout: ((timer: number) => { timers.delete(timer); }) as unknown as typeof clearTimeout,
        },
        done: value => { disposition = value; },
    });
    palette.replaceAgents([snapshot({ agentId: a, purpose: "live", state: "idle", createdAt: "2026-01-01T00:00:00.000Z" })]);
    await palette.action("open");
    assert.equal(disposition, "close");
});

void test("terminal history open returns to root instead of closing the stack", async () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let disposition: "return" | "close" | undefined;
    let nextTimer = 0;
    const timers = new Map<number, () => void>();
    const palette = new SubagentPaletteComponent({
        tui: { terminal: { rows: 24, columns: 100 }, requestRender() {} } as never,
        theme,
        ui: { confirm: async () => true },
        keymap: defaultPaletteKeymap,
        deps: {
            stateRoot: "/tmp/unused", originSessionId: "origin", tmux: "/tmux", historyViewerExtension: "/history.ts", piCommand: "/pi", natureHandleWords: ["Maple", "Cedar"],
            env: { TMUX: "/tmp/tmux,1,0" },
            exec: async (_command, args) => {
                const joined = args.join(" ");
                if (joined.includes("#{pid}\t#{session_id}\t#{session_name}\t#{pane_id}")) {
                    return { stdout: "10\t$parent\tmain\t%parent\n", stderr: "", code: 0 };
                }
                return { stdout: "", stderr: "", code: 0 };
            },
            openHistory: async () => {},
            setTimeout: ((callback: () => void) => { nextTimer += 1; timers.set(nextTimer, callback); return nextTimer; }) as unknown as typeof setTimeout,
            clearTimeout: ((timer: number) => { timers.delete(timer); }) as unknown as typeof clearTimeout,
        },
        done: value => { disposition = value; },
    });
    palette.replaceAgents([snapshot({
        agentId: a, purpose: "done", state: "stopped", createdAt: "2026-01-01T00:00:00.000Z",
        childSessionId: "child-session", childSessionFile: "/tmp/history.jsonl",
    })]);
    await palette.action("open");
    assert.equal(disposition, "return");
});

void test("delayed live open still closes with close after cancel during WORKING", async () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let disposition: "return" | "close" | undefined;
    let releaseOpen: (() => void) | undefined;
    const openGate = new Promise<void>(resolve => { releaseOpen = resolve; });
    let nextTimer = 0;
    const timers = new Map<number, () => void>();
    const palette = new SubagentPaletteComponent({
        tui: { terminal: { rows: 24, columns: 100 }, requestRender() {} } as never,
        theme,
        ui: { confirm: async () => true },
        keymap: defaultPaletteKeymap,
        deps: {
            stateRoot: "/tmp/unused", originSessionId: "origin", tmux: "/tmux", historyViewerExtension: "/history.ts", piCommand: "/pi", natureHandleWords: ["Maple", "Cedar"],
            env: { TMUX: "/tmp/tmux,1,0" },
            exec: async (_command, args) => {
                const joined = args.join(" ");
                if (joined.includes("#{pid}\t#{session_id}\t#{session_name}\t#{pane_id}")) {
                    return { stdout: "10\t$parent\tmain\t%parent\n", stderr: "", code: 0 };
                }
                return { stdout: "", stderr: "", code: 0 };
            },
            openLiveWindow: async () => { await openGate; },
            setTimeout: ((callback: () => void) => { nextTimer += 1; timers.set(nextTimer, callback); return nextTimer; }) as unknown as typeof setTimeout,
            clearTimeout: ((timer: number) => { timers.delete(timer); }) as unknown as typeof clearTimeout,
        },
        done: value => { disposition = value; },
    });
    palette.replaceAgents([snapshot({ agentId: a, purpose: "live", state: "idle", createdAt: "2026-01-01T00:00:00.000Z" })]);
    const openPromise = palette.action("open");
    assert.equal(palette.acting, true);
    palette.handleInput("\u001b");
    assert.equal(disposition, undefined);
    releaseOpen?.();
    await openPromise;
    assert.equal(disposition, "close");
});

void test("overlapping refresh keeps Stop blocked until the post-stop snapshot is applied", async () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let releaseDiscovery: (() => void) | undefined;
    const discoveryGate = new Promise<void>(resolve => { releaseDiscovery = resolve; });
    let agents = [snapshot({ agentId: a, purpose: "live", state: "idle", createdAt: "2026-01-01T00:00:00.000Z" })];
    let discoveries = 0;
    let nextTimer = 0;
    const timers = new Map<number, () => void>();
    const palette = new SubagentPaletteComponent({
        tui: { terminal: { rows: 24, columns: 100 }, requestRender() {} } as never,
        theme,
        ui: { confirm: async () => true },
        keymap: defaultPaletteKeymap,
        deps: {
            stateRoot: "/tmp/unused", originSessionId: "origin", tmux: "/tmux", historyViewerExtension: "/history.ts", piCommand: "/pi", natureHandleWords: ["Maple", "Cedar"],
            exec: async () => ({ stdout: "", stderr: "", code: 0 }),
            stopAgent: async () => {
                agents = [snapshot({ agentId: a, purpose: "live", state: "stopped", createdAt: "2026-01-01T00:00:00.000Z" })];
                return agents[0]!;
            },
            discover: async () => {
                discoveries += 1;
                if (discoveries === 1) await discoveryGate;
                return { agents, malformedCount: 0 };
            },
            setTimeout: ((callback: () => void) => { nextTimer += 1; timers.set(nextTimer, callback); return nextTimer; }) as unknown as typeof setTimeout,
            clearTimeout: ((timer: number) => { timers.delete(timer); }) as unknown as typeof clearTimeout,
        },
        done: () => {},
    });
    palette.replaceAgents(agents);
    const refreshPromise = palette.refresh();
    const stopPromise = palette.action("stop");
    await Promise.resolve();
    assert.equal(palette.acting, true);
    await palette.action("stop");
    releaseDiscovery?.();
    await refreshPromise;
    await stopPromise;
    assert.equal(palette.selected()?.status.state, "stopped");
    await palette.action("stop");
    assert.match(palette.render(80).join("\n"), /Stop is available only for live agents/);
    palette.close();
});

void test("successful Stop stays non-actionable when post-stop discovery fails", async () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let nextTimer = 0;
    const timers = new Map<number, () => void>();
    const stopped = snapshot({ agentId: a, purpose: "live", state: "stopped", createdAt: "2026-01-01T00:00:00.000Z" });
    const palette = new SubagentPaletteComponent({
        tui: { terminal: { rows: 24, columns: 100 }, requestRender() {} } as never,
        theme,
        ui: { confirm: async () => true },
        keymap: defaultPaletteKeymap,
        deps: {
            stateRoot: "/tmp/unused", originSessionId: "origin", tmux: "/tmux", historyViewerExtension: "/history.ts", piCommand: "/pi", natureHandleWords: ["Maple", "Cedar"],
            exec: async () => ({ stdout: "", stderr: "", code: 0 }),
            stopAgent: async () => stopped,
            discover: async () => { throw new Error("discovery unavailable"); },
            setTimeout: ((callback: () => void) => { nextTimer += 1; timers.set(nextTimer, callback); return nextTimer; }) as unknown as typeof setTimeout,
            clearTimeout: ((timer: number) => { timers.delete(timer); }) as unknown as typeof clearTimeout,
        },
        done: () => {},
    });
    palette.replaceAgents([snapshot({ agentId: a, purpose: "live", state: "idle", createdAt: "2026-01-01T00:00:00.000Z" })]);
    await palette.action("stop");
    assert.equal(palette.selected()?.status.state, "stopped");
    assert.equal(palette.selectedAgentId, a);
    const rendered = palette.render(80).join("\n");
    assert.match(rendered, /STOPPED/);
    assert.match(rendered, /Stopped .*; refresh failed/);
    await palette.action("stop");
    assert.match(palette.render(80).join("\n"), /Stop is available only for live agents/);
    await palette.action("unlink");
    assert.match(palette.render(80).join("\n"), /Unlink is available only for live agents/);
    palette.close();
});

void test("narrow state text is retained before profile and odd viewports stay even", () => {
    const line = composeIdentityLine({
        width: 18,
        marker: "> ",
        connector: "├─",
        expand: "▾ ",
        handle: "Maple-aaaa",
        profile: "review-orchestrator",
        state: "● BUSY",
    });
    assert.match(line, /BUSY|●/);
    assert.match(line, /Maple-aaaa/);
    assert.ok(visibleWidth(line) <= 18);
    assert.doesNotMatch(line, /review-orchestrator/);
    const tight = composeIdentityLine({
        width: 16,
        marker: "> ",
        connector: "├─",
        expand: "▾ ",
        handle: "Maple-aaaa",
        profile: "review-orchestrator",
        state: "● BUSY",
    });
    assert.match(tight, /Maple-aaaa/);
    assert.ok(visibleWidth(tight) <= 16);
    assert.equal(evenViewportRows(5), 4);
    assert.equal(evenViewportRows(6), 6);

    const plain = {
        fg(_color: string, text: string) { return text; },
        bg(_color: string, text: string) { return text; },
        bold(text: string) { return text; },
    } as Theme;
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const odd = new SubagentPaletteComponent({
        tui: { terminal: { rows: 16, columns: 100 }, requestRender() {} } as never,
        theme: plain,
        ui: { confirm: async () => true },
        keymap: defaultPaletteKeymap,
        deps: {
            stateRoot: "/tmp/unused", originSessionId: "origin", tmux: "/tmux", historyViewerExtension: "/history.ts", piCommand: "/pi", natureHandleWords: ["Maple", "Cedar"],
            exec: async () => ({ stdout: "", stderr: "no", code: 1 }),
            setTimeout: ((_callback: () => void) => 1 as unknown as NodeJS.Timeout) as unknown as typeof setTimeout,
            clearTimeout: (() => {}) as typeof clearTimeout,
        },
        done: () => {},
    });
    odd.replaceAgents([
        snapshot({ agentId: a, purpose: "root", state: "idle", createdAt: "2026-01-01T00:00:00.000Z" }),
        snapshot({ agentId: b, purpose: "child", state: "busy", parentAgentId: a, createdAt: "2026-01-01T00:01:00.000Z" }),
    ]);
    const at80 = odd.render(80).join("\n");
    assert.match(at80, /IDLE/);
    assert.match(at80, /BUSY/);
    assert.equal(evenViewportRows(Math.max(2, Math.floor(16 * 0.7) - 6)), 4);
    const at20 = odd.render(20).join("\n");
    assert.match(at20, /Cedar-aaaa|Cedar-bbbb/);
    assert.match(at20, /○|●/);
    for (const width of [20, 8, 1]) {
        for (const row of odd.render(width)) assert.ok(visibleWidth(row) <= width);
    }
    odd.close();
});
