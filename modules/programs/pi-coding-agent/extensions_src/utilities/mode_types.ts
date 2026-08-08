export const MODE_SCHEMA_VERSION = 1 as const;
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentMode {
    model: string;
    description: string;
    thinkingLevel: ThinkingLevel;
    allowAllTools: boolean;
    tools: string[];
    skillOptIns: string[];
    instructions: string;
}
export interface AgentModeConfig { schemaVersion: 1; defaultMode: string; modes: Record<string, AgentMode> }

function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
    const unknown = Object.keys(value).filter(key => !keys.includes(key));
    if (unknown.length) throw new Error(`${label} contains unknown keys: ${unknown.join(", ")}`);
}
function text(value: unknown, label: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
    return value;
}
function strings(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) throw new Error(`${label} must be an array of non-empty strings`);
    const result = [...value] as string[];
    if (new Set(result).size !== result.length) throw new Error(`${label} must not contain duplicates`);
    return result;
}
export function validateModeConfig(value: unknown): AgentModeConfig {
    const root = object(value, "agent mode config");
    exact(root, ["schemaVersion", "defaultMode", "modes"], "agent mode config");
    if (root.schemaVersion !== MODE_SCHEMA_VERSION) throw new Error("Unsupported agent mode config schemaVersion");
    const rawModes = object(root.modes, "modes");
    const modes: Record<string, AgentMode> = {};
    const levels = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
    for (const [name, raw] of Object.entries(rawModes)) {
        text(name, "mode name");
        const mode = object(raw, `modes.${name}`);
        exact(mode, ["model", "description", "thinkingLevel", "allowAllTools", "tools", "skillOptIns", "instructions"], `modes.${name}`);
        const model = text(mode.model, `modes.${name}.model`);
        if (!/^[^/\s]+\/[^/\s]+$/u.test(model)) throw new Error(`modes.${name}.model must use provider/model format`);
        if (!levels.has(String(mode.thinkingLevel))) throw new Error(`modes.${name}.thinkingLevel is invalid`);
        if (typeof mode.allowAllTools !== "boolean") throw new Error(`modes.${name}.allowAllTools must be boolean`);
        const tools = strings(mode.tools, `modes.${name}.tools`);
        if (mode.allowAllTools && tools.length) throw new Error(`modes.${name} cannot set tools when allowAllTools is true`);
        modes[name] = { model, description: text(mode.description, `modes.${name}.description`), thinkingLevel: mode.thinkingLevel as ThinkingLevel, allowAllTools: mode.allowAllTools, tools, skillOptIns: strings(mode.skillOptIns, `modes.${name}.skillOptIns`), instructions: text(mode.instructions, `modes.${name}.instructions`) };
    }
    const defaultMode = text(root.defaultMode, "defaultMode");
    if (!modes[defaultMode]) throw new Error(`defaultMode references unknown mode: ${defaultMode}`);
    return { schemaVersion: 1, defaultMode, modes };
}
