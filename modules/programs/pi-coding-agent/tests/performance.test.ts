import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import performanceExtension, { formatCurrentPerformance, formatRecentPerformance, mergeIntervalDuration, parsePerformanceArguments, PerformanceCollector, PERFORMANCE_ENTRY, readSubagentMetrics, summarizeRuns, type PerformanceResourceSnapshot } from "../extensions_src/performance.ts";

void test("performance collector merges parallel tool intervals and computes non-tool time", () => {
    let clock = 0; let wall = 0; const collector = new PerformanceCollector(() => clock, () => new Date(wall));
    collector.startRun(); clock = 5; collector.startRun(); collector.startTurn(0); clock = 10; collector.startTool("one", "read"); clock = 20; collector.startTool("two", "grep"); clock = 40; collector.endTool("one"); clock = 50; collector.endTool("two"); clock = 80; collector.endTurn(0); clock = 100; wall = 100;
    const run = collector.settle(); assert.ok(run); assert.equal(run.totalMs, 100); assert.equal(run.turnMs, 75); assert.equal(run.toolWallMs, 40); assert.equal(run.nonToolMs, 60); assert.deepEqual(run.tools, { read: { count: 1, durationMs: 30 }, grep: { count: 1, durationMs: 30 } });
    assert.equal(mergeIntervalDuration([{ startMs: 0, endMs: 10 }, { startMs: 5, endMs: 20 }, { startMs: 30, endMs: 35 }]), 25);
});

void test("performance entries reject old or corrupt schemas and contain no private payload fields", () => {
    const valid = { schemaVersion: 1, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z", totalMs: 1000, turnCount: 1, turnMs: 900, tools: { bash: { count: 1, durationMs: 100 } }, toolWallMs: 100, nonToolMs: 900 };
    const summary = summarizeRuns([{ type: "custom", customType: PERFORMANCE_ENTRY, data: valid }, { type: "custom", customType: PERFORMANCE_ENTRY, data: { ...valid, schemaVersion: 0 } }, { type: "custom", customType: PERFORMANCE_ENTRY, data: "broken" }]);
    assert.equal(summary.runs.length, 1); assert.equal(summary.unread, 2);
    const serialized = JSON.stringify(summary.runs[0]);
    for (const privateField of ["prompt", "thinking", "args", "result", "command", "path"]) assert.doesNotMatch(serialized, new RegExp(`"${privateField}"`, "u"));
});

void test("subagent metrics filter origin and recent period, calculate open age, and tolerate corrupt state", async () => {
    const root = await mkdtemp(join(tmpdir(), "performance-state-")); const stateRoot = join(root, "state"); const configPath = join(root, "subagent.json"); const now = Date.parse("2026-08-04T12:00:00.000Z");
    await writeFile(configPath, JSON.stringify({ schemaVersion: 7, stateRoot }));
    const add = async (agentId: string, origin: string, profile: string, taskId: string, start: string, finish?: string) => { const agent = join(stateRoot, "agents", agentId); const task = join(agent, "tasks", taskId); await mkdir(task, { recursive: true }); await writeFile(join(agent, "agent.json"), JSON.stringify({ profile, originSessionId: origin })); await writeFile(join(task, "request.json"), JSON.stringify({ taskId, createdAt: start })); await writeFile(join(task, "status.json"), JSON.stringify({ state: finish ? "succeeded" : "running", startedAt: start, ...(finish ? { finishedAt: finish } : {}) })); if (finish) await writeFile(join(task, "result.json"), JSON.stringify({ outcome: "succeeded", startedAt: start, finishedAt: finish })); };
    await add("agent-a", "current", "tester", "task-current", "2026-08-04T11:40:00.000Z"); await add("agent-b", "other", "reviewer", "task-other", "2026-08-03T10:00:00.000Z", "2026-08-03T10:20:00.000Z");
    const current = await readSubagentMetrics(configPath, { originSessionId: "current", nowMs: now }); assert.equal(current.tasks.length, 1); assert.equal(current.tasks[0]?.open, true); assert.equal(current.tasks[0]?.longRunning, true); assert.equal(current.tasks[0]?.durationMs, 20 * 60 * 1000);
    const recent = await readSubagentMetrics(configPath, { sinceMs: now - 2 * 86_400_000, nowMs: now }); assert.equal(recent.tasks.length, 2); assert.match(formatRecentPerformance(2, recent), /median.*p90.*tester.*reviewer.*long-running/su);
    await writeFile(configPath, "not-json"); const broken = await readSubagentMetrics(configPath); assert.equal(broken.unread, 1); assert.ok(broken.unavailable);
});

void test("subagent metrics surface a missing agents state root instead of empty success", async () => {
    const root = await mkdtemp(join(tmpdir(), "performance-missing-state-")); const configPath = join(root, "subagent.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: 7, stateRoot: join(root, "missing") }));
    const metrics = await readSubagentMetrics(configPath);
    assert.deepEqual(metrics.tasks, []); assert.equal(metrics.unread, 1); assert.equal(metrics.unavailable, "subagent agents state unavailable"); assert.match(formatRecentPerformance(7, metrics), /unread: 1; unavailable: subagent agents state unavailable/u);
});

void test("subagent metrics exclude and count an open task with a future start", async () => {
    const root = await mkdtemp(join(tmpdir(), "performance-future-task-")); const stateRoot = join(root, "state"); const configPath = join(root, "subagent.json"); const task = join(stateRoot, "agents", "agent", "tasks", "task");
    await mkdir(task, { recursive: true }); await writeFile(configPath, JSON.stringify({ schemaVersion: 7, stateRoot }));
    await writeFile(join(stateRoot, "agents", "agent", "agent.json"), JSON.stringify({ profile: "tester", originSessionId: "origin" }));
    await writeFile(join(task, "request.json"), JSON.stringify({ taskId: "future-task", createdAt: "2026-08-04T12:01:00.000Z" })); await writeFile(join(task, "status.json"), JSON.stringify({ state: "running", startedAt: "2026-08-04T12:01:00.000Z" }));
    const metrics = await readSubagentMetrics(configPath, { nowMs: Date.parse("2026-08-04T12:00:00.000Z") });
    assert.deepEqual(metrics.tasks, []); assert.equal(metrics.unread, 1); assert.equal(metrics.unavailable, undefined);
});

void test("performance argument range is strict", () => {
    assert.deepEqual(parsePerformanceArguments(""), { mode: "current" }); assert.deepEqual(parsePerformanceArguments("recent"), { mode: "recent", days: 7 }); assert.deepEqual(parsePerformanceArguments("recent 90"), { mode: "recent", days: 90 });
    for (const value of ["recent 0", "recent 91", "recent 1.5", "other", "recent 2 extra"]) assert.throws(() => parsePerformanceArguments(value));
});

void test("current formatter labels non-tool and limits task display to safe fields", () => {
    const resources: PerformanceResourceSnapshot = { cpuCount: 6, loadAverage: [1, 2, 3], memoryTotalBytes: 8 * 1024 ** 3, memoryFreeBytes: 4 * 1024 ** 3, swap: "0 used", diskFreeBytes: 20 * 1024 ** 3 };
    const text = formatCurrentPerformance([], { unread: 2, tasks: [{ agentId: "agent-secret", taskId: "12345678-private", profile: "tester", outcome: "running", startedAt: "2026-01-01T00:00:00Z", durationMs: 700000, open: true, longRunning: true }] }, resources);
    assert.match(text, /non-tool/u); assert.match(text, /tester running.*12345678.*long-running.*open/u); assert.doesNotMatch(text, /agent-secret|purpose|prompt|private/u);
});

void test("slash command and command palette contribution invoke the same performance handler", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>(); const listeners = new Map<string, Array<(value: any) => void>>(); let contribution: { run: (ctx: ExtensionContext) => Promise<void> } | undefined; const notifications: string[] = [];
    const pi = { on(name: string, handler: (...args: any[]) => unknown) { handlers.set(name, handler); }, appendEntry() {}, registerCommand(name: string, value: { handler: (...args: any[]) => unknown }) { assert.equal(name, "performance"); handlers.set("command", value.handler); }, events: { on(name: string, handler: (value: any) => void) { listeners.set(name, [...(listeners.get(name) ?? []), handler]); return () => {}; }, emit(name: string, value: any) { if (name === "command-palette:register") contribution = value; for (const listener of listeners.get(name) ?? []) listener(value); } } } as unknown as ExtensionAPI;
    const configPath = join(await mkdtemp(join(tmpdir(), "performance-extension-")), "missing.json"); performanceExtension(pi, { configPath }); assert.ok(contribution);
    const ctx = { cwd: process.cwd(), sessionManager: { getEntries: () => [], getSessionId: () => "origin" }, ui: { notify: (text: string) => notifications.push(text) } } as unknown as ExtensionContext;
    await handlers.get("command")!("", ctx); await contribution!.run(ctx); assert.equal(notifications.length, 2);
    for (const message of notifications) {
        assert.match(message, /current session/i);
        assert.match(message, /settled runs[^0-9]*0/i);
    }
});
