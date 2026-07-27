export const PROFILE_SCHEMA_VERSION = 1 as const;

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ProfileFacet = Record<string, unknown>;

export interface AgentProfile {
    model: string;
    thinkingLevel?: ThinkingLevel;
    allowAllTools: boolean;
    tools: string[];
    instructions?: string;
    extensions: Record<string, ProfileFacet>;
}

export interface AgentProfileConfig {
    schemaVersion: 1;
    defaultProfile: string;
    profileCycle: string[];
    profiles: Record<string, AgentProfile>;
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
    const unknown = Object.keys(value).filter(key => !allowed.includes(key));
    if (unknown.length > 0) throw new Error(`${label} contains unknown keys: ${unknown.join(", ")}`);
}

function nonBlank(value: unknown, label: string): string {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
    return value;
}

function stringArray(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item.trim() === "")) {
        throw new Error(`${label} must be an array of non-empty strings`);
    }
    return [...value] as string[];
}

export function validateProfileConfig(value: unknown): AgentProfileConfig {
    const root = object(value, "agent profile config");
    exactKeys(root, ["schemaVersion", "defaultProfile", "profileCycle", "profiles"], "agent profile config");
    if (root.schemaVersion !== PROFILE_SCHEMA_VERSION) throw new Error("Unsupported agent profile config schemaVersion");
    const rawProfiles = object(root.profiles, "profiles");
    const profiles: Record<string, AgentProfile> = {};
    const thinkingLevels = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

    for (const [name, rawProfile] of Object.entries(rawProfiles)) {
        nonBlank(name, "profile name");
        const profile = object(rawProfile, `profiles.${name}`);
        exactKeys(profile, ["model", "thinkingLevel", "allowAllTools", "tools", "instructions", "extensions"], `profiles.${name}`);
        const thinkingLevel = profile.thinkingLevel;
        if (thinkingLevel !== undefined && (typeof thinkingLevel !== "string" || !thinkingLevels.has(thinkingLevel))) {
            throw new Error(`profiles.${name}.thinkingLevel is invalid`);
        }
        if (typeof profile.allowAllTools !== "boolean") throw new Error(`profiles.${name}.allowAllTools must be boolean`);
        const tools = stringArray(profile.tools, `profiles.${name}.tools`);
        if (profile.allowAllTools && tools.length > 0) throw new Error(`profiles.${name} cannot set tools when allowAllTools is true`);
        const rawExtensions = object(profile.extensions, `profiles.${name}.extensions`);
        const extensions: Record<string, ProfileFacet> = {};
        for (const [facet, rawFacet] of Object.entries(rawExtensions)) {
            nonBlank(facet, `profiles.${name} extension facet name`);
            extensions[facet] = structuredClone(object(rawFacet, `profiles.${name}.extensions.${facet}`));
        }
        const model = nonBlank(profile.model, `profiles.${name}.model`);
        if (!/^[^/\s]+\/[^/\s]+$/.test(model)) throw new Error(`profiles.${name}.model must use provider/model format`);
        profiles[name] = {
            model,
            thinkingLevel: thinkingLevel as ThinkingLevel | undefined,
            allowAllTools: profile.allowAllTools,
            tools,
            instructions: profile.instructions === undefined ? undefined : nonBlank(profile.instructions, `profiles.${name}.instructions`),
            extensions,
        };
    }

    const defaultProfile = nonBlank(root.defaultProfile, "defaultProfile");
    const profileCycle = stringArray(root.profileCycle, "profileCycle");
    if (!profiles[defaultProfile]) throw new Error(`defaultProfile references unknown profile: ${defaultProfile}`);
    if (profileCycle.length === 0) throw new Error("profileCycle must not be empty");
    if (new Set(profileCycle).size !== profileCycle.length) throw new Error("profileCycle must not contain duplicates");
    for (const name of profileCycle) if (!profiles[name]) throw new Error(`profileCycle references unknown profile: ${name}`);

    return { schemaVersion: 1, defaultProfile, profileCycle, profiles };
}

export function validateResolvedProfile(value: unknown): { name: string; profile: AgentProfile } {
    const root = object(value, "PI_AGENT_RESOLVED_PROFILE");
    exactKeys(root, ["name", "profile"], "PI_AGENT_RESOLVED_PROFILE");
    const name = nonBlank(root.name, "PI_AGENT_RESOLVED_PROFILE.name");
    const config = validateProfileConfig({ schemaVersion: 1, defaultProfile: name, profileCycle: [name], profiles: { [name]: root.profile } });
    return { name, profile: config.profiles[name]! };
}
