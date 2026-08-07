import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createSubagentGetTool, createSubagentRunTool, createSubagentStopTool, createSubagentSubmitTool, createSubagentWaitTool } from "../extensions_src/subagent.ts";
import { defaultPaletteKeymap } from "../extensions_src/utilities/command_palette_keymap.ts";
import { mapConcurrent } from "../extensions_src/utilities/subagent_concurrency.ts";
import { piLaunchDescriptor } from "../extensions_src/utilities/subagent_pi.ts";
import { SubagentPaletteComponent } from "../extensions_src/utilities/subagent_palette.ts";
import { claimPendingTask, createTask, finishTask, patchAgentStatus, prepareAgent, publishAgent, readAgentSnapshot, taskPaths } from "../extensions_src/utilities/subagent_store.ts";
import { type CommandResult } from "../extensions_src/utilities/subagent_tmux.ts";
import { type AgentSnapshot } from "../extensions_src/utilities/subagent_types.ts";
import { nativeConfig as config, nativeProfile as profile, nativeTmux as tmux, subagentTestRoot } from "./subagent_native_helpers.ts";

void test("bounded concurrency preserves order without exceeding its worker limit", async () => {
    let active = 0;
    let maximum = 0;
    const values = await mapConcurrent(Array.from({ length: 40 }, (_, index) => index), 4, async value => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise(resolve => setImmediate(resolve));
        active -= 1;
        return value * 2;
    });
    assert.equal(maximum, 4);
    assert.deepEqual(values, Array.from({ length: 40 }, (_, index) => index * 2));
});
void test("pi adapter launches an interactive saved session with the bridge and no JSON flags", () => { const launch = piLaunchDescriptor(config("/state"), { agentId: "a", agentDirectory: "/state/agents/a", profile: "tester", profileSnapshot: profile, depth: 1, originSessionId: "origin" }); assert.equal(launch.command, "/pi"); assert.ok(launch.args.includes("--session-dir")); assert.ok(launch.args.includes("/bridge.ts")); assert.ok(!launch.args.includes("--mode") && !launch.args.includes("--print") && !launch.args.includes("--no-session")); });
void test("palette refresh owns one timer and close cancels polling", async () => {
    const root = await subagentTestRoot("native-palette-timer-");
    let nextTimer = 0;
    const timers = new Map<number, () => void>();
    let done = 0;
    const component = new SubagentPaletteComponent({
        tui: { requestRender() {} } as never,
        theme: { fg: (_role: string, text: string) => text, bg: (_role: string, text: string) => text, bold: (text: string) => text } as never,
        ui: { confirm: async () => false },
        keymap: defaultPaletteKeymap,
        deps: {
            stateRoot: root, originSessionId: "origin", tmux: "/tmux", historyViewerExtension: "/history-viewer.ts", piCommand: "/pi", natureHandleWords: ["Maple", "Cedar"], exec: async () => ({ stdout: "", stderr: "", code: 1 }),
            setTimeout: ((callback: () => void) => { nextTimer += 1; timers.set(nextTimer, callback); return nextTimer; }) as unknown as typeof setTimeout,
            clearTimeout: ((timer: number) => { timers.delete(timer); }) as unknown as typeof clearTimeout,
        },
        done: () => { done += 1; },
    });
    await component.refresh();
    assert.equal(timers.size, 1);
    await component.refresh();
    assert.equal(timers.size, 1);
    component.close();
    component.close();
    assert.equal(timers.size, 0);
    assert.equal(done, 1);
});
void test("wait hides a provisional result until task status is terminal", async () => {
    const root = await subagentTestRoot("native-wait-detail-");
    const configPath = join(root, "subagent.json");
    await writeFile(configPath, JSON.stringify(config(root)));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(prepared.paths, { state: "idle" });
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    const running = await claimPendingTask(root, prepared.agentId);
    const files = taskPaths(root, prepared.agentId, task.request.taskId);
    await writeFile(files.result, `${JSON.stringify({ schemaVersion: 1, agentId: prepared.agentId, taskId: task.request.taskId, outcome: "succeeded", output: "provisional", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, turns: 1, interventions: [], startedAt: running!.status.startedAt, finishedAt: new Date().toISOString() })}\n`);
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => { if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("has-session")) return { stdout: "", stderr: "", code: 0 }; if (args.includes("#{pane_id}\t#{pane_dead}")) return { stdout: "%2\t0\n", stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; };
    const controller = new AbortController();
    let partial: { details: { agents: Array<{ task: { result: unknown } }> } } | undefined;
    await assert.rejects(createSubagentWaitTool({ configPath, env: {}, exec, sleep: async () => { controller.abort(new Error("observer aborted")); } }).execute("wait-call", { taskIds: [task.request.taskId], condition: "all" }, controller.signal, value => { partial = value as typeof partial; }, { sessionManager: { getSessionId: () => "origin", getSessionFile: () => undefined } } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext), /observer aborted/);
    assert.equal(partial?.details.agents[0]!.task.result, null);
    assert.equal((await readAgentSnapshot(root, prepared.agentId, task.request.taskId)).task?.status.state, "running");
});
void test("wait partial updates skip usage claims and final results use outcome", async () => {
    const root = await subagentTestRoot("native-wait-outcome-");
    const configPath = join(root, "subagent.json");
    await writeFile(configPath, JSON.stringify(config(root)));
    const firstAgent = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(firstAgent.paths, { agentId: firstAgent.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(firstAgent.paths, { state: "idle" });
    const first = await createTask(root, firstAgent.agentId, "first", "inspect");
    await claimPendingTask(root, firstAgent.agentId);
    const secondAgent = await prepareAgent(root, { profile: "tester", purpose: "second", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(secondAgent.paths, { agentId: secondAgent.agentId, profile: "tester", purpose: "second", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux: { ...tmux, sessionId: "$3", windowId: "@3", paneId: "%3", windowName: "sa-second" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(secondAgent.paths, { state: "idle" });
    const second = await createTask(root, secondAgent.agentId, "second", "still running");
    await claimPendingTask(root, secondAgent.agentId);
    let polls = 0;
    let clock = 0;
    const updates: Array<{ claimed: string[]; outcome?: string }> = [];
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (args.includes("has-session")) return { stdout: "", stderr: "", code: 0 };
        if (args.includes("#{pane_id}\t#{pane_dead}")) return { stdout: "%2\t0\n%3\t0\n", stderr: "", code: 0 };
        return { stdout: "", stderr: "", code: 0 };
    };
    const response = await createSubagentWaitTool({
        configPath, env: {}, exec,
        now: () => clock,
        sleep: async () => {
            polls += 1;
            if (polls === 1) {
                await finishTask(root, firstAgent.agentId, first.request.taskId, { outcome: "succeeded", output: "done", usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
            }
            clock += 500;
        },
    }).execute(
        "wait-any",
        { taskIds: [second.request.taskId, first.request.taskId], condition: "any" },
        undefined,
        value => {
            const details = value.details as { outcome?: string; accounting: { claimedTaskIds: string[] } };
            updates.push({ claimed: [...details.accounting.claimedTaskIds], outcome: details.outcome });
        },
        { sessionManager: { getSessionId: () => "origin", getSessionFile: () => undefined } } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext,
    ) as { content: Array<{ text: string }>; details: { outcome: string; accounting: { claimedTaskIds: string[] }; agents: AgentSnapshot[] }; usage?: { input: number } };
    const content = JSON.parse(response.content[0]!.text) as { outcome: string; tasks: Array<{ taskId?: string; output?: string }>; reason?: string; agents?: unknown };
    assert.equal(content.outcome, "completed");
    assert.equal(content.reason, undefined);
    assert.equal(content.agents, undefined);
    assert.deepEqual(content.tasks.map(task => task.taskId), [second.request.taskId, first.request.taskId]);
    assert.equal(content.tasks[0]!.output, undefined);
    assert.equal(content.tasks[1]!.output, "done");
    assert.equal(response.details.outcome, "completed");
    assert.deepEqual(response.details.accounting.claimedTaskIds, [first.request.taskId]);
    assert.equal(response.usage?.input, 2);
    assert.ok(updates.length >= 1);
    assert.ok(updates.every(update => update.claimed.length === 0 && update.outcome === undefined));
});
void test("run existing-agent path waits for completion and claims usage once", async () => {
    const root = await subagentTestRoot("native-submit-inline-complete-");
    const configPath = join(root, "subagent.json");
    await writeFile(configPath, JSON.stringify(config(root)));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(prepared.paths, { state: "idle", bridgeReady: true });
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (args.includes("has-session")) return { stdout: "", stderr: "", code: 0 };
        if (args.includes("#{pane_id}\t#{pane_dead}")) return { stdout: "%2\t0\n", stderr: "", code: 0 };
        return { stdout: "", stderr: "", code: 0 };
    };
    let clock = 0;
    let finished = false;
    const tool = createSubagentRunTool({ configPath, env: {}, exec, now: () => clock, sleep: async () => {
        clock += 100;
        if (!finished) {
            const active = await readAgentSnapshot(root, prepared.agentId);
            assert.ok(active.status.activeTaskId);
            await finishTask(root, prepared.agentId, active.status.activeTaskId, { outcome: "succeeded", output: "inline done", usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
            finished = true;
        }
    } });
    const ctx = { sessionManager: { getSessionId: () => "origin", getSessionFile: () => undefined } } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;
    const response = await tool.execute("submit-call", { agentId: prepared.agentId, purpose: "inline", prompt: "finish this" }, undefined, undefined, ctx) as { content: Array<{ text: string }>; details: { accounting: { claimedTaskIds: string[] } }; usage?: { totalTokens: number } };
    const content = JSON.parse(response.content[0]!.text) as Record<string, unknown>;
    assert.equal(content.agentId, prepared.agentId);
    assert.equal(typeof content.taskId, "string");
    assert.equal(content.output, "inline done");
    assert.deepEqual(response.details.accounting.claimedTaskIds, [content.taskId]);
    assert.equal(response.usage?.totalTokens, 5);
    const later = await createSubagentGetTool({ configPath, env: {}, exec }).execute("get-call", { agentId: prepared.agentId }, undefined, undefined, ctx) as { usage?: unknown; details: { accounting: { claimedTaskIds: string[] } } };
    assert.equal(later.usage, undefined);
    assert.deepEqual(later.details.accounting.claimedTaskIds, []);
});
void test("submit returns immediately and preserves the running task and agent", async () => {
    const root = await subagentTestRoot("native-submit-inline-timeout-");
    const configPath = join(root, "subagent.json");
    await writeFile(configPath, JSON.stringify(config(root)));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(prepared.paths, { state: "idle", bridgeReady: true });
    const exec = async (_command: string, args: string[]): Promise<CommandResult> => {
        if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (args.includes("has-session")) return { stdout: "", stderr: "", code: 0 };
        if (args.includes("#{pane_id}\t#{pane_dead}")) return { stdout: "%2\t0\n", stderr: "", code: 0 };
        return { stdout: "", stderr: "", code: 0 };
    };
    let clock = 0;
    const tool = createSubagentSubmitTool({ configPath, env: {}, exec, now: () => clock, sleep: async () => { clock += 1000; } });
    const ctx = { sessionManager: { getSessionId: () => "origin", getSessionFile: () => undefined } } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;
    const response = await tool.execute("submit-timeout", { agentId: prepared.agentId, purpose: "background", prompt: "still work" }, undefined, undefined, ctx) as { content: Array<{ text: string }>; details: Record<string, unknown> };
    const content = JSON.parse(response.content[0]!.text) as { taskId: string; taskState: string; agentState: string };
    assert.ok(["created", "running"].includes(content.taskState));
    assert.equal(content.agentState, "busy");
    const surviving = await readAgentSnapshot(root, prepared.agentId, content.taskId);
    assert.equal(surviving.status.state, "busy");
    assert.equal(surviving.task?.status.state, content.taskState);
    assert.equal("waitOutcome" in response.details, false);
});
void test("task-targeted stop terminalizes created work without stopping the persistent agent", async () => {
    const root = await subagentTestRoot("native-task-stop-tool-");
    const configPath = join(root, "subagent.json");
    await writeFile(configPath, JSON.stringify(config(root)));
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    await patchAgentStatus(prepared.paths, { state: "idle", bridgeReady: true });
    const task = await createTask(root, prepared.agentId, "cancel", "stop this");
    const ctx = { sessionManager: { getSessionId: () => "origin", getSessionFile: () => undefined } } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;
    const result = await createSubagentStopTool({ configPath, env: {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }) }).execute("stop-task", { taskId: task.request.taskId }, undefined, undefined, ctx) as { details: AgentSnapshot };
    assert.equal(result.details.task?.status.state, "stopped");
    assert.equal(result.details.status.state, "idle");
});
