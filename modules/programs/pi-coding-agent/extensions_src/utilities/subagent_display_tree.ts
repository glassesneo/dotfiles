import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { isTerminalAgent, type AgentSnapshot, type AgentState, type TaskState } from "./subagent_types.ts";

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

export const PROFILE_COLOR_ROLES: readonly ThemeColor[] = [
    "accent", "toolTitle", "mdHeading", "mdLink", "customMessageLabel",
    "syntaxKeyword", "syntaxFunction", "syntaxString", "syntaxType", "bashMode",
    "mdCode", "mdQuote", "thinkingText", "userMessageText",
];

export interface AgentStateBadge {
    symbol: string;
    label: string;
    role: ThemeColor;
}

export const AGENT_STATE_BADGES: Record<AgentState, AgentStateBadge> = {
    creating: { symbol: "◌", label: "STARTING", role: "warning" },
    idle: { symbol: "○", label: "IDLE", role: "success" },
    busy: { symbol: "●", label: "BUSY", role: "accent" },
    stopping: { symbol: "◐", label: "STOPPING", role: "warning" },
    stopped: { symbol: "■", label: "STOPPED", role: "muted" },
    failed: { symbol: "!", label: "FAILED", role: "error" },
};

export const TASK_STATE_BADGES: Record<TaskState, AgentStateBadge> = {
    created: { symbol: "◌", label: "CREATED", role: "muted" },
    running: { symbol: "●", label: "RUNNING", role: "accent" },
    succeeded: { symbol: "✓", label: "SUCCEEDED", role: "success" },
    failed: { symbol: "!", label: "FAILED", role: "error" },
    stopped: { symbol: "■", label: "STOPPED", role: "muted" },
};

export const WAIT_OUTCOME_BADGES = {
    waiting: { symbol: "…", label: "WAITING", role: "warning" as ThemeColor },
    completed: { symbol: "✓", label: "COMPLETED", role: "success" as ThemeColor },
    timeout: { symbol: "◷", label: "TIMEOUT", role: "warning" as ThemeColor },
} as const;

export interface SubagentDisplayNode {
    agentId: string;
    snapshot: AgentSnapshot;
    handle: string;
    ghost: boolean;
    promoted: boolean;
    viaHandle?: string;
    orphaned: boolean;
    children: SubagentDisplayNode[];
}

export interface SubagentDisplayTree {
    roots: SubagentDisplayNode[];
    byId: Map<string, SubagentDisplayNode>;
    handles: Map<string, string>;
}

function hashString(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function hexSource(agentId: string): string {
    const hex = agentId.replace(/[^a-fA-F0-9]/gu, "").toLowerCase();
    if (hex.length >= 4) return hex;
    return `${hex}${hashString(agentId).toString(16).padStart(8, "0")}`;
}

/** Deterministic unique Nature-xxxx handles for one origin record set. */
export function assignNatureHandles(agentIds: readonly string[]): Map<string, string> {
    const sorted = [...new Set(agentIds)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    const used = new Set<string>();
    const result = new Map<string, string>();
    for (const agentId of sorted) {
        const word = NATURE_HANDLE_WORDS[hashString(agentId) % NATURE_HANDLE_WORDS.length]!;
        const hex = hexSource(agentId);
        let length = 4;
        while (true) {
            const suffix = hex.slice(0, length).padEnd(length, "0");
            const handle = `${word}-${suffix}`;
            if (!used.has(handle)) {
                used.add(handle);
                result.set(agentId, handle);
                break;
            }
            length += 1;
            if (length > hex.length + 16) {
                result.set(agentId, `${word}-${suffix}-${result.size}`);
                used.add(result.get(agentId)!);
                break;
            }
        }
    }
    return result;
}

export function profileColorRole(profile: string): ThemeColor {
    return PROFILE_COLOR_ROLES[hashString(profile) % PROFILE_COLOR_ROLES.length]!;
}

export function formatStateBadge(state: AgentState): string {
    const badge = AGENT_STATE_BADGES[state];
    return `${badge.symbol} ${badge.label}`;
}

export function formatTaskStateBadge(state: TaskState): string {
    const badge = TASK_STATE_BADGES[state];
    return `${badge.symbol} ${badge.label}`;
}

export function formatWaitOutcomeBadge(kind: keyof typeof WAIT_OUTCOME_BADGES): string {
    const badge = WAIT_OUTCOME_BADGES[kind];
    return `${badge.symbol} ${badge.label}`;
}

function createdAtMs(snapshot: AgentSnapshot): number {
    const value = Date.parse(snapshot.agent.createdAt);
    return Number.isFinite(value) ? value : 0;
}

function sortByCreatedAt(left: SubagentDisplayNode, right: SubagentDisplayNode): number {
    const delta = createdAtMs(left.snapshot) - createdAtMs(right.snapshot);
    if (delta !== 0) return delta;
    return left.agentId < right.agentId ? -1 : left.agentId > right.agentId ? 1 : 0;
}

function nearestActiveAncestorId(agentId: string, byId: Map<string, AgentSnapshot>): string | undefined {
    const snapshot = byId.get(agentId);
    let parentId = snapshot?.agent.parentAgentId;
    const seen = new Set<string>([agentId]);
    while (parentId) {
        if (seen.has(parentId)) return undefined;
        seen.add(parentId);
        const parent = byId.get(parentId);
        if (!parent) return undefined;
        if (!isTerminalAgent(parent.status.state)) return parentId;
        parentId = parent.agent.parentAgentId;
    }
    return undefined;
}

/** Break display-parent cycles by promoting the lexicographically smallest id to an orphaned root. */
export function breakDisplayParentCycles(
    displayParentIds: Map<string, string | undefined>,
    nodes: Map<string, SubagentDisplayNode>,
): void {
    for (const startId of [...displayParentIds.keys()].sort()) {
        const seen: string[] = [];
        const index = new Map<string, number>();
        let current: string | undefined = startId;
        while (current) {
            const existing = index.get(current);
            if (existing !== undefined) {
                const cycle = seen.slice(existing);
                const breakAt = [...cycle].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)[0]!;
                if (displayParentIds.get(breakAt) !== undefined) {
                    displayParentIds.set(breakAt, undefined);
                    const node = nodes.get(breakAt);
                    if (node) node.orphaned = true;
                }
                break;
            }
            index.set(current, seen.length);
            seen.push(current);
            current = displayParentIds.get(current);
        }
    }
}

/**
 * Pure display-tree projection. Does not mutate input snapshots or parentAgentId.
 * Terminal middle agents remain as inline ghosts; active descendants promote to the
 * nearest active ancestor and record viaHandle for the immediate ghost parent.
 */
export function buildSubagentDisplayTree(snapshots: readonly AgentSnapshot[]): SubagentDisplayTree {
    const bySnapshot = new Map(snapshots.map(snapshot => [snapshot.agent.agentId, snapshot]));
    const handles = assignNatureHandles([...bySnapshot.keys()]);
    const nodes = new Map<string, SubagentDisplayNode>();
    const displayParentIds = new Map<string, string | undefined>();

    for (const snapshot of snapshots) {
        const agentId = snapshot.agent.agentId;
        const recordParent = snapshot.agent.parentAgentId;
        const parentMissing = recordParent !== undefined && !bySnapshot.has(recordParent);
        const ghost = isTerminalAgent(snapshot.status.state);
        let displayParentId: string | undefined;
        let viaHandle: string | undefined;
        let promoted = false;
        let orphaned = parentMissing;

        if (ghost) {
            displayParentId = parentMissing ? undefined : recordParent;
        } else {
            const activeAncestor = nearestActiveAncestorId(agentId, bySnapshot);
            if (activeAncestor !== undefined) {
                displayParentId = activeAncestor;
                if (recordParent && recordParent !== activeAncestor) {
                    promoted = true;
                    if (bySnapshot.has(recordParent) && isTerminalAgent(bySnapshot.get(recordParent)!.status.state)) {
                        viaHandle = handles.get(recordParent);
                    }
                }
            } else if (recordParent && bySnapshot.has(recordParent) && isTerminalAgent(bySnapshot.get(recordParent)!.status.state)) {
                displayParentId = undefined;
                promoted = true;
                viaHandle = handles.get(recordParent);
            } else {
                displayParentId = undefined;
                orphaned = parentMissing;
            }
        }

        displayParentIds.set(agentId, displayParentId);
        nodes.set(agentId, {
            agentId,
            snapshot,
            handle: handles.get(agentId)!,
            ghost,
            promoted,
            viaHandle,
            orphaned,
            children: [],
        });
    }

    breakDisplayParentCycles(displayParentIds, nodes);

    const roots: SubagentDisplayNode[] = [];
    for (const node of nodes.values()) {
        const parentId = displayParentIds.get(node.agentId);
        const parent = parentId ? nodes.get(parentId) : undefined;
        if (parent) parent.children.push(node);
        else roots.push(node);
    }

    const sortRecursive = (list: SubagentDisplayNode[]): void => {
        list.sort(sortByCreatedAt);
        for (const child of list) sortRecursive(child.children);
    };
    sortRecursive(roots);

    return { roots, byId: nodes, handles };
}

export function flattenVisibleDisplayNodes(roots: readonly SubagentDisplayNode[], collapsed: ReadonlySet<string>): SubagentDisplayNode[] {
    const visible: SubagentDisplayNode[] = [];
    const walk = (nodes: readonly SubagentDisplayNode[]): void => {
        for (const node of nodes) {
            visible.push(node);
            if (node.children.length > 0 && !collapsed.has(node.agentId)) walk(node.children);
        }
    };
    walk(roots);
    return visible;
}

/** Build connector prefixes for a visible preorder list. */
export function treeConnectors(visible: readonly SubagentDisplayNode[], byId: Map<string, SubagentDisplayNode>): Map<string, string> {
    const result = new Map<string, string>();
    const parentOf = new Map<string, string>();
    for (const node of byId.values()) {
        for (const child of node.children) parentOf.set(child.agentId, node.agentId);
    }
    const isLastSibling = (agentId: string): boolean => {
        const parentId = parentOf.get(agentId);
        const siblings = parentId ? byId.get(parentId)?.children ?? [] : [...byId.values()].filter(node => !parentOf.has(node.agentId)).sort(sortByCreatedAt);
        return siblings[siblings.length - 1]?.agentId === agentId;
    };
    for (const node of visible) {
        const parts: string[] = [];
        const ancestors: string[] = [];
        let current = parentOf.get(node.agentId);
        while (current) {
            ancestors.unshift(current);
            current = parentOf.get(current);
        }
        for (const ancestorId of ancestors) {
            parts.push(isLastSibling(ancestorId) ? "  " : "│ ");
        }
        if (parentOf.has(node.agentId)) {
            parts.push(isLastSibling(node.agentId) ? "└─" : "├─");
        }
        result.set(node.agentId, parts.join(""));
    }
    return result;
}

export function retainSelection(
    previousId: string | undefined,
    visible: readonly SubagentDisplayNode[],
    previousVisibleIds: readonly string[],
): string | undefined {
    if (visible.length === 0) return undefined;
    if (previousId && visible.some(node => node.agentId === previousId)) return previousId;
    if (previousId && previousVisibleIds.length > 0) {
        const previousIndex = previousVisibleIds.indexOf(previousId);
        if (previousIndex >= 0) {
            const clamped = Math.min(previousIndex, visible.length - 1);
            return visible[clamped]?.agentId;
        }
    }
    return visible[0]?.agentId;
}
