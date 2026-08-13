import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import performanceExtension, {
    formatCurrentPerformance,
    formatRecentPerformance,
    mergeIntervalDuration,
    parsePerformanceArguments,
    PerformanceCollector,
    PERFORMANCE_ENTRY,
    readMeshMetrics,
    summarizeRuns,
    type PerformanceResourceSnapshot,
} from "../extensions_src/performance.ts";

void test("performance collector retains current and overlapping tool timing", () => {
    let clock = 0; let wall = 0; const collector = new PerformanceCollector(() => clock, () => new Date(wall));
    collector.startRun(); clock = 5; collector.startRun(); collector.startTurn(0); clock = 10; collector.startTool("one", "read"); clock = 20; collector.startTool("two", "grep"); clock = 40; collector.endTool("one"); clock = 50; collector.endTool("two"); clock = 80; collector.endTurn(0); clock = 100; wall = 100;
    const run = collector.settle(); assert.ok(run); assert.deepEqual({ totalMs: run.totalMs, turnMs: run.turnMs, toolWallMs: run.toolWallMs, nonToolMs: run.nonToolMs, tools: run.tools }, { totalMs: 100, turnMs: 75, toolWallMs: 40, nonToolMs: 60, tools: { read: { count: 1, durationMs: 30 }, grep: { count: 1, durationMs: 30 } } });
    assert.equal(mergeIntervalDuration([{ startMs: 0, endMs: 10 }, { startMs: 5, endMs: 20 }, { startMs: 30, endMs: 35 }]), 25);
});

void test("performance entries reject incompatible records without exposing private payloads", () => {
    const valid = { schemaVersion: 1, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z", totalMs: 1000, turnCount: 1, turnMs: 900, tools: { bash: { count: 1, durationMs: 100 } }, toolWallMs: 100, nonToolMs: 900 };
    const summary = summarizeRuns([{ type: "custom", customType: PERFORMANCE_ENTRY, data: valid }, { type: "custom", customType: PERFORMANCE_ENTRY, data: { ...valid, schemaVersion: 0 } }, { type: "custom", customType: PERFORMANCE_ENTRY, data: "broken" }]);
    assert.equal(summary.runs.length, 1); assert.equal(summary.unread, 2);
    const serialized = JSON.stringify(summary.runs[0]);
    for (const privateField of ["prompt", "thinking", "args", "result", "command", "path"]) assert.doesNotMatch(serialized, new RegExp(`"${privateField}"`, "u"));
});

async function addMeshTask(stateRoot: string, input: { meshId: string; agentId: string; agent: string; taskId: string; start: string; finish?: string }): Promise<void> {
    const mesh = join(stateRoot, "meshes", input.meshId); const task = join(mesh, "tasks", input.taskId); const agent = join(mesh, "agents", input.agentId);
    await mkdir(task, { recursive: true }); await mkdir(agent, { recursive: true });
    await writeFile(join(agent, "agent.json"), JSON.stringify({ schemaVersion: 1, meshId: input.meshId, agentId: input.agentId, agent: input.agent }));
    await writeFile(join(task, "request.json"), JSON.stringify({ schemaVersion: 1, meshId: input.meshId, agentId: input.agentId, taskId: input.taskId, createdAt: input.start }));
    await writeFile(join(task, "status.json"), JSON.stringify({ schemaVersion: 1, meshId: input.meshId, agentId: input.agentId, taskId: input.taskId, state: input.finish ? "succeeded" : "running", startedAt: input.start, ...(input.finish ? { finishedAt: input.finish } : {}) }));
    if (input.finish) await writeFile(join(task, "result.json"), JSON.stringify({ schemaVersion: 1, meshId: input.meshId, agentId: input.agentId, taskId: input.taskId, outcome: "succeeded", startedAt: input.start, finishedAt: input.finish }));
}

void test("mesh metrics scope current tasks by mesh and aggregate recent tasks across meshes", async () => {
    const root = await mkdtemp(join(tmpdir(), "performance-state-")); const stateRoot = join(root, "state"); const configPath = join(root, "orchestration.json"); const now = Date.parse("2026-08-04T12:00:00.000Z");
    await writeFile(configPath, JSON.stringify({ schemaVersion: 7, stateRoot }));
    await addMeshTask(stateRoot, { meshId: "mesh-current", agentId: "agent-a", agent: "tester", taskId: "task-current", start: "2026-08-04T11:40:00.000Z" });
    await addMeshTask(stateRoot, { meshId: "mesh-current", agentId: "agent-a", agent: "tester", taskId: "task-prior", start: "2026-08-04T11:00:00.000Z", finish: "2026-08-04T11:05:00.000Z" });
    await addMeshTask(stateRoot, { meshId: "mesh-other", agentId: "agent-b", agent: "reviewer", taskId: "task-other", start: "2026-08-03T10:00:00.000Z", finish: "2026-08-03T10:20:00.000Z" });

    const current = await readMeshMetrics(configPath, { meshId: "mesh-current", nowMs: now });
    assert.deepEqual(current.tasks.map(task => ({ taskId: task.taskId, outcome: task.outcome, open: task.open, longRunning: task.longRunning, durationMs: task.durationMs })), [
        { taskId: "task-current", outcome: "running", open: true, longRunning: true, durationMs: 20 * 60 * 1000 },
        { taskId: "task-prior", outcome: "succeeded", open: false, longRunning: false, durationMs: 5 * 60 * 1000 },
    ]);

    const recent = await readMeshMetrics(configPath, { sinceMs: now - 2 * 86_400_000, nowMs: now });
    assert.deepEqual(recent.tasks.map(task => task.taskId), ["task-current", "task-other", "task-prior"]);
    const text = formatRecentPerformance(2, recent);
    assert.match(text, /tester/u);
    assert.match(text, /reviewer/u);
});

void test("mesh metrics report unavailable state and reject future open tasks", async () => {
    const root = await mkdtemp(join(tmpdir(), "performance-invalid-state-")); const stateRoot = join(root, "state"); const configPath = join(root, "orchestration.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: 7, stateRoot }));
    const missing = await readMeshMetrics(configPath); assert.deepEqual(missing.tasks, []); assert.equal(missing.unread, 1); assert.ok(missing.unavailable);
    await addMeshTask(stateRoot, { meshId: "mesh", agentId: "agent", agent: "tester", taskId: "future-task", start: "2026-08-04T12:01:00.000Z" });
    const nowMs = Date.parse("2026-08-04T12:00:00.000Z");
    const future = await readMeshMetrics(configPath, { meshId: "mesh", nowMs }); assert.deepEqual(future.tasks, []); assert.equal(future.unread, 1); assert.equal(future.unavailable, undefined);

    // Given valid and malformed persisted tasks in one mesh, the metrics consumer keeps the valid projection and counts each unread task.
    await addMeshTask(stateRoot, { meshId: "mesh", agentId: "agent", agent: "tester", taskId: "valid-task", start: "2026-08-04T11:00:00.000Z", finish: "2026-08-04T11:01:00.000Z" });
    const malformed = join(stateRoot, "meshes", "mesh", "tasks", "malformed-task");
    await mkdir(malformed, { recursive: true });
    await writeFile(join(malformed, "request.json"), "not-json");
    await writeFile(join(malformed, "status.json"), "{}");
    await addMeshTask(stateRoot, { meshId: "mesh", agentId: "agent", agent: "tester", taskId: "malformed-result", start: "2026-08-04T10:00:00.000Z", finish: "2026-08-04T10:01:00.000Z" });
    await writeFile(join(stateRoot, "meshes", "mesh", "tasks", "malformed-result", "result.json"), "not-json");
    const mixed = await readMeshMetrics(configPath, { meshId: "mesh", nowMs });
    assert.deepEqual(mixed.tasks.map(task => task.taskId), ["valid-task"]);
    assert.equal(mixed.unread, 3);

    await writeFile(configPath, "not-json"); const broken = await readMeshMetrics(configPath); assert.equal(broken.unread, 1); assert.ok(broken.unavailable);
});

void test("performance argument range is strict", () => {
    assert.deepEqual(parsePerformanceArguments(""), { mode: "current" }); assert.deepEqual(parsePerformanceArguments("recent"), { mode: "recent", days: 7 }); assert.deepEqual(parsePerformanceArguments("recent 90"), { mode: "recent", days: 90 });
    for (const value of ["recent 0", "recent 91", "recent 1.5", "other", "recent 2 extra"]) assert.throws(() => parsePerformanceArguments(value));
});

void test("current formatter exposes task timing without private identifiers", () => {
    const resources: PerformanceResourceSnapshot = { cpuCount: 6, loadAverage: [1, 2, 3], memoryTotalBytes: 8 * 1024 ** 3, memoryFreeBytes: 4 * 1024 ** 3, swap: "0 used", diskFreeBytes: 20 * 1024 ** 3 };
    const text = formatCurrentPerformance([], { unread: 2, tasks: [{ meshId: "mesh-secret", agentId: "agent-secret", taskId: "12345678-private", agentType: "tester", outcome: "running", startedAt: "2026-01-01T00:00:00Z", durationMs: 700000, open: true, longRunning: true }] }, resources);
    assert.match(text, /tester.*running/u); assert.doesNotMatch(text, /mesh-secret|agent-secret|purpose|prompt|private/iu);
});

void test("slash command and palette use PI_MESH_ID for the same current handler", async () => {
    const root = await mkdtemp(join(tmpdir(), "performance-extension-")); const stateRoot = join(root, "state"); const configPath = join(root, "orchestration.json"); await writeFile(configPath, JSON.stringify({ schemaVersion: 7, stateRoot }));
    await addMeshTask(stateRoot, { meshId: "mesh-current", agentId: "agent-a", agent: "tester", taskId: "aaaaaaaa-current", start: "2000-01-01T00:00:00.000Z" });
    await addMeshTask(stateRoot, { meshId: "mesh-other", agentId: "agent-b", agent: "reviewer", taskId: "bbbbbbbb-other", start: "2000-01-01T00:00:00.000Z" });
    const handlers = new Map<string, (...args: any[]) => unknown>(); const listeners = new Map<string, Array<(value: any) => void>>(); let contribution: { run: (ctx: ExtensionContext) => Promise<void> } | undefined; const notifications: string[] = [];
    const pi = { on(name: string, handler: (...args: any[]) => unknown) { handlers.set(name, handler); }, appendEntry() {}, registerCommand(name: string, value: { handler: (...args: any[]) => unknown }) { assert.equal(name, "performance"); handlers.set("command", value.handler); }, events: { on(name: string, handler: (value: any) => void) { listeners.set(name, [...(listeners.get(name) ?? []), handler]); return () => {}; }, emit(name: string, value: any) { if (name === "command-palette:register") contribution = value; for (const listener of listeners.get(name) ?? []) listener(value); } } } as unknown as ExtensionAPI;
    performanceExtension(pi, { configPath, env: { PI_MESH_ID: "mesh-current" } }); assert.ok(contribution);
    const ctx = { cwd: process.cwd(), sessionManager: { getEntries: () => [] }, ui: { notify: (text: string) => notifications.push(text) } } as unknown as ExtensionContext;
    await handlers.get("command")!("", ctx); await contribution!.run(ctx); assert.equal(notifications.length, 2);
    for (const message of notifications) { assert.match(message, /aaaaaaaa/u); assert.doesNotMatch(message, /bbbbbbbb/iu); }
});
