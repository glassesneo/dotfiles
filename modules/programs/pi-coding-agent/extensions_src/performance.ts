import { execFile } from "node:child_process";
import { readFile, readdir, statfs } from "node:fs/promises";
import { cpus, freemem, loadavg, platform, totalmem } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { provideCommandPaletteContribution } from "./utilities/command_palette_contributions.ts";

export const PERFORMANCE_ENTRY = "pi-performance-run";
export const PERFORMANCE_SCHEMA_VERSION = 1;
export const LONG_RUNNING_MS = 10 * 60 * 1000;

interface Interval { startMs: number; endMs: number }
export interface ToolAggregate { count: number; durationMs: number }
export interface PerformanceRun {
    schemaVersion: 1;
    startedAt: string;
    finishedAt: string;
    totalMs: number;
    turnCount: number;
    turnMs: number;
    tools: Record<string, ToolAggregate>;
    toolWallMs: number;
    nonToolMs: number;
}
export interface PerformanceResourceSnapshot {
    cpuCount: number;
    loadAverage: number[];
    memoryTotalBytes: number;
    memoryFreeBytes: number;
    swap: string;
    diskFreeBytes: number | "unavailable";
}
export interface MeshTaskMetric {
    meshId: string;
    agentId: string;
    taskId: string;
    agentType: string;
    outcome: string;
    startedAt: string;
    finishedAt?: string;
    durationMs: number;
    open: boolean;
    longRunning: boolean;
}
export interface MeshMetrics { tasks: MeshTaskMetric[]; unread: number; unavailable?: string }

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function object(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function isoMs(value: unknown): number | undefined { if (typeof value !== "string") return undefined; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : undefined; }
function shortId(id: string): string { return id.slice(0, 8); }
function duration(value: number): string {
    if (value < 1000) return `${Math.round(value)}ms`;
    const seconds = value / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = seconds / 60;
    if (minutes < 60) return `${minutes.toFixed(1)}m`;
    return `${(minutes / 60).toFixed(1)}h`;
}
function bytes(value: number): string { const gib = value / (1024 ** 3); return `${gib.toFixed(1)} GiB`; }

export function mergeIntervalDuration(intervals: readonly Interval[]): number {
    const sorted = intervals.filter(item => finite(item.startMs) && finite(item.endMs) && item.endMs >= item.startMs).toSorted((a, b) => a.startMs - b.startMs);
    let total = 0; let start: number | undefined; let end: number | undefined;
    for (const item of sorted) {
        if (start === undefined || end === undefined) { start = item.startMs; end = item.endMs; continue; }
        if (item.startMs <= end) end = Math.max(end, item.endMs);
        else { total += end - start; start = item.startMs; end = item.endMs; }
    }
    return total + (start === undefined || end === undefined ? 0 : end - start);
}

export class PerformanceCollector {
    readonly #clock: () => number;
    readonly #wallClock: () => Date;
    #startedAtMs = 0;
    #startedAt = "";
    #turnStarts = new Map<number, number>();
    #turnCount = 0;
    #turnMs = 0;
    #toolStarts = new Map<string, { name: string; startMs: number }>();
    #tools = new Map<string, ToolAggregate>();
    #toolIntervals: Interval[] = [];
    constructor(clock: () => number = () => performance.now(), wallClock: () => Date = () => new Date()) { this.#clock = clock; this.#wallClock = wallClock; }
    startRun(): void { if (this.#startedAt) return; this.#startedAtMs = this.#clock(); this.#startedAt = this.#wallClock().toISOString(); this.#turnStarts.clear(); this.#turnCount = 0; this.#turnMs = 0; this.#toolStarts.clear(); this.#tools.clear(); this.#toolIntervals = []; }
    startTurn(index: number): void { this.#turnStarts.set(index, this.#clock()); this.#turnCount += 1; }
    endTurn(index: number): void { const start = this.#turnStarts.get(index); if (start !== undefined) this.#turnMs += Math.max(0, this.#clock() - start); this.#turnStarts.delete(index); }
    startTool(id: string, name: string): void { this.#toolStarts.set(id, { name, startMs: this.#clock() }); }
    endTool(id: string): void { const start = this.#toolStarts.get(id); if (!start) return; const endMs = this.#clock(); const elapsed = Math.max(0, endMs - start.startMs); const aggregate = this.#tools.get(start.name) ?? { count: 0, durationMs: 0 }; aggregate.count += 1; aggregate.durationMs += elapsed; this.#tools.set(start.name, aggregate); this.#toolIntervals.push({ startMs: start.startMs, endMs }); this.#toolStarts.delete(id); }
    settle(): PerformanceRun | undefined {
        if (!this.#startedAt) return undefined;
        const endMs = this.#clock(); const totalMs = Math.max(0, endMs - this.#startedAtMs); const toolWallMs = mergeIntervalDuration(this.#toolIntervals);
        const run: PerformanceRun = { schemaVersion: 1, startedAt: this.#startedAt, finishedAt: this.#wallClock().toISOString(), totalMs, turnCount: this.#turnCount, turnMs: this.#turnMs, tools: Object.fromEntries(this.#tools), toolWallMs, nonToolMs: Math.max(0, totalMs - toolWallMs) };
        this.#startedAt = "";
        return run;
    }
}

export function parsePerformanceRun(value: unknown): PerformanceRun | undefined {
    const root = object(value); if (!root || root.schemaVersion !== PERFORMANCE_SCHEMA_VERSION || typeof root.startedAt !== "string" || typeof root.finishedAt !== "string") return undefined;
    if (![root.totalMs, root.turnCount, root.turnMs, root.toolWallMs, root.nonToolMs].every(finite)) return undefined;
    const rawTools = object(root.tools); if (!rawTools) return undefined; const tools: Record<string, ToolAggregate> = {};
    for (const [name, raw] of Object.entries(rawTools)) { const entry = object(raw); if (!entry || !finite(entry.count) || !finite(entry.durationMs)) return undefined; tools[name] = { count: entry.count, durationMs: entry.durationMs }; }
    return { schemaVersion: 1, startedAt: root.startedAt, finishedAt: root.finishedAt, totalMs: root.totalMs as number, turnCount: root.turnCount as number, turnMs: root.turnMs as number, tools, toolWallMs: root.toolWallMs as number, nonToolMs: root.nonToolMs as number };
}

export function summarizeRuns(entries: readonly unknown[]): { runs: PerformanceRun[]; unread: number } {
    const candidates = entries.flatMap(entry => { const item = object(entry); return item?.type === "custom" && item.customType === PERFORMANCE_ENTRY ? [item.data] : []; });
    const runs = candidates.flatMap(value => { const parsed = parsePerformanceRun(value); return parsed ? [parsed] : []; });
    return { runs, unread: candidates.length - runs.length };
}

async function swapSnapshot(): Promise<string> {
    try {
        if (platform() === "linux") {
            const text = await readFile("/proc/meminfo", "utf8"); const total = /SwapTotal:\s+(\d+)/u.exec(text); const free = /SwapFree:\s+(\d+)/u.exec(text);
            if (total?.[1] && free?.[1]) return `${bytes((Number(total[1]) - Number(free[1])) * 1024)} used / ${bytes(Number(total[1]) * 1024)}`;
        }
        if (platform() === "darwin") return (await promisify(execFile)("sysctl", ["-n", "vm.swapusage"], { timeout: 2000 })).stdout.trim();
    } catch { /* best effort */ }
    return "unavailable";
}
export async function resourceSnapshot(cwd: string): Promise<PerformanceResourceSnapshot> {
    const diskFreeBytes = await statfs(cwd).then(value => value.bavail * value.bsize).catch(() => "unavailable" as const);
    return { cpuCount: cpus().length, loadAverage: loadavg(), memoryTotalBytes: totalmem(), memoryFreeBytes: freemem(), swap: await swapSnapshot(), diskFreeBytes };
}

async function json(path: string): Promise<unknown> { return JSON.parse(await readFile(path, "utf8")); }
export async function readMeshMetrics(configPath: string, options: { meshId?: string; sinceMs?: number; nowMs?: number } = {}): Promise<MeshMetrics> {
    const nowMs = options.nowMs ?? Date.now(); let unread = 0;
    let config: Record<string, unknown> | undefined;
    try { config = object(await json(configPath)); } catch { return { tasks: [], unread: 1, unavailable: "mesh config unavailable" }; }
    if (typeof config?.stateRoot !== "string") return { tasks: [], unread: 1, unavailable: "mesh stateRoot unavailable" };
    const meshesRoot = join(config.stateRoot, "meshes");
    let meshIds: string[];
    if (options.meshId) meshIds = [options.meshId];
    else {
        try { meshIds = await readdir(meshesRoot); }
        catch { return { tasks: [], unread: 1, unavailable: "mesh state unavailable" }; }
    }
    const tasks: MeshTaskMetric[] = [];
    for (const meshId of meshIds) {
        const meshRoot = join(meshesRoot, meshId);
        let taskIds: string[];
        try { taskIds = await readdir(join(meshRoot, "tasks")); }
        catch {
            if (options.meshId) return { tasks: [], unread: unread + 1, unavailable: "mesh tasks state unavailable" };
            unread += 1; continue;
        }
        const agents = new Map<string, string | undefined>();
        for (const taskId of taskIds) {
            try {
                const taskDirectory = join(meshRoot, "tasks", taskId);
                const [requestRaw, statusRaw, resultRaw] = await Promise.all([json(join(taskDirectory, "request.json")), json(join(taskDirectory, "status.json")), json(join(taskDirectory, "result.json")).catch(() => undefined)]);
                const request = object(requestRaw); const status = object(statusRaw); const result = object(resultRaw);
                const agentId = typeof request?.agentId === "string" ? request.agentId : undefined;
                const startedMs = isoMs(result?.startedAt) ?? isoMs(status?.startedAt) ?? isoMs(request?.createdAt); const finishedMs = isoMs(result?.finishedAt) ?? isoMs(status?.finishedAt);
                if (!request || !status || request.meshId !== meshId || status.meshId !== meshId || typeof request.taskId !== "string" || request.taskId !== taskId || !agentId || status.agentId !== agentId || status.taskId !== taskId || result && (result.meshId !== meshId || result.agentId !== agentId || result.taskId !== taskId) || startedMs === undefined || (finishedMs !== undefined && finishedMs < startedMs)) { unread += 1; continue; }
                if (!agents.has(agentId)) {
                    const rawAgent = object(await json(join(meshRoot, "agents", agentId, "agent.json")).catch(() => undefined));
                    agents.set(agentId, rawAgent?.meshId === meshId && rawAgent.agentId === agentId && typeof rawAgent.agent === "string" ? rawAgent.agent : undefined);
                }
                const agentType = agents.get(agentId);
                if (!agentType) { unread += 1; continue; }
                const open = finishedMs === undefined;
                if (open && startedMs > nowMs) { unread += 1; continue; }
                const elapsed = (finishedMs ?? nowMs) - startedMs;
                if (options.sinceMs !== undefined && (finishedMs ?? startedMs) < options.sinceMs) continue;
                tasks.push({ meshId, agentId, taskId: request.taskId, agentType, outcome: typeof result?.outcome === "string" ? result.outcome : typeof status.state === "string" ? status.state : "unknown", startedAt: new Date(startedMs).toISOString(), ...(finishedMs === undefined ? {} : { finishedAt: new Date(finishedMs).toISOString() }), durationMs: elapsed, open, longRunning: elapsed >= LONG_RUNNING_MS });
            } catch { unread += 1; }
        }
    }
    return { tasks: tasks.toSorted((a, b) => b.durationMs - a.durationMs || a.taskId.localeCompare(b.taskId)), unread };
}

function percentile(values: readonly number[], fraction: number): number { if (values.length === 0) return 0; const sorted = values.toSorted((a, b) => a - b); return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0; }
function agentTypeLines(tasks: readonly MeshTaskMetric[]): string[] { const grouped = new Map<string, MeshTaskMetric[]>(); for (const task of tasks) grouped.set(task.agentType, [...(grouped.get(task.agentType) ?? []), task]); return [...grouped].toSorted(([a], [b]) => a.localeCompare(b)).map(([agentType, values]) => `  ${agentType}: ${values.length}, ${duration(values.reduce((sum, item) => sum + item.durationMs, 0))}`); }
export function formatCurrentPerformance(runs: readonly PerformanceRun[], mesh: MeshMetrics, resources: PerformanceResourceSnapshot): string {
    const total = runs.reduce((sum, run) => sum + run.totalMs, 0); const turns = runs.reduce((sum, run) => sum + run.turnCount, 0); const turnMs = runs.reduce((sum, run) => sum + run.turnMs, 0); const toolWall = runs.reduce((sum, run) => sum + run.toolWallMs, 0); const nonTool = runs.reduce((sum, run) => sum + run.nonToolMs, 0); const tools = new Map<string, ToolAggregate>();
    for (const run of runs) for (const [name, value] of Object.entries(run.tools)) { const current = tools.get(name) ?? { count: 0, durationMs: 0 }; current.count += value.count; current.durationMs += value.durationMs; tools.set(name, current); }
    const lines = ["Performance — current session", `Settled runs: ${runs.length}; total ${duration(total)}; turns ${turns} / ${duration(turnMs)}`, `Tool wall: ${duration(toolWall)}; non-tool: ${duration(nonTool)}`, "Tools:", ...([...tools].toSorted(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `  ${name}: ${value.count}, ${duration(value.durationMs)}`)), `Mesh tasks: ${mesh.tasks.length}; unread: ${mesh.unread}${mesh.unavailable ? `; unavailable: ${mesh.unavailable}` : ""}`, ...mesh.tasks.map(task => `  ${task.agentType} ${task.outcome} ${duration(task.durationMs)} ${shortId(task.taskId)}${task.longRunning ? " long-running" : ""}${task.open ? " open" : ""}`), `Resources: ${resources.cpuCount} CPU; load ${resources.loadAverage.map(value => value.toFixed(2)).join(" ")}; memory ${bytes(resources.memoryFreeBytes)} free / ${bytes(resources.memoryTotalBytes)}`, `Swap: ${resources.swap}; disk free: ${resources.diskFreeBytes === "unavailable" ? "unavailable" : bytes(resources.diskFreeBytes)}`];
    return lines.join("\n");
}
export function formatRecentPerformance(days: number, metrics: MeshMetrics): string {
    const values = metrics.tasks.map(task => task.durationMs); const total = values.reduce((sum, value) => sum + value, 0);
    return [
        `Performance — mesh tasks, last ${days} day(s)`,
        `Tasks: ${metrics.tasks.length}; total ${duration(total)}; median ${duration(percentile(values, 0.5))}; p90 ${duration(percentile(values, 0.9))}; unread: ${metrics.unread}${metrics.unavailable ? `; unavailable: ${metrics.unavailable}` : ""}`,
        "Agent types:", ...agentTypeLines(metrics.tasks), "Longest:", ...metrics.tasks.slice(0, 10).map(task => `  ${task.agentType} ${task.outcome} ${duration(task.durationMs)} ${shortId(task.taskId)}${task.longRunning ? " long-running" : ""}${task.open ? " open" : ""}`),
    ].join("\n");
}
export function parsePerformanceArguments(raw: string): { mode: "current" } | { mode: "recent"; days: number } {
    const args = raw.trim().split(/\s+/u).filter(Boolean); if (args.length === 0) return { mode: "current" };
    if (args[0] !== "recent" || args.length > 2) throw new Error("Usage: /performance [recent [days]]"); const days = args[1] === undefined ? 7 : Number(args[1]);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error("Performance days must be an integer from 1 to 90"); return { mode: "recent", days };
}

export default function performanceExtension(pi: ExtensionAPI, options: { configPath?: string; clock?: () => number; wallClock?: () => Date; env?: NodeJS.ProcessEnv } = {}): void {
    const collector = new PerformanceCollector(options.clock, options.wallClock); const configPath = options.configPath ?? join(getAgentDir(), "orchestration.json"); const env = options.env ?? process.env;
    pi.on("agent_start", () => collector.startRun());
    pi.on("turn_start", event => collector.startTurn(event.turnIndex));
    pi.on("turn_end", event => collector.endTurn(event.turnIndex));
    pi.on("tool_execution_start", event => collector.startTool(event.toolCallId, event.toolName));
    pi.on("tool_execution_end", event => collector.endTool(event.toolCallId));
    pi.on("agent_settled", () => { const run = collector.settle(); if (run) pi.appendEntry(PERFORMANCE_ENTRY, run); });
    const handler = async (raw: string, ctx: ExtensionContext): Promise<void> => {
        try {
            const command = parsePerformanceArguments(raw); let text: string;
            if (command.mode === "recent") text = formatRecentPerformance(command.days, await readMeshMetrics(configPath, { sinceMs: Date.now() - command.days * 86_400_000 }));
            else { const summary = summarizeRuns(ctx.sessionManager.getEntries()); text = formatCurrentPerformance(summary.runs, await readMeshMetrics(configPath, { meshId: env.PI_MESH_ID }), await resourceSnapshot(ctx.cwd)); if (summary.unread) text += `\nUnread performance entries: ${summary.unread}`; }
            ctx.ui.notify(text, "info");
        } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
    };
    pi.registerCommand("performance", { description: "Show local session, mesh, and resource performance", getArgumentCompletions: prefix => "recent".startsWith(prefix.trim()) ? [{ value: "recent", label: "recent", description: "Aggregate recent mesh tasks" }] : null, handler });
    const unregister = provideCommandPaletteContribution(pi.events, { owner: "performance", id: "show", label: "/performance  Show local performance", description: "View session, mesh, and resource timing.", keywords: ["timing", "tools", "mesh", "resources"], run: ctx => handler("", ctx) });
    pi.on("session_shutdown", unregister);
}
