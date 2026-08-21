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
    PERFORMANCE_SCHEMA_VERSION,
    parsePerformanceRun,
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

void test("performance schema v2 separates quota metadata and reads v1 entries", () => {
    const legacy = { schemaVersion: 1, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z", totalMs: 1000, turnCount: 1, turnMs: 900, tools: { bash: { count: 1, durationMs: 100 } }, toolWallMs: 100, nonToolMs: 900 };
    let clock = 0; const collector = new PerformanceCollector(() => clock, () => new Date(clock)); collector.startRun();
    collector.recordMessage({ role: "assistant", content: "private prompt", usage: { input: 10, output: 2, cacheRead: 4, cacheWrite: 1, totalTokens: 17, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } } });
    collector.recordMessage({ role: "toolResult", toolCallId: "private-task-id", toolName: "mesh_get", content: "https://private.example/path", usage: { input: 20, output: 3, cacheRead: 5, cacheWrite: 0, totalTokens: 28, cost: { input: 2, output: 3, cacheRead: 4, cacheWrite: 0, total: 9 } } });
    collector.observeContext({ tokens: 100_000, contextWindow: 192_000 }); collector.recordProviderRequest(); collector.recordProviderResponse(429);
    collector.recordCompaction({ reason: "threshold", willRetry: false, tokensBefore: 176_000, usage: { input: 30, output: 4, cacheRead: 6, cacheWrite: 0, totalTokens: 40, cost: { input: 3, output: 4, cacheRead: 5, cacheWrite: 0, total: 12 } } });
    clock = 100; const current = collector.settle(); assert.ok(current); assert.equal(current.schemaVersion, PERFORMANCE_SCHEMA_VERSION);
    assert.deepEqual(current.assistantUsage, { availability: "available", value: { input: 10, output: 2, cacheRead: 4, cacheWrite: 1, totalTokens: 17, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } } });
    assert.equal(current.nestedToolUsage.availability, "available"); assert.equal(current.compactionUsage[0]?.tokensBefore, 176_000); assert.deepEqual(current.context, { peakTokens: 100_000, contextWindow: 192_000, compactionThreshold: 175_616 }); assert.equal(current.providerRequests.statusCategories?.rateLimited, 1);
    const summary = summarizeRuns([{ type: "custom", customType: PERFORMANCE_ENTRY, data: legacy }, { type: "custom", customType: PERFORMANCE_ENTRY, data: { ...current, prompt: "discard me", sessionId: "discard me" } }, { type: "custom", customType: PERFORMANCE_ENTRY, data: { ...legacy, schemaVersion: 0 } }]);
    assert.deepEqual(summary.runs.map(run => run.schemaVersion), [1, 2]); assert.equal(summary.unread, 1);
    const serialized = JSON.stringify(summary.runs[1]);
    for (const privateValue of ["private prompt", "private-task-id", "https://private.example/path", "discard me"]) assert.doesNotMatch(serialized, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    const partial = { ...current, assistantUsage: { availability: "unavailable" } as const, nestedToolUsage: { availability: "unavailable" } as const, compactionUsage: [{ reason: "manual" as const, willRetry: false, tokensBefore: 120_000, usage: { availability: "unavailable" as const } }], providerRequests: { beforeCount: 1, afterCount: 0, statusAvailability: "unavailable" as const } };
    const formatted = formatCurrentPerformance([...summary.runs, partial], { tasks: [], unread: 0 }, { cpuCount: 1, loadAverage: [0, 0, 0], memoryTotalBytes: 1, memoryFreeBytes: 1, swap: "unavailable", diskFreeBytes: "unavailable" });
    assert.match(formatted, /Assistant usage:.*cache ratio 28\.6%.*\(1 unavailable\)/u); assert.match(formatted, /Nested tool usage:.*\(1 unavailable\)/u); assert.match(formatted, /Compactions:.*\(1 unavailable\)/u); assert.match(formatted, /statuses .*429 1/u);
});

void test("v2 parser preserves unavailable provider and usage observations instead of zero", () => {
    const collector = new PerformanceCollector(() => 0, () => new Date(0)); collector.startRun(); collector.recordProviderRequest(); const run = collector.settle(); assert.ok(run);
    const parsed = parsePerformanceRun(run); assert.ok(parsed && parsed.schemaVersion === 2); assert.deepEqual(parsed.assistantUsage, { availability: "unavailable" }); assert.deepEqual(parsed.nestedToolUsage, { availability: "unavailable" }); assert.equal(parsed.providerRequests.beforeCount, 1); assert.equal(parsed.providerRequests.afterCount, 0); assert.equal(parsed.providerRequests.statusAvailability, "unavailable");
});

void test("out-of-run compaction is persisted as its own session aggregate", () => {
    const handlers = new Map<string, (event: any, ctx?: any) => unknown>(); const appended: Array<{ customType: string; data: unknown }> = [];
    const pi = { on(name: string, handler: (event: any, ctx?: any) => unknown) { handlers.set(name, handler); }, appendEntry(customType: string, data: unknown) { appended.push({ customType, data }); }, registerCommand() {}, events: { on() { return () => {}; }, emit() {} } } as unknown as ExtensionAPI;
    performanceExtension(pi, { clock: () => 10, wallClock: () => new Date(10) });
    handlers.get("session_compact")!({ reason: "manual", willRetry: false, compactionEntry: { tokensBefore: 50_000, usage: { input: 4, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 } } } });
    assert.equal(appended.length, 1); assert.equal(appended[0]?.customType, PERFORMANCE_ENTRY); const run = parsePerformanceRun(appended[0]?.data); assert.ok(run && run.schemaVersion === 2); assert.equal(run.compactionUsage[0]?.reason, "manual"); assert.equal(run.compactionUsage[0]?.usage.availability, "available");
});

const meshCurrent = "11111111-1111-4111-8111-111111111111";
const meshOther = "22222222-2222-4222-8222-222222222222";
const meshInvalid = "33333333-3333-4333-8333-333333333333";
const agentA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const agentB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const taskCurrent = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const taskPrior = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const taskOther = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

async function addMeshTask(stateRoot: string, input: { meshId: string; agentId: string; agent: string; taskId: string; start: string; finish?: string; usageCapability?: boolean }): Promise<void> {
    const mesh = join(stateRoot, "meshes", input.meshId); const task = join(mesh, "tasks", input.taskId); const agent = join(mesh, "agents", input.agentId);
    await mkdir(task, { recursive: true }); await mkdir(agent, { recursive: true });
    await writeFile(join(agent, "agent.json"), JSON.stringify({ schemaVersion: 4, meshId: input.meshId, agentId: input.agentId, role: input.agent, capabilities: { usage: input.usageCapability ?? true } }));
    await writeFile(join(agent, "events.jsonl"), "");
    await writeFile(join(task, "request.json"), JSON.stringify({ schemaVersion: 3, meshId: input.meshId, agentId: input.agentId, taskId: input.taskId, prompt: "measure this task", requesterEndpointId: `root:${input.meshId}`, createdAt: input.start }));
    await writeFile(join(task, "status.json"), JSON.stringify({ schemaVersion: 1, meshId: input.meshId, agentId: input.agentId, taskId: input.taskId, state: input.finish ? "succeeded" : "running", createdAt: input.start, startedAt: input.start, ...(input.finish ? { finishedAt: input.finish } : {}) }));
    if (input.finish) await writeFile(join(task, "result.json"), JSON.stringify({ schemaVersion: 1, meshId: input.meshId, agentId: input.agentId, taskId: input.taskId, outcome: "succeeded", output: "", usage: { input: 7, output: 2, cacheRead: 3, cacheWrite: 0, totalTokens: 12, cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 0, total: 3 } }, turns: 2, interventions: [], startedAt: input.start, finishedAt: input.finish }));
}

void test("mesh metrics scope current tasks by mesh and aggregate recent tasks across meshes", async () => {
    const root = await mkdtemp(join(tmpdir(), "performance-state-")); const stateRoot = join(root, "state"); const configPath = join(root, "orchestration.json"); const now = Date.parse("2026-08-04T12:00:00.000Z");
    await writeFile(configPath, JSON.stringify({ schemaVersion: 7, stateRoot }));
    await addMeshTask(stateRoot, { meshId: meshCurrent, agentId: agentA, agent: "tester", taskId: taskCurrent, start: "2026-08-04T11:40:00.000Z" });
    await addMeshTask(stateRoot, { meshId: meshCurrent, agentId: agentA, agent: "tester", taskId: taskPrior, start: "2026-08-04T11:00:00.000Z", finish: "2026-08-04T11:05:00.000Z" });
    await addMeshTask(stateRoot, { meshId: meshOther, agentId: agentB, agent: "reviewer", taskId: taskOther, start: "2026-08-03T10:00:00.000Z", finish: "2026-08-03T10:20:00.000Z", usageCapability: false });

    const current = await readMeshMetrics(configPath, { meshId: meshCurrent, nowMs: now });
    assert.deepEqual(current.tasks.map(task => ({ taskId: task.taskId, outcome: task.outcome, open: task.open, longRunning: task.longRunning, durationMs: task.durationMs })), [
        { taskId: taskCurrent, outcome: "running", open: true, longRunning: true, durationMs: 20 * 60 * 1000 },
        { taskId: taskPrior, outcome: "succeeded", open: false, longRunning: false, durationMs: 5 * 60 * 1000 },
    ]);

    const recent = await readMeshMetrics(configPath, { sinceMs: now - 2 * 86_400_000, nowMs: now });
    assert.deepEqual(recent.tasks.map(task => task.taskId), [taskCurrent, taskOther, taskPrior]);
    assert.equal(recent.tasks.find(task => task.taskId === taskPrior)?.usage.availability, "available");
    assert.equal(recent.tasks.find(task => task.taskId === taskOther)?.usage.availability, "unavailable");
    assert.equal(recent.tasks.find(task => task.taskId === taskOther)?.turns, "unavailable");
    const text = formatRecentPerformance(2, recent);
    assert.match(text, /tester.*cache ratio 30\.0%/u);
    assert.match(text, /reviewer.*turns unavailable.*usage unavailable/u);
});

void test("mesh metrics report unavailable state and reject future open tasks", async () => {
    const root = await mkdtemp(join(tmpdir(), "performance-invalid-state-")); const stateRoot = join(root, "state"); const configPath = join(root, "orchestration.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: 7, stateRoot }));
    const missing = await readMeshMetrics(configPath); assert.deepEqual(missing.tasks, []); assert.equal(missing.unread, 1); assert.ok(missing.unavailable);
    await addMeshTask(stateRoot, { meshId: meshInvalid, agentId: agentA, agent: "tester", taskId: "44444444-4444-4444-8444-444444444444", start: "2026-08-04T12:01:00.000Z" });
    const nowMs = Date.parse("2026-08-04T12:00:00.000Z");
    const future = await readMeshMetrics(configPath, { meshId: meshInvalid, nowMs }); assert.deepEqual(future.tasks, []); assert.equal(future.unread, 1); assert.equal(future.unavailable, undefined);

    // Given valid and malformed persisted tasks in one mesh, the metrics consumer keeps the valid projection and counts each unread task.
    await addMeshTask(stateRoot, { meshId: meshInvalid, agentId: agentA, agent: "tester", taskId: "55555555-5555-4555-8555-555555555555", start: "2026-08-04T11:00:00.000Z", finish: "2026-08-04T11:01:00.000Z" });
    const malformed = join(stateRoot, "meshes", meshInvalid, "tasks", "66666666-6666-4666-8666-666666666666");
    await mkdir(malformed, { recursive: true });
    await writeFile(join(malformed, "request.json"), "not-json");
    await writeFile(join(malformed, "status.json"), "{}");
    await addMeshTask(stateRoot, { meshId: meshInvalid, agentId: agentA, agent: "tester", taskId: "77777777-7777-4777-8777-777777777777", start: "2026-08-04T10:00:00.000Z", finish: "2026-08-04T10:01:00.000Z" });
    await writeFile(join(stateRoot, "meshes", meshInvalid, "tasks", "77777777-7777-4777-8777-777777777777", "result.json"), "not-json");
    await addMeshTask(stateRoot, { meshId: meshInvalid, agentId: agentA, agent: "tester", taskId: "88888888-8888-4888-8888-888888888888", start: "2026-08-04T09:00:00.000Z", finish: "2026-08-04T09:01:00.000Z" });
    const legacyRequest = join(stateRoot, "meshes", meshInvalid, "tasks", "88888888-8888-4888-8888-888888888888", "request.json");
    await writeFile(legacyRequest, JSON.stringify({ schemaVersion: 1, meshId: meshInvalid, agentId: agentA, taskId: "88888888-8888-4888-8888-888888888888", createdAt: "2026-08-04T09:00:00.000Z" }));
    const mixed = await readMeshMetrics(configPath, { meshId: meshInvalid, nowMs });
    assert.deepEqual(mixed.tasks.map(task => task.taskId), ["55555555-5555-4555-8555-555555555555"]);
    assert.equal(mixed.unread, 4);

    await writeFile(configPath, "not-json"); const broken = await readMeshMetrics(configPath); assert.equal(broken.unread, 1); assert.ok(broken.unavailable);
});

void test("performance argument range is strict", () => {
    assert.deepEqual(parsePerformanceArguments(""), { mode: "current" }); assert.deepEqual(parsePerformanceArguments("recent"), { mode: "recent", days: 7 }); assert.deepEqual(parsePerformanceArguments("recent 90"), { mode: "recent", days: 90 });
    for (const value of ["recent 0", "recent 91", "recent 1.5", "other", "recent 2 extra"]) assert.throws(() => parsePerformanceArguments(value));
});

void test("current formatter exposes task timing without private identifiers", () => {
    const resources: PerformanceResourceSnapshot = { cpuCount: 6, loadAverage: [1, 2, 3], memoryTotalBytes: 8 * 1024 ** 3, memoryFreeBytes: 4 * 1024 ** 3, swap: "0 used", diskFreeBytes: 20 * 1024 ** 3 };
    const text = formatCurrentPerformance([], { unread: 2, tasks: [{ meshId: "mesh-secret", agentId: "agent-secret", taskId: "12345678-private", agentType: "tester", outcome: "running", startedAt: "2026-01-01T00:00:00Z", durationMs: 700000, open: true, turns: "unavailable", usage: { availability: "unavailable" }, longRunning: true }] }, resources);
    assert.match(text, /tester.*running/u); assert.match(text, /usage unavailable/u); assert.doesNotMatch(text, /mesh-secret|agent-secret|purpose|prompt|private/iu);
});

void test("slash command and palette use PI_MESH_ID for the same current handler", async () => {
    const root = await mkdtemp(join(tmpdir(), "performance-extension-")); const stateRoot = join(root, "state"); const configPath = join(root, "orchestration.json"); await writeFile(configPath, JSON.stringify({ schemaVersion: 7, stateRoot }));
    await addMeshTask(stateRoot, { meshId: meshCurrent, agentId: agentA, agent: "tester", taskId: taskCurrent, start: "2000-01-01T00:00:00.000Z" });
    await addMeshTask(stateRoot, { meshId: meshOther, agentId: agentB, agent: "reviewer", taskId: taskOther, start: "2000-01-01T00:00:00.000Z" });
    const handlers = new Map<string, (...args: any[]) => unknown>(); const listeners = new Map<string, Array<(value: any) => void>>(); let contribution: { run: (ctx: ExtensionContext) => Promise<void> } | undefined; const notifications: string[] = [];
    const pi = { on(name: string, handler: (...args: any[]) => unknown) { handlers.set(name, handler); }, appendEntry() {}, registerCommand(name: string, value: { handler: (...args: any[]) => unknown }) { assert.equal(name, "performance"); handlers.set("command", value.handler); }, events: { on(name: string, handler: (value: any) => void) { listeners.set(name, [...(listeners.get(name) ?? []), handler]); return () => {}; }, emit(name: string, value: any) { if (name === "command-palette:register") contribution = value; for (const listener of listeners.get(name) ?? []) listener(value); } } } as unknown as ExtensionAPI;
    performanceExtension(pi, { configPath, env: { PI_MESH_ID: meshCurrent } }); assert.ok(contribution);
    const ctx = { cwd: process.cwd(), sessionManager: { getEntries: () => [] }, ui: { notify: (text: string) => notifications.push(text) } } as unknown as ExtensionContext;
    await handlers.get("command")!("", ctx); await contribution!.run(ctx); assert.equal(notifications.length, 2);
    for (const message of notifications) { assert.match(message, /cccccccc/u); assert.doesNotMatch(message, /eeeeeeee/iu); }
});
