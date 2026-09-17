import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
    displayIdentityForAgentId,
    displayIdentityForSnapshot,
    formatCompactAgentIdentity,
    formatUsualStatus,
    joinUsualIdentity,
    publicCapabilityLabel,
    type AgentDisplayIdentity,
} from "./orchestration_identity_core.ts";
import type { AgentSnapshot } from "./orchestration_types.ts";

export * from "./orchestration_identity_core.ts";

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
