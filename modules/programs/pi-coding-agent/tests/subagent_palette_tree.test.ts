import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { defaultPaletteKeymap } from "../extensions_src/utilities/command_palette_keymap.ts";
import {
    clipDetailLines,
    composeAgentRow,
    composeDetailSections,
    composeIdentityLine,
    DETAIL_BREAKPOINT,
    detailPaneModel,
    splitPaletteColumns,
    SubagentPaletteComponent,
    type SubagentPaletteDependencies,
} from "../extensions_src/utilities/subagent_palette.ts";
import { emptyUsage, type AgentRecord, type AgentSnapshot, type AgentState, type TaskSnapshot, type TaskState } from "../extensions_src/utilities/subagent_types.ts";

const theme = {
    fg(color: string, text: string) { return `[${color}]${text}`; },
    bg(color: string, text: string) { return `{${color}}${text}`; },
    bold(text: string) { return `*${text}*`; },
} as Theme;

function taskSnapshot(options: {
    agentId: string;
    taskId?: string;
    state: TaskState;
    prompt: string;
    purpose?: string;
    output?: string;
    error?: string;
    result?: boolean;
}): TaskSnapshot {
    const taskId = options.taskId ?? "11111111-1111-4111-8111-111111111111";
    const includeResult = options.result ?? (options.state === "succeeded" || options.state === "failed" || options.state === "stopped");
    return {
        request: {
            schemaVersion: 1,
            agentId: options.agentId,
            taskId,
            purpose: options.purpose ?? "task purpose",
            prompt: options.prompt,
            createdAt: "2026-01-01T00:00:00.000Z",
        },
        status: {
            schemaVersion: 1,
            agentId: options.agentId,
            taskId,
            state: options.state,
            createdAt: "2026-01-01T00:00:00.000Z",
            ...(options.state === "running" || includeResult ? { startedAt: "2026-01-01T00:00:01.000Z" } : {}),
            ...(includeResult ? { finishedAt: "2026-01-01T00:00:02.000Z" } : {}),
            ...(options.error ? { error: options.error } : {}),
        },
        result: includeResult
            ? {
                schemaVersion: 1,
                agentId: options.agentId,
                taskId,
                outcome: options.state === "created" || options.state === "running" ? "succeeded" : options.state,
                output: options.output ?? "",
                usage: emptyUsage(),
                turns: 1,
                interventions: [],
                startedAt: "2026-01-01T00:00:01.000Z",
                finishedAt: "2026-01-01T00:00:02.000Z",
                ...(options.error ? { error: options.error } : {}),
            }
            : null,
        interventions: [],
        claimed: false,
        directory: `/tmp/${taskId}`,
    };
}

function snapshot(options: {
    agentId: string;
    purpose: string;
    state: AgentState;
    parentAgentId?: string;
    createdAt: string;
    profile?: string;
    childSessionId?: string;
    childSessionFile?: string;
    task?: TaskSnapshot;
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
        ...(options.task ? { task: options.task } : {}),
    };
}

function component(
    done: (value: "return" | "close") => void = () => {},
    overrides: Partial<SubagentPaletteDependencies> = {},
    renderTheme: Theme = theme,
    terminalRows = 24,
) {
    let nextTimer = 0;
    const timers = new Map<number, () => void>();
    return new SubagentPaletteComponent({
        tui: { terminal: { rows: terminalRows, columns: 100 }, requestRender() {} } as never,
        theme: renderTheme,
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
            ...overrides,
        },
        done,
    });
}

function assertWithinWidth(lines: readonly string[], width: number): void {
    for (const line of lines) assert.ok(visibleWidth(line) <= width, `overflow at ${width}: ${line}`);
}

void test("subagent palette renders framed one-row tree with handles, profile role, and state badge", () => {
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
    assert.doesNotMatch(rendered, /via /);
    assert.match(rendered, /\[accent\]|\[toolTitle\]|\[mdHeading\]|\[syntax|\[customMessageLabel\]|\[mdCode\]|\[mdLink\]|\[bashMode\]|\[thinkingText\]|\[userMessageText\]/);
    for (const width of [80, 60, 20, 8, 1]) {
        assertWithinWidth(palette.render(width), width);
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

void test("v rejects terminal agents without launching a preview", async () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let previews = 0;
    const palette = component(() => {}, { previewLive: async () => { previews += 1; return "dismissed"; } });
    palette.replaceAgents([snapshot({
        agentId: a, purpose: "done", state: "stopped", createdAt: "2026-01-01T00:00:00.000Z",
        childSessionId: "child-session", childSessionFile: "/tmp/history.jsonl",
    })]);
    palette.handleInput(" ");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(previews, 0);
    const rendered = palette.render(80).join("\n");
    assert.match(rendered, /Live preview is available only for live agents\./);
    assert.match(rendered, /Press Enter for history\./);
    palette.close();
});

void test("v dismissal refreshes and retains the selected live agent", async () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const live = snapshot({ agentId: a, purpose: "live", state: "idle", createdAt: "2026-01-01T00:00:00.000Z" });
    let previews = 0;
    const palette = component(() => {}, {
        env: { TMUX: "/tmp/tmux,1,0" },
        exec: async (_command, args) => args.join(" ").includes("#{pid}\t#{session_id}")
            ? { stdout: "10\t$parent\tmain\t%parent\t/dev/ttys001\n", stderr: "", code: 0 }
            : { stdout: "", stderr: "", code: 0 },
        previewLive: async () => { previews += 1; return "dismissed"; },
        discover: async () => ({ agents: [live], malformedCount: 0 }),
    });
    palette.replaceAgents([live]);
    palette.handleInput(" ");
    while (palette.acting) await new Promise(resolve => setImmediate(resolve));
    assert.equal(previews, 1);
    assert.equal(palette.selectedAgentId, a);
    assert.match(palette.render(80).join("\n"), /Preview closed for/);
    palette.close();
});

void test("preview Enter promotion uses the existing full-window open path", async () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let disposition: "return" | "close" | undefined;
    let opens = 0;
    let probes = 0;
    const palette = component(value => { disposition = value; }, {
        env: { TMUX: "/tmp/tmux,1,0" },
        exec: async (_command, args) => {
            if (args.join(" ").includes("#{pid}\t#{session_id}")) {
                probes += 1;
                return { stdout: "10\t$parent\tmain\t%parent\t/dev/ttys001\n", stderr: "", code: 0 };
            }
            return { stdout: "", stderr: "", code: 0 };
        },
        previewLive: async () => "open-full",
        openLiveWindow: async () => { opens += 1; },
    });
    palette.replaceAgents([snapshot({ agentId: a, purpose: "live", state: "busy", createdAt: "2026-01-01T00:00:00.000Z" })]);
    await palette.action("preview");
    assert.equal(opens, 1);
    assert.equal(probes, 2);
    assert.equal(disposition, "close");
});

void test("preview promotion failure retains the palette with an error", async () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let disposition: "return" | "close" | undefined;
    const palette = component(value => { disposition = value; }, {
        env: { TMUX: "/tmp/tmux,1,0" },
        exec: async (_command, args) => args.join(" ").includes("#{pid}\t#{session_id}")
            ? { stdout: "10\t$parent\tmain\t%parent\t/dev/ttys001\n", stderr: "", code: 0 }
            : { stdout: "", stderr: "", code: 0 },
        previewLive: async () => "open-full",
        openLiveWindow: async () => { throw new Error("promotion rejected"); },
    });
    palette.replaceAgents([snapshot({ agentId: a, purpose: "live", state: "idle", createdAt: "2026-01-01T00:00:00.000Z" })]);
    await palette.action("preview");
    assert.equal(disposition, undefined);
    assert.match(palette.render(80).join("\n"), /preview failed: promotion rejected/);
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
                if (joined.includes("#{pid}\t#{session_id}\t#{session_name}\t#{pane_id}\t#{client_name}")) {
                    return { stdout: "10\t$parent\tmain\t%parent\t/dev/ttys001\n", stderr: "", code: 0 };
                }
                if (joined.includes("#{pid}")) return { stdout: "10\n", stderr: "", code: 0 };
                if (joined.includes("list-panes")) return { stdout: "%aaaa\t0\n", stderr: "", code: 0 };
                if (joined.includes("has-session")) return { stdout: "", stderr: "", code: 0 };
                if (joined.includes("list-windows")) return { stdout: "@aaaa\n", stderr: "", code: 0 };
                if (joined.includes("link-window") || joined.includes("select-window") || joined.includes("resize-window")) return { stdout: "", stderr: "", code: 0 };
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
                if (joined.includes("#{pid}\t#{session_id}\t#{session_name}\t#{pane_id}\t#{client_name}")) {
                    return { stdout: "10\t$parent\tmain\t%parent\t/dev/ttys001\n", stderr: "", code: 0 };
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
                if (joined.includes("#{pid}\t#{session_id}\t#{session_name}\t#{pane_id}\t#{client_name}")) {
                    return { stdout: "10\t$parent\tmain\t%parent\t/dev/ttys001\n", stderr: "", code: 0 };
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

void test("narrow state text is retained before profile and one-row viewports use ordinary indices", () => {
    const line = composeIdentityLine({
        width: 18,
        marker: "> ",
        connector: "├─",
        expand: "▾ ",
        handle: "Maple-aaaa",
        profile: "reviewer",
        state: "● BUSY",
    });
    assert.match(line, /BUSY|●/);
    assert.match(line, /Maple-aaaa/);
    assert.ok(visibleWidth(line) <= 18);
    assert.doesNotMatch(line, /reviewer/);
    const tight = composeIdentityLine({
        width: 16,
        marker: "> ",
        connector: "├─",
        expand: "▾ ",
        handle: "Maple-aaaa",
        profile: "reviewer",
        state: "● BUSY",
    });
    assert.match(tight, /Maple-aaaa/);
    assert.ok(visibleWidth(tight) <= 16);
    const withPurpose = composeAgentRow({
        width: 48,
        marker: "> ",
        connector: "",
        expand: "  ",
        handle: "Maple-aaaa",
        profile: "tester",
        state: "○ IDLE",
        purpose: "short purpose",
    });
    assert.match(withPurpose, /short purpose/);
    assert.ok(visibleWidth(withPurpose) <= 48);

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
    const at20 = odd.render(20).join("\n");
    assert.match(at20, /Cedar-aaaa|Cedar-bbbb/);
    assert.match(at20, /○|●/);
    for (const width of [20, 8, 1]) {
        assertWithinWidth(odd.render(width), width);
    }
    odd.close();
});

void test("responsive detail pane appears only at and above the breakpoint with clamped list width", () => {
    assert.equal(splitPaletteColumns(DETAIL_BREAKPOINT - 1).detailWidth, undefined);
    assert.equal(splitPaletteColumns(DETAIL_BREAKPOINT - 1).listWidth, DETAIL_BREAKPOINT - 1);
    const atBreak = splitPaletteColumns(DETAIL_BREAKPOINT);
    assert.equal(atBreak.listWidth, 40);
    assert.equal(atBreak.detailWidth, DETAIL_BREAKPOINT - 40 - 3);
    const wide = splitPaletteColumns(160);
    assert.equal(wide.listWidth, 52);
    assert.equal(wide.detailWidth, 160 - 52 - 3);

    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const palette = component();
    palette.replaceAgents([
        snapshot({
            agentId: a,
            purpose: "root purpose",
            state: "busy",
            createdAt: "2026-01-01T00:00:00.000Z",
            task: taskSnapshot({ agentId: a, state: "running", prompt: "Parent instruction for root" }),
        }),
        snapshot({
            agentId: b,
            purpose: "child purpose",
            state: "idle",
            parentAgentId: a,
            createdAt: "2026-01-01T00:01:00.000Z",
            task: taskSnapshot({ agentId: b, state: "succeeded", prompt: "Child instruction", output: "Child answer text" }),
        }),
    ]);

    const narrowInner = DETAIL_BREAKPOINT - 1;
    const narrowRender = narrowInner + 2;
    const narrow = palette.render(narrowRender).join("\n");
    assert.doesNotMatch(narrow, / │ /);
    assert.doesNotMatch(narrow, /\[accent\]Instruction/);
    assert.doesNotMatch(narrow, /Child answer text/);

    const wideRender = DETAIL_BREAKPOINT + 2;
    const wideText = palette.render(wideRender).join("\n");
    assert.match(wideText, / │ /);
    assert.match(wideText, /\[accent\]Instruction/);
    assert.match(wideText, /Parent instruction for root/);

    palette.handleInput("\u000e");
    const selectedChild = palette.render(wideRender).join("\n");
    assert.match(selectedChild, /\[success\]Answer/);
    assert.match(selectedChild, /Child answer text/);
    assert.doesNotMatch(selectedChild, /Parent instruction for root/);

    for (const width of [1, narrowRender, wideRender, wideRender + 1, 160]) {
        assertWithinWidth(palette.render(width), width);
    }
    palette.close();
});

void test("detail pane prefers terminal answers, ignores provisional results, and uses semantic roles", () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const provisional = taskSnapshot({
        agentId: a,
        state: "running",
        prompt: "Live instruction body",
        output: "provisional answer should be ignored",
        result: true,
    });
    assert.equal(provisional.result?.output, "provisional answer should be ignored");
    const running = detailPaneModel(snapshot({
        agentId: a, purpose: "purpose", state: "busy", createdAt: "2026-01-01T00:00:00.000Z", task: provisional,
    }));
    assert.equal(running.role, "accent");
    assert.equal(running.title, "Instruction");
    assert.equal(running.body, "Live instruction body");

    assert.equal(detailPaneModel(snapshot({
        agentId: a, purpose: "purpose", state: "idle", createdAt: "2026-01-01T00:00:00.000Z",
        task: taskSnapshot({ agentId: a, state: "succeeded", prompt: "instr", output: "final answer" }),
    })).role, "success");
    assert.equal(detailPaneModel(snapshot({
        agentId: a, purpose: "purpose", state: "failed", createdAt: "2026-01-01T00:00:00.000Z",
        task: taskSnapshot({ agentId: a, state: "failed", prompt: "instr", output: "", error: "boom" }),
    })).role, "error");
    assert.equal(detailPaneModel(snapshot({
        agentId: a, purpose: "purpose", state: "stopped", createdAt: "2026-01-01T00:00:00.000Z",
        task: taskSnapshot({ agentId: a, state: "stopped", prompt: "instr", output: "partial" }),
    })).role, "warning");

    const noTask = detailPaneModel(snapshot({ agentId: a, purpose: "agent purpose only", state: "idle", createdAt: "2026-01-01T00:00:00.000Z" }));
    assert.equal(noTask.role, "warning");
    assert.equal(noTask.title, "Purpose");
    assert.equal(noTask.body, "agent purpose only");
    assert.deepEqual(noTask.notices.map(notice => notice.text), ["No task record"]);

    const blankAnswer = detailPaneModel(snapshot({
        agentId: a, purpose: "purpose", state: "idle", createdAt: "2026-01-01T00:00:00.000Z",
        task: taskSnapshot({ agentId: a, state: "succeeded", prompt: "instr", output: "   " }),
    }));
    assert.equal(blankAnswer.body, "");
    assert.deepEqual(blankAnswer.notices.map(notice => notice.text), ["No answer text was recorded."]);

    const missingResult = detailPaneModel(snapshot({
        agentId: a, purpose: "purpose", state: "stopped", createdAt: "2026-01-01T00:00:00.000Z",
        task: taskSnapshot({ agentId: a, state: "stopped", prompt: "original instruction", result: false }),
    }));
    assert.equal(missingResult.role, "warning");
    assert.equal(missingResult.body, "original instruction");
    assert.deepEqual(missingResult.notices.map(notice => notice.text), ["Answer not recorded"]);

    assert.equal(detailPaneModel(undefined).notices[0]?.text, "No agent selected.");
});

void test("detail wrapping clips with a final ellipsis and stays within width", () => {
    const long = Array.from({ length: 40 }, (_, index) => `line-${index}-${"word ".repeat(8)}`).join("\n");
    const wrapped = long.split("\n");
    const clipped = clipDetailLines(wrapped, 5, 20);
    assert.equal(clipped.length, 5);
    assert.match(clipped[4] ?? "", /…/u);
    for (const line of clipped) assert.ok(visibleWidth(line) <= 20);

    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const palette = component();
    palette.replaceAgents([snapshot({
        agentId: a,
        purpose: "purpose",
        state: "busy",
        createdAt: "2026-01-01T00:00:00.000Z",
        task: taskSnapshot({ agentId: a, state: "running", prompt: long }),
    })]);
    const wide = DETAIL_BREAKPOINT + 2;
    const rendered = palette.render(wide);
    assertWithinWidth(rendered, wide);
    assert.match(rendered.join("\n"), /…/);
    palette.close();
});

void test("composeDetailSections keeps notices visible while body clips with ellipsis", () => {
    const body = Array.from({ length: 20 }, (_, index) => `body-${index}`);
    const composed = composeDetailSections({
        width: 24,
        height: 6,
        headerLines: ["Title", "----"],
        bodyLines: body,
        noticeLines: ["No task record"],
    });
    assert.equal(composed.length, 6);
    assert.equal(composed[0], "Title");
    assert.equal(composed[1], "----");
    assert.match(composed[4] ?? "", /…/u);
    assert.equal(composed[5], "No task record");
    assert.ok(composed.some(line => line.includes("body-")));
    assert.ok(!composed.includes("body-19"));

    const tight = composeDetailSections({
        width: 24,
        height: 3,
        headerLines: ["Answer", "----"],
        bodyLines: body,
        noticeLines: ["Answer not recorded"],
    });
    assert.equal(tight.length, 3);
    assert.equal(tight[0], "Answer");
    assert.doesNotMatch(tight[0] ?? "", /----/);
    assert.ok(!tight.includes("----"));
    assert.match(tight[1] ?? "", /…/u);
    assert.equal(tight[2], "Answer not recorded");
});

void test("rendered incomplete-record notices stay visible under long clipped body text", () => {
    const long = Array.from({ length: 40 }, (_, index) => `overflow-${index}-${"word ".repeat(10)}`).join("\n");
    const wide = DETAIL_BREAKPOINT + 2;
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    // Width-neutral theme so frame/selection markers cannot eat a trailing ellipsis during asserts.
    const plain = {
        fg(_color: string, text: string) { return text; },
        bg(_color: string, text: string) { return text; },
        bold(text: string) { return text; },
    } as Theme;

    const missingTask = component(() => {}, {}, plain);
    missingTask.replaceAgents([snapshot({
        agentId: a,
        purpose: long,
        state: "idle",
        createdAt: "2026-01-01T00:00:00.000Z",
    })]);
    const missingTaskText = missingTask.render(wide).join("\n");
    assert.match(missingTaskText, /No task record/);
    assert.match(missingTaskText, /…/);
    assert.doesNotMatch(missingTaskText, /overflow-39/);
    assertWithinWidth(missingTask.render(wide), wide);
    missingTask.close();

    const missingResult = component(() => {}, {}, plain);
    missingResult.replaceAgents([snapshot({
        agentId: a,
        purpose: "purpose",
        state: "stopped",
        createdAt: "2026-01-01T00:00:00.000Z",
        task: taskSnapshot({ agentId: a, state: "stopped", prompt: long, result: false }),
    })]);
    const missingResultText = missingResult.render(wide).join("\n");
    assert.match(missingResultText, /Answer not recorded/);
    assert.match(missingResultText, /…/);
    assert.doesNotMatch(missingResultText, /overflow-39/);
    assertWithinWidth(missingResult.render(wide), wide);
    missingResult.close();
});

void test("three-row terminal-preview detail keeps title, ellipsis, and missing-result notice", async () => {
    const long = Array.from({ length: 40 }, (_, index) => `overflow-${index}-${"word ".repeat(10)}`).join("\n");
    const wide = DETAIL_BREAKPOINT + 2;
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const plain = {
        fg(_color: string, text: string) { return text; },
        bg(_color: string, text: string) { return text; },
        bold(text: string) { return text; },
    } as Theme;
    // rows=15 => palette rows 10; two-line terminal-preview status yields a 3-row viewport.
    const palette = component(() => {}, {}, plain, 15);
    palette.replaceAgents([snapshot({
        agentId: a,
        purpose: "purpose",
        state: "stopped",
        createdAt: "2026-01-01T00:00:00.000Z",
        childSessionId: "child-session",
        childSessionFile: "/tmp/history.jsonl",
        task: taskSnapshot({ agentId: a, state: "stopped", prompt: long, result: false }),
    })]);
    await palette.action("preview");
    const rendered = palette.render(wide);
    const text = rendered.join("\n");
    assert.match(text, /Live preview is available only for live agents\./);
    assert.match(text, /Press Enter for history\./);
    assert.match(text, /Answer/);
    assert.match(text, /Answer not recorded/);
    assert.match(text, /…/);
    assert.doesNotMatch(text, /overflow-39/);
    assertWithinWidth(rendered, wide);
    palette.close();
});
