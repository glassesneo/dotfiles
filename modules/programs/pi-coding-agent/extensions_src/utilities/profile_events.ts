import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PROFILE_SCHEMA_VERSION, validateProfileConfig, type AgentProfile } from "./profile_types.ts";

export const ACTIVE_PROFILE_EVENT = "neo.dotfiles.pi:active-profile" as const;

export type ActiveProfileReason = "startup" | "switch" | "restore" | "route";
export interface ActiveProfileEvent {
    schemaVersion: 1;
    name: string;
    profile: Readonly<AgentProfile>;
    reason: ActiveProfileReason;
}

export function emitActiveProfile(pi: ExtensionAPI, name: string, profile: AgentProfile, reason: ActiveProfileReason): void {
    const payload: ActiveProfileEvent = {
        schemaVersion: 1,
        name,
        profile: structuredClone(profile),
        reason,
    };
    pi.events.emit(ACTIVE_PROFILE_EVENT, payload);
}

function validateActiveProfileEvent(value: unknown): ActiveProfileEvent {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("active-profile event must be an object");
    const raw = value as Record<string, unknown>;
    const unknownKeys = Object.keys(raw).filter(key => !["schemaVersion", "name", "profile", "reason"].includes(key));
    if (unknownKeys.length > 0) throw new Error(`active-profile event contains unknown keys: ${unknownKeys.join(", ")}`);
    if (raw.schemaVersion !== 1) throw new Error("Unsupported active-profile event schemaVersion");
    if (typeof raw.name !== "string" || raw.name.trim() === "") throw new Error("active-profile event name must be a non-empty string");
    if (raw.reason !== "startup" && raw.reason !== "switch" && raw.reason !== "restore" && raw.reason !== "route") throw new Error("active-profile event reason is invalid");
    const rawProfile = raw.profile && typeof raw.profile === "object" && !Array.isArray(raw.profile) ? raw.profile as Record<string, unknown> : {};
    const config = validateProfileConfig({
        schemaVersion: PROFILE_SCHEMA_VERSION,
        defaultProfile: raw.name,
        profileCycle: [raw.name],
        promptRoutes: {},
        profiles: { [raw.name]: { ...rawProfile, availability: ["top-level", "subagent"] } },
    });
    const availability = Array.isArray(rawProfile.availability) ? rawProfile.availability : undefined;
    if (!availability || availability.length === 0 || new Set(availability).size !== availability.length || availability.some(value => value !== "top-level" && value !== "subagent")) throw new Error("active-profile event profile availability is invalid");
    config.profiles[raw.name]!.availability = [...availability] as AgentProfile["availability"];
    return {
        schemaVersion: 1,
        name: raw.name,
        profile: config.profiles[raw.name]!,
        reason: raw.reason,
    };
}

export function onActiveProfile(
    pi: ExtensionAPI,
    handler: (event: ActiveProfileEvent) => void,
    onError: (error: Error) => void = () => {},
): void {
    pi.events.on(ACTIVE_PROFILE_EVENT, value => {
        try { handler(validateActiveProfileEvent(value)); }
        catch (error) { onError(error instanceof Error ? error : new Error(String(error))); }
    });
}
