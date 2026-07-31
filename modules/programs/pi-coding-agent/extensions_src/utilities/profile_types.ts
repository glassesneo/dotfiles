export const PROFILE_SCHEMA_VERSION = 3 as const;
export const PROFILE_DESCRIPTION_MAX_BYTES = 512;

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ProfileFacet = Record<string, unknown>;
export type ProfileAvailability = "top-level" | "subagent";

export interface AgentProfile {
    model: string;
    availability: ProfileAvailability[];
    description: string;
    thinkingLevel?: ThinkingLevel;
    allowAllTools: boolean;
    tools: string[];
    instructions?: string;
    extensions: Record<string, ProfileFacet>;
}

export interface AgentProfileConfig {
    schemaVersion: 3;
    defaultProfile: string;
    profileCycle: string[];
    promptRoutes: Record<string, string>;
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
    exactKeys(root, ["schemaVersion", "defaultProfile", "profileCycle", "promptRoutes", "profiles"], "agent profile config");
    if (root.schemaVersion !== PROFILE_SCHEMA_VERSION) throw new Error("Unsupported agent profile config schemaVersion");
    const rawProfiles = object(root.profiles, "profiles");
    const profiles: Record<string, AgentProfile> = {};
    const thinkingLevels = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

    for (const [name, rawProfile] of Object.entries(rawProfiles)) {
        nonBlank(name, "profile name");
        const profile = object(rawProfile, `profiles.${name}`);
        exactKeys(profile, ["model", "availability", "description", "thinkingLevel", "allowAllTools", "tools", "instructions", "extensions"], `profiles.${name}`);
        const availability = stringArray(profile.availability, `profiles.${name}.availability`) as ProfileAvailability[];
        if (availability.length === 0) throw new Error(`profiles.${name}.availability must not be empty`);
        if (new Set(availability).size !== availability.length) throw new Error(`profiles.${name}.availability must not contain duplicates`);
        if (availability.some(value => value !== "top-level" && value !== "subagent")) throw new Error(`profiles.${name}.availability is invalid`);
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
        const description = nonBlank(profile.description, `profiles.${name}.description`);
        if (Buffer.byteLength(description, "utf8") > PROFILE_DESCRIPTION_MAX_BYTES) {
            throw new Error(`profiles.${name}.description must be at most ${PROFILE_DESCRIPTION_MAX_BYTES} UTF-8 bytes`);
        }
        profiles[name] = {
            model,
            availability,
            description,
            thinkingLevel: thinkingLevel as ThinkingLevel | undefined,
            allowAllTools: profile.allowAllTools,
            tools,
            instructions: profile.instructions === undefined ? undefined : nonBlank(profile.instructions, `profiles.${name}.instructions`),
            extensions,
        };
    }

    const defaultProfile = nonBlank(root.defaultProfile, "defaultProfile");
    const profileCycle = stringArray(root.profileCycle, "profileCycle");
    const rawPromptRoutes = object(root.promptRoutes, "promptRoutes");
    const promptRoutes: Record<string, string> = {};
    for (const [command, target] of Object.entries(rawPromptRoutes)) {
        nonBlank(command, "promptRoutes command");
        if (/[/\s]/u.test(command)) throw new Error(`promptRoutes command must be one command token: ${command}`);
        promptRoutes[command] = nonBlank(target, `promptRoutes.${command}`);
    }
    if (!profiles[defaultProfile]) throw new Error(`defaultProfile references unknown profile: ${defaultProfile}`);
    if (!profiles[defaultProfile].availability.includes("top-level")) throw new Error(`defaultProfile must reference a top-level profile: ${defaultProfile}`);
    if (profileCycle.length === 0) throw new Error("profileCycle must not be empty");
    if (new Set(profileCycle).size !== profileCycle.length) throw new Error("profileCycle must not contain duplicates");
    for (const name of profileCycle) {
        if (!profiles[name]) throw new Error(`profileCycle references unknown profile: ${name}`);
        if (!profiles[name].availability.includes("top-level")) throw new Error(`profileCycle must reference top-level profiles: ${name}`);
    }
    for (const [command, target] of Object.entries(promptRoutes)) {
        if (!profiles[target]) throw new Error(`promptRoutes.${command} references unknown profile: ${target}`);
        if (!profiles[target].availability.includes("top-level")) throw new Error(`promptRoutes.${command} must reference a top-level profile: ${target}`);
    }

    return { schemaVersion: 3, defaultProfile, profileCycle, promptRoutes, profiles };
}

export function validateResolvedProfile(value: unknown): { name: string; profile: AgentProfile } {
    const root = object(value, "PI_AGENT_RESOLVED_PROFILE");
    exactKeys(root, ["name", "profile"], "PI_AGENT_RESOLVED_PROFILE");
    const name = nonBlank(root.name, "PI_AGENT_RESOLVED_PROFILE.name");
    const profileRoot = object(root.profile, "PI_AGENT_RESOLVED_PROFILE.profile");
    const synthetic = structuredClone(profileRoot);
    synthetic.availability = ["top-level", "subagent"];
    const config = validateProfileConfig({ schemaVersion: 3, defaultProfile: name, profileCycle: [name], promptRoutes: {}, profiles: { [name]: synthetic } });
    const availability = stringArray(profileRoot.availability, "PI_AGENT_RESOLVED_PROFILE.profile.availability") as ProfileAvailability[];
    if (availability.length === 0 || new Set(availability).size !== availability.length || availability.some(value => value !== "top-level" && value !== "subagent")) throw new Error("PI_AGENT_RESOLVED_PROFILE.profile.availability is invalid");
    const profile = { ...config.profiles[name]!, availability };
    if (!profile.availability.includes("subagent")) throw new Error("PI_AGENT_RESOLVED_PROFILE.profile must be available to subagents");
    return { name, profile };
}
