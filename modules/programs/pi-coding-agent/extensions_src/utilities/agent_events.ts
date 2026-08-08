import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { validateLaunchEnvelope, type AgentLaunchEnvelope } from "./agent_types.ts";
export const RESOLVED_AGENT_EVENT = "neo.dotfiles.pi:resolved-agent" as const;
export interface ResolvedAgentEvent { schemaVersion: 1; identity: string; envelope: AgentLaunchEnvelope }
export function emitResolvedAgent(pi: ExtensionAPI, envelope: AgentLaunchEnvelope): void { pi.events.emit(RESOLVED_AGENT_EVENT, { schemaVersion: 1, identity: envelope.identity, envelope: structuredClone(envelope) } satisfies ResolvedAgentEvent); }
export function onResolvedAgent(pi: ExtensionAPI, handler: (event: ResolvedAgentEvent) => void): void { pi.events.on(RESOLVED_AGENT_EVENT, value => { if (!value || typeof value !== "object" || Array.isArray(value)) return; const raw = value as Record<string, unknown>; if (raw.schemaVersion !== 1 || typeof raw.identity !== "string") return; const envelope = validateLaunchEnvelope(raw.envelope); if (envelope.identity === raw.identity) handler({ schemaVersion: 1, identity: raw.identity, envelope }); }); }
