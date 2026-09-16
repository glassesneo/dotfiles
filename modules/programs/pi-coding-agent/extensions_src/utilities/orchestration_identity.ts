import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
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

/** Stable Nature-xxxxxxxx handle derived only from the immutable agent ID. */
export function handleForAgentId(agentId: string, words: readonly string[] = NATURE_HANDLE_WORDS): string {
    if (words.length === 0) throw new Error("nature handle words must not be empty");
    const word = words[hashAgentIdentity(agentId) % words.length]!;
    return `${word}-${fixedHandleSuffix(agentId)}`;
}

/** Compatibility helper for callers that project an inventory at once. */
export function assignNatureHandles(
    agentIds: readonly string[],
    words: readonly string[] = NATURE_HANDLE_WORDS,
): Map<string, string> {
    return new Map([...new Set(agentIds)].map(agentId => [agentId, handleForAgentId(agentId, words)]));
}

export function publicCapabilityLabel(identity: Pick<AgentDisplayIdentity, "publicAgent" | "access">): string | undefined {
    return identity.publicAgent && identity.access ? `${identity.publicAgent}/${identity.access}` : undefined;
}

export function usualAgentStatusForSnapshot(snapshot: AgentSnapshot): UsualAgentStatus {
    const stop = snapshot.stop;
    if (
        snapshot.status.state === "stopping"
        || snapshot.activity.phase === "confirming-stop"
        || stop?.state === "requested"
        || stop?.state === "terminating"
    ) return "confirming-stop";
    if (isTerminalAgent(snapshot.status.state)) return "stopped-retired";
    if (snapshot.status.state === "busy" || snapshot.status.state === "creating") return "running";
    if (snapshot.status.state === "idle" && snapshot.activity.acceptingTask) return "idle-reusable";
    return "status-unknown";
}

export function displayIdentityForAgentId(
    agentId: string,
    words: readonly string[] = NATURE_HANDLE_WORDS,
): AgentDisplayIdentity {
    return { agentId, handle: handleForAgentId(agentId, words) };
}

/** Active model and fallback count come from status.modelRoute; definitionSnapshot.execution is the immutable fallback. */
export function displayIdentityForSnapshot(
    snapshot: AgentSnapshot,
    words: readonly string[] = NATURE_HANDLE_WORDS,
): AgentDisplayIdentity {
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

function joinUsualIdentity(parts: Array<string | undefined>): string {
    return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

/** Width-aware usual identity. Keep handle and textual status; drop purpose, then capability, before truncating status. */
export function fitUsualIdentityLine(
    identity: Pick<AgentDisplayIdentity, "handle" | "publicAgent" | "access" | "purpose" | "status">,
    width: number,
): string {
    const handle = identity.handle;
    const capability = publicCapabilityLabel(identity);
    const purpose = identity.purpose;
    const status = formatUsualStatus(identity.status);
    const limit = Math.max(0, width);
    const fits = (text: string) => visibleWidth(text) <= limit;
    const full = joinUsualIdentity([handle, capability, purpose, status]);
    if (fits(full)) return full;
    if (purpose) {
        const withoutPurpose = joinUsualIdentity([handle, capability, status]);
        const separator = withoutPurpose ? visibleWidth(" · ") : 0;
        const budget = limit - visibleWidth(withoutPurpose) - separator;
        if (budget >= 1) {
            const candidate = joinUsualIdentity([handle, capability, truncateToWidth(purpose, budget, "…"), status]);
            if (fits(candidate)) return candidate;
        }
    }
    const droppedPurpose = joinUsualIdentity([handle, capability, status]);
    if (fits(droppedPurpose)) return droppedPurpose;
    const handleAndStatus = joinUsualIdentity([handle, status]);
    if (fits(handleAndStatus)) return handleAndStatus;
    const statusSuffix = status ? ` · ${status}` : "";
    const handleBudget = limit - visibleWidth(statusSuffix);
    if (handleBudget >= 1) return `${truncateToWidth(handle, handleBudget, "…")}${statusSuffix}`;
    return truncateToWidth(handleAndStatus || handle, Math.max(1, limit), "…");
}

export function formatCompactAgentIdentity(identity: AgentDisplayIdentity): string {
    return fitUsualIdentityLine(identity, Number.POSITIVE_INFINITY);
}

export function formatUsualIdentityLine(snapshot: AgentSnapshot, words?: readonly string[]): string {
    return formatCompactAgentIdentity(displayIdentityForSnapshot(snapshot, words));
}

export function formatPartyLabel(identity: AgentDisplayIdentity | undefined, fallback: string): string {
    if (fallback === "root") return "root";
    if (!identity) return fallback;
    const capability = publicCapabilityLabel(identity);
    return capability ? `${identity.handle} ${capability}` : identity.handle;
}

export function agentIdFromEndpoint(endpointId: string | undefined): string | undefined {
    if (typeof endpointId !== "string" || !endpointId.startsWith("agent:")) return undefined;
    const agentId = endpointId.slice("agent:".length);
    return agentId || undefined;
}

/** Root is only the `root:` prefix. Missing or unknown endpoints are not guessed as root. */
export function isRootEndpointId(endpointId: string | undefined): boolean {
    return typeof endpointId === "string" && endpointId.startsWith("root:");
}

export function partyLabelForEndpoint(
    endpointId: string | undefined,
    identities: ReadonlyMap<string, AgentDisplayIdentity>,
    words?: readonly string[],
): string | undefined {
    if (typeof endpointId !== "string") return undefined;
    if (isRootEndpointId(endpointId)) return "root";
    const agentId = agentIdFromEndpoint(endpointId);
    if (!agentId) return undefined;
    const identity = identities.get(agentId) ?? displayIdentityForAgentId(agentId, words);
    return formatPartyLabel(identity, identity.handle);
}

export function collectEndpointAgentIds(...endpointIds: Array<string | undefined>): string[] {
    return [...new Set(endpointIds.flatMap(endpointId => {
        const agentId = agentIdFromEndpoint(endpointId);
        return agentId ? [agentId] : [];
    }))];
}

export function previewHistoryText(value: string, maxLines = 2): { preview: string; truncated: boolean } {
    const lines = value.replace(/\r\n|\r/gu, "\n").split("\n");
    const kept = lines.slice(0, maxLines);
    return { preview: kept.join("\n"), truncated: lines.length > maxLines };
}
