import { addUsage, emptyUsage, type AgentSnapshot, type TaskSnapshot } from "./orchestration_types.ts";
import type { Usage } from "@earendil-works/pi-ai";

export interface MeshUsageProjection {
    accounted: Usage;
    accountedTaskIds: string[];
    unknownTaskIds: string[];
}

/** Count each store task once by taskId. Latest-task snapshots are not a usage source. */
export function projectMeshChildUsage(agents: readonly AgentSnapshot[], tasks: readonly TaskSnapshot[]): MeshUsageProjection {
    const accounted = emptyUsage();
    const accountedTaskIds: string[] = [];
    const unknownTaskIds: string[] = [];
    const capabilityByAgent = new Map(agents.map(snapshot => [snapshot.agent.agentId, snapshot.agent.capabilities.usage]));
    const seen = new Set<string>();
    for (const task of tasks) {
        if (!task.result) continue;
        const taskId = task.request.taskId;
        if (seen.has(taskId)) continue;
        seen.add(taskId);
        if (!capabilityByAgent.get(task.request.agentId)) {
            unknownTaskIds.push(taskId);
            continue;
        }
        addUsage(accounted, task.result.usage);
        accountedTaskIds.push(taskId);
    }
    return { accounted, accountedTaskIds, unknownTaskIds };
}

export function projectTaskUsage(task: TaskSnapshot, usageCapable: boolean): { usage: Usage | "unknown"; taskId: string } {
    if (!usageCapable || !task.result) return { usage: "unknown", taskId: task.request.taskId };
    return { usage: task.result.usage, taskId: task.request.taskId };
}

export function formatMeshChildUsageLine(projection: MeshUsageProjection): string {
    if (!projection.accountedTaskIds.length && projection.unknownTaskIds.length) return "Child usage unknown (mesh, separate from Pi totals)";
    const unknown = projection.unknownTaskIds.length ? "; unknown tasks remain" : "";
    return `Child usage ${projection.accounted.totalTokens} tokens (mesh, separate from Pi totals)${unknown}`;
}
