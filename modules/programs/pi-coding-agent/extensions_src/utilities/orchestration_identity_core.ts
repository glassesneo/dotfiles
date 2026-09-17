import type { ModelRouteAttempt } from "./orchestration_profile_fallback.ts";
import { isTerminalAgent, type AgentSnapshot, type TaskState } from "./orchestration_types.ts";

/** Nature-word dictionary for deterministic display handles. Avoid role-like or hostile words. */
export const NATURE_HANDLE_WORDS = [
    "Maple", "Cedar", "Oak", "Willow", "Birch", "Aspen", "Pine", "Elm",
    "Rowan", "Hazel", "Fern", "Moss", "River", "Brook", "Lake", "Stone",
    "Coral", "Amber", "Ivory", "Pearl", "Ember", "Frost", "Mist", "Cloud",
    "Tide", "Reef", "Grove", "Meadow", "Harbor", "Vale", "Ridge", "Peak",
    "Glen", "Cove", "Bay", "Shore", "Dune", "Cliff", "Spring", "Creek",
    "Pond", "Marsh", "Delta", "Canyon", "Summit", "Hollow", "Thicket", "Glade",
    "Orchid", "Lotus", "Daisy", "Iris", "Lilac", "Poppy", "Clover", "Heather",
    "Juniper", "Cypress", "Sequoia", "Spruce", "Larch", "Alder", "Beech", "Poplar",
    "Sycamore", "Magnolia", "Laurel", "Myrtle", "Olive", "Acacia", "Bamboo", "Cactus",
    "Agate", "Jade", "Onyx", "Quartz", "Granite", "Slate", "Flint", "Marble",
    "Aurora", "Comet", "Nova", "Orbit", "Solar", "Lunar", "Nebula", "Cosmos",
    "Zephyr", "Breeze", "Gale", "Drift", "Cascade", "Rapids", "Eddy", "Fjord",
    "Lagoon", "Atoll", "Islet", "Arch", "Spire", "Bluff", "Knoll", "Plateau",
] as const;

export type UsualAgentStatus = "running" | "idle-reusable" | "confirming-stop" | "stopped-retired" | "status-unknown";

export const USUAL_AGENT_STATUS_LABELS: Record<UsualAgentStatus, string> = {
    running: "Running",
    "idle-reusable": "Idle",
    "confirming-stop": "Confirming stop",
    "stopped-retired": "Stopped",
    "status-unknown": "Status unknown",
};

export const MESH_CHILD_IDENTITY_STATUS = "mesh-child-identity";

export interface AgentDisplayIdentity {
    agentId: string;
    handle: string;
    publicAgent?: string;
    access?: "read" | "write";
    purpose?: string;
    status?: UsualAgentStatus;
    taskState?: TaskState;
    description?: string;
    model?: string;
    fallbackCount?: number;
    attempts?: ModelRouteAttempt[];
    thinkingLevel?: string;
    harness?: string;
}

export function hashAgentIdentity(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function fixedHandleSuffix(agentId: string): string {
    return hashAgentIdentity(agentId).toString(16).padStart(8, "0");
}

export function handleForAgentId(agentId: string, words: readonly string[] = NATURE_HANDLE_WORDS): string {
    if (words.length === 0) throw new Error("nature handle words must not be empty");
    const word = words[hashAgentIdentity(agentId) % words.length]!;
    return `${word}-${fixedHandleSuffix(agentId)}`;
}

export function assignNatureHandles(agentIds: readonly string[], words: readonly string[] = NATURE_HANDLE_WORDS): Map<string, string> {
    return new Map([...new Set(agentIds)].map(agentId => [agentId, handleForAgentId(agentId, words)]));
}

export function publicCapabilityLabel(identity: Pick<AgentDisplayIdentity, "publicAgent" | "access">): string | undefined {
    return identity.publicAgent && identity.access ? `${identity.publicAgent}/${identity.access}` : undefined;
}

export function usualAgentStatusForSnapshot(snapshot: AgentSnapshot): UsualAgentStatus {
    const stop = snapshot.stop;
    if (snapshot.status.state === "stopping" || snapshot.activity.phase === "confirming-stop" || stop?.state === "requested" || stop?.state === "terminating") return "confirming-stop";
    if (isTerminalAgent(snapshot.status.state)) return "stopped-retired";
    if (snapshot.status.state === "busy" || snapshot.status.state === "creating") return "running";
    if (snapshot.status.state === "idle" && snapshot.activity.acceptingTask) return "idle-reusable";
    return "status-unknown";
}

export function displayIdentityForAgentId(agentId: string, words: readonly string[] = NATURE_HANDLE_WORDS): AgentDisplayIdentity {
    return { agentId, handle: handleForAgentId(agentId, words) };
}

export function displayIdentityForSnapshot(snapshot: AgentSnapshot, words: readonly string[] = NATURE_HANDLE_WORDS): AgentDisplayIdentity {
    const route = snapshot.status.modelRoute;
    const selector = snapshot.agent.definitionSnapshot.selector;
    const purpose = snapshot.task?.request.purpose;
    return {
        agentId: snapshot.agent.agentId,
        handle: handleForAgentId(snapshot.agent.agentId, words),
        publicAgent: selector.agent,
        access: selector.access,
        ...(purpose ? { purpose } : {}),
        status: usualAgentStatusForSnapshot(snapshot),
        ...(snapshot.task ? { taskState: snapshot.task.status.state } : {}),
        description: snapshot.agent.definitionSnapshot.description,
        model: route?.activeModel ?? snapshot.agent.definitionSnapshot.execution.models[0],
        fallbackCount: route?.attempts.length ?? 0,
        ...(route?.attempts.length ? { attempts: route.attempts } : {}),
        ...(snapshot.agent.definitionSnapshot.execution.thinkingLevel ? { thinkingLevel: snapshot.agent.definitionSnapshot.execution.thinkingLevel } : {}),
        harness: snapshot.agent.definitionSnapshot.execution.harness,
    };
}

export function formatUsualStatus(status: UsualAgentStatus | undefined): string | undefined {
    return status ? USUAL_AGENT_STATUS_LABELS[status] : undefined;
}

export function joinUsualIdentity(parts: Array<string | undefined>): string {
    return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

export function formatCompactAgentIdentity(identity: AgentDisplayIdentity): string {
    return joinUsualIdentity([identity.handle, publicCapabilityLabel(identity), identity.purpose, formatUsualStatus(identity.status)]);
}
