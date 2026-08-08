import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { validateModeConfig, type AgentMode } from "./mode_types.ts";

export const ACTIVE_MODE_EVENT = "neo.dotfiles.pi:active-mode" as const;
export type ActiveModeReason = "startup" | "switch" | "restore";
export interface ActiveModeEvent { schemaVersion: 1; name: string; mode: Readonly<AgentMode>; reason: ActiveModeReason }

export function emitActiveMode(pi: ExtensionAPI, name: string, mode: AgentMode, reason: ActiveModeReason): void {
    pi.events.emit(ACTIVE_MODE_EVENT, { schemaVersion: 1, name, mode: structuredClone(mode), reason } satisfies ActiveModeEvent);
}
export function validateActiveModeEvent(value: unknown): ActiveModeEvent {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("active-mode event must be an object");
    const raw = value as Record<string, unknown>;
    const unknown = Object.keys(raw).filter(key => !["schemaVersion", "name", "mode", "reason"].includes(key));
    if (unknown.length) throw new Error(`active-mode event contains unknown keys: ${unknown.join(", ")}`);
    if (raw.schemaVersion !== 1) throw new Error("Unsupported active-mode event schemaVersion");
    if (raw.reason !== "startup" && raw.reason !== "switch" && raw.reason !== "restore") throw new Error("active-mode event reason is invalid");
    if (typeof raw.name !== "string" || !raw.name.trim()) throw new Error("active-mode event name must be non-empty");
    const config = validateModeConfig({ schemaVersion: 1, defaultMode: raw.name, modes: { [raw.name]: raw.mode } });
    return { schemaVersion: 1, name: raw.name, mode: config.modes[raw.name]!, reason: raw.reason };
}
export function onActiveMode(pi: ExtensionAPI, handler: (event: ActiveModeEvent) => void, onError: (error: Error) => void = () => {}): void {
    pi.events.on(ACTIVE_MODE_EVENT, value => { try { handler(validateActiveModeEvent(value)); } catch (error) { onError(error instanceof Error ? error : new Error(String(error))); } });
}
