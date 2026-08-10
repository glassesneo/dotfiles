import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { mapConcurrent } from "./concurrency.ts";

const METRICS_READ_CONCURRENCY = 8;

export interface OrchestrationTaskMetric {
    meshId: string;
    agentId: string;
    taskId: string;
    agentType: string;
    outcome: string;
    startedAt: string;
    finishedAt?: string;
    durationMs: number;
    open: boolean;
}

export interface OrchestrationMetrics {
    tasks: OrchestrationTaskMetric[];
    unread: number;
    unavailable?: string;
}

interface TaskCandidate extends Omit<OrchestrationTaskMetric, "agentType"> {}

type TaskReadResult =
    | { candidate: TaskCandidate; unread: 0 }
    | { unread: 1 };

function object(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function isoMs(value: unknown): number | undefined {
    if (typeof value !== "string") return undefined;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

async function json(path: string): Promise<unknown> {
    return JSON.parse(await readFile(path, "utf8"));
}

async function optionalJson(path: string): Promise<unknown> {
    try {
        return await json(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

async function readTaskCandidate(
    meshRoot: string,
    meshId: string,
    taskId: string,
    nowMs: number,
): Promise<TaskReadResult> {
    try {
        const taskDirectory = join(meshRoot, "tasks", taskId);
        const [requestRaw, statusRaw, resultRaw] = await Promise.all([
            json(join(taskDirectory, "request.json")),
            json(join(taskDirectory, "status.json")),
            optionalJson(join(taskDirectory, "result.json")),
        ]);
        const request = object(requestRaw);
        const status = object(statusRaw);
        const result = object(resultRaw);
        const agentId = typeof request?.agentId === "string" ? request.agentId : undefined;
        const startedMs = isoMs(result?.startedAt) ?? isoMs(status?.startedAt) ?? isoMs(request?.createdAt);
        const finishedMs = isoMs(result?.finishedAt) ?? isoMs(status?.finishedAt);
        if (!request || !status || request.meshId !== meshId || status.meshId !== meshId || typeof request.taskId !== "string" || request.taskId !== taskId || !agentId || status.agentId !== agentId || status.taskId !== taskId || result && (result.meshId !== meshId || result.agentId !== agentId || result.taskId !== taskId) || startedMs === undefined || finishedMs !== undefined && finishedMs < startedMs) {
            return { unread: 1 };
        }
        const open = finishedMs === undefined;
        if (open && startedMs > nowMs) return { unread: 1 };
        return {
            unread: 0,
            candidate: {
                meshId,
                agentId,
                taskId: request.taskId,
                outcome: typeof result?.outcome === "string"
                    ? result.outcome
                    : typeof status.state === "string" ? status.state : "unknown",
                startedAt: new Date(startedMs).toISOString(),
                ...(finishedMs === undefined ? {} : { finishedAt: new Date(finishedMs).toISOString() }),
                durationMs: (finishedMs ?? nowMs) - startedMs,
                open,
            },
        };
    } catch {
        return { unread: 1 };
    }
}

async function readAgentTypes(meshRoot: string, meshId: string, agentIds: readonly string[]): Promise<Map<string, string>> {
    const entries = await mapConcurrent([...new Set(agentIds)], METRICS_READ_CONCURRENCY, async agentId => {
        const rawAgent = object(await json(join(meshRoot, "agents", agentId, "agent.json")).catch(() => undefined));
        const agentType = rawAgent?.meshId === meshId && rawAgent.agentId === agentId && typeof rawAgent.agent === "string"
            ? rawAgent.agent
            : undefined;
        return [agentId, agentType] as const;
    });
    return new Map(entries.flatMap(([agentId, agentType]) => agentType === undefined ? [] : [[agentId, agentType]]));
}

export async function readOrchestrationMetrics(
    configPath: string,
    options: { meshId?: string; sinceMs?: number; nowMs?: number } = {},
): Promise<OrchestrationMetrics> {
    const nowMs = options.nowMs ?? Date.now();
    let unread = 0;
    let config: Record<string, unknown> | undefined;
    try {
        config = object(await json(configPath));
    } catch {
        return { tasks: [], unread: 1, unavailable: "mesh config unavailable" };
    }
    if (typeof config?.stateRoot !== "string") {
        return { tasks: [], unread: 1, unavailable: "mesh stateRoot unavailable" };
    }

    const meshesRoot = join(config.stateRoot, "meshes");
    let meshIds: string[];
    if (options.meshId) meshIds = [options.meshId];
    else {
        try {
            meshIds = await readdir(meshesRoot);
        } catch {
            return { tasks: [], unread: 1, unavailable: "mesh state unavailable" };
        }
    }

    const tasks: OrchestrationTaskMetric[] = [];
    for (const meshId of meshIds) {
        const meshRoot = join(meshesRoot, meshId);
        let taskIds: string[];
        try {
            taskIds = await readdir(join(meshRoot, "tasks"));
        } catch {
            if (options.meshId) {
                return { tasks: [], unread: unread + 1, unavailable: "mesh tasks state unavailable" };
            }
            unread += 1;
            continue;
        }

        const taskReads = await mapConcurrent(
            taskIds,
            METRICS_READ_CONCURRENCY,
            taskId => readTaskCandidate(meshRoot, meshId, taskId, nowMs),
        );
        unread += taskReads.reduce((sum, result) => sum + result.unread, 0);
        const candidates = taskReads.flatMap(result => "candidate" in result ? [result.candidate] : []);
        const agentTypes = await readAgentTypes(meshRoot, meshId, candidates.map(candidate => candidate.agentId));
        for (const candidate of candidates) {
            const agentType = agentTypes.get(candidate.agentId);
            if (agentType === undefined) {
                unread += 1;
                continue;
            }
            const finishedMs = candidate.finishedAt === undefined ? undefined : Date.parse(candidate.finishedAt);
            const startedMs = Date.parse(candidate.startedAt);
            if (options.sinceMs !== undefined && (finishedMs ?? startedMs) < options.sinceMs) continue;
            tasks.push({ ...candidate, agentType });
        }
    }

    return {
        tasks: tasks.toSorted((a, b) => b.durationMs - a.durationMs || a.taskId.localeCompare(b.taskId)),
        unread,
    };
}
