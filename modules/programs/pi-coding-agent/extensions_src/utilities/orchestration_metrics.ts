import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import { mapConcurrent } from "./concurrency.ts";
import { readTask } from "./orchestration_store.ts";

const METRICS_READ_CONCURRENCY = 8;

export type OrchestrationUsage =
    | { availability: "available"; value: Usage }
    | { availability: "unavailable" };

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
    turns: number | "unavailable";
    usage: OrchestrationUsage;
}

export interface OrchestrationMetrics {
    tasks: OrchestrationTaskMetric[];
    unread: number;
    unavailable?: string;
}

interface TaskCandidate extends Omit<OrchestrationTaskMetric, "agentType" | "usage"> {
    resultUsage?: Usage;
}

interface AgentMetricCapability {
    agentType: string;
    usage: boolean;
}

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

async function readTaskCandidate(
    meshRoot: string,
    meshId: string,
    taskId: string,
    nowMs: number,
): Promise<TaskReadResult> {
    try {
        const snapshot = await readTask(dirname(dirname(meshRoot)), meshId, taskId);
        const { request, status, result } = snapshot;
        const startedMs = isoMs(result?.startedAt) ?? isoMs(status.startedAt) ?? isoMs(request.createdAt);
        const finishedMs = isoMs(result?.finishedAt) ?? isoMs(status.finishedAt);
        if (startedMs === undefined || finishedMs !== undefined && finishedMs < startedMs) return { unread: 1 };
        const open = finishedMs === undefined;
        if (open && startedMs > nowMs) return { unread: 1 };
        return {
            unread: 0,
            candidate: {
                meshId,
                agentId: request.agentId,
                taskId: request.taskId,
                outcome: result?.outcome ?? status.state,
                startedAt: new Date(startedMs).toISOString(),
                ...(finishedMs === undefined ? {} : { finishedAt: new Date(finishedMs).toISOString() }),
                durationMs: (finishedMs ?? nowMs) - startedMs,
                open,
                turns: result?.turns ?? "unavailable",
                ...(result ? { resultUsage: result.usage } : {}),
            },
        };
    } catch {
        return { unread: 1 };
    }
}

async function readAgentCapabilities(meshRoot: string, meshId: string, agentIds: readonly string[]): Promise<Map<string, AgentMetricCapability>> {
    const entries = await mapConcurrent([...new Set(agentIds)], METRICS_READ_CONCURRENCY, async agentId => {
        const rawAgent = object(await json(join(meshRoot, "agents", agentId, "agent.json")).catch(() => undefined));
        const capabilities = object(rawAgent?.capabilities);
        const value = rawAgent?.schemaVersion === 4 && rawAgent.meshId === meshId && rawAgent.agentId === agentId && typeof rawAgent.role === "string" && typeof capabilities?.usage === "boolean"
            ? { agentType: rawAgent.role, usage: capabilities.usage }
            : undefined;
        return [agentId, value] as const;
    });
    return new Map(entries.flatMap(([agentId, value]) => value === undefined ? [] : [[agentId, value]]));
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
        const agentCapabilities = await readAgentCapabilities(meshRoot, meshId, candidates.map(candidate => candidate.agentId));
        for (const candidate of candidates) {
            const capability = agentCapabilities.get(candidate.agentId);
            if (capability === undefined) {
                unread += 1;
                continue;
            }
            const finishedMs = candidate.finishedAt === undefined ? undefined : Date.parse(candidate.finishedAt);
            const startedMs = Date.parse(candidate.startedAt);
            if (options.sinceMs !== undefined && (finishedMs ?? startedMs) < options.sinceMs) continue;
            const { resultUsage, ...metric } = candidate;
            tasks.push({
                ...metric,
                agentType: capability.agentType,
                turns: capability.usage ? metric.turns : "unavailable",
                usage: capability.usage && resultUsage
                    ? { availability: "available", value: resultUsage }
                    : { availability: "unavailable" },
            });
        }
    }

    return {
        tasks: tasks.toSorted((a, b) => b.durationMs - a.durationMs || a.taskId.localeCompare(b.taskId)),
        unread,
    };
}
