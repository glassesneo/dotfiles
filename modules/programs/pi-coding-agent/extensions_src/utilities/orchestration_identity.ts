import type { AgentSnapshot } from "./orchestration_types.ts";

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

export interface AgentDisplayIdentity {
    agentId: string;
    handle: string;
    role?: string;
    profile?: string;
    roleDescription?: string;
    model?: string;
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

export function displayIdentityForAgentId(
    agentId: string,
    words: readonly string[] = NATURE_HANDLE_WORDS,
): AgentDisplayIdentity {
    return { agentId, handle: handleForAgentId(agentId, words) };
}

/** Project immutable role/profile facts from a stored agent snapshot. */
export function displayIdentityForSnapshot(
    snapshot: AgentSnapshot,
    words: readonly string[] = NATURE_HANDLE_WORDS,
): AgentDisplayIdentity {
    return {
        agentId: snapshot.agent.agentId,
        handle: handleForAgentId(snapshot.agent.agentId, words),
        role: snapshot.agent.role,
        profile: snapshot.agent.selectedProfile,
        roleDescription: snapshot.agent.roleSnapshot.description,
        model: snapshot.agent.profileSnapshot.model,
        ...(snapshot.agent.profileSnapshot.thinkingLevel ? { thinkingLevel: snapshot.agent.profileSnapshot.thinkingLevel } : {}),
        harness: snapshot.agent.profileSnapshot.harness,
    };
}

export function formatCompactAgentIdentity(identity: AgentDisplayIdentity): string {
    return `${identity.handle} · role:${identity.role ?? "unresolved"} · profile:${identity.profile ?? "unresolved"}`;
}
