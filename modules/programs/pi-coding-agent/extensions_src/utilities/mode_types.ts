export const MODE_SCHEMA_VERSION = 4 as const;
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ExecutionHarness = "pi" | "cursor-agent" | "codex";

export interface ExecutionConfig {
    models: string[];
    thinkingLevel?: ThinkingLevel;
    harness: ExecutionHarness;
    harnessOptions?: Record<string, unknown>;
}
export interface AgentMode {
    description: string;
    tools: string[];
    skillOptIns: string[];
    instructions: string;
}
export interface AgentModeConfig { schemaVersion: 4; defaultMode: string; execution: ExecutionConfig; modes: Record<string, AgentMode> }

const cursorCommonHarnessOptions = { sandbox: "disabled", trustWorkspace: true, worktree: false } as const;
export const CURSOR_READ_HARNESS_OPTIONS = Object.freeze({ mode: "ask", permissionPolicy: "reject", ...cursorCommonHarnessOptions });
export const CURSOR_WRITE_HARNESS_OPTIONS = Object.freeze({ mode: "agent", permissionPolicy: "allow-always", ...cursorCommonHarnessOptions });
function matchesExactOptions(actual: Record<string, unknown> | undefined, expected: Record<string, unknown>): boolean { return Boolean(actual && Object.keys(actual).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => actual[key] === value)); }
export function isApprovedCursorHarnessOptions(value: Record<string, unknown> | undefined): boolean { return matchesExactOptions(value, CURSOR_READ_HARNESS_OPTIONS) || matchesExactOptions(value, CURSOR_WRITE_HARNESS_OPTIONS); }

const levels = new Set<unknown>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
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
function models(value: unknown, label: string): string[] {
    const result = strings(value, label);
    if (!result.length) throw new Error(`${label} must not be empty`);
    for (const [index, candidate] of result.entries()) if (!/^[^/\s]+\/\S+$/u.test(candidate)) throw new Error(`${label}[${index}] must use provider/model format`);
    return result;
}
function thinkingLevel(value: unknown, label: string): ThinkingLevel {
    if (!levels.has(value)) throw new Error(`${label} is invalid`);
    return value as ThinkingLevel;
}

const CODEX_HARNESS_OPTIONS = { mode: "read-only", permissionPolicy: "reject", webSearch: "cached" } as const;

export function validateExecutionConfig(value: unknown, label = "execution"): ExecutionConfig {
    const profile = object(value, label);
    exact(profile, ["models", "thinkingLevel", "harness", "harnessOptions"], label);
    const harness = profile.harness;
    if (harness !== "pi" && harness !== "cursor-agent" && harness !== "codex") throw new Error(`${label}.harness is invalid`);
    const resolvedModels = models(profile.models, `${label}.models`);
    const resolvedThinking = profile.thinkingLevel === undefined ? undefined : thinkingLevel(profile.thinkingLevel, `${label}.thinkingLevel`);
    const harnessOptions = profile.harnessOptions === undefined ? undefined : object(profile.harnessOptions, `${label}.harnessOptions`);
    if (harness === "pi" && (resolvedThinking === undefined || harnessOptions !== undefined)) throw new Error(`${label} pi execution requires thinkingLevel and no harnessOptions`);
    if (harness === "cursor-agent") {
        if (resolvedModels.length !== 1 || !resolvedModels[0]!.startsWith("cursor/") || resolvedThinking !== undefined || harnessOptions === undefined) throw new Error(`${label} cursor-agent execution requires exactly one cursor model, no thinkingLevel, and harnessOptions`);
        if (!isApprovedCursorHarnessOptions(harnessOptions)) throw new Error(`${label} cursor-agent execution requires an approved read or write harnessOptions combination`);
    }
    if (harness === "codex") {
        if (resolvedModels.length !== 1 || !resolvedModels[0]!.startsWith("codex/") || resolvedThinking === undefined || harnessOptions === undefined) throw new Error(`${label} codex execution requires exactly one codex model, thinkingLevel, and harnessOptions`);
        if (!matchesExactOptions(harnessOptions, CODEX_HARNESS_OPTIONS)) throw new Error(`${label} codex execution requires exact read-only cached harnessOptions`);
    }
    return { models: resolvedModels, ...(resolvedThinking === undefined ? {} : { thinkingLevel: resolvedThinking }), harness, ...(harnessOptions === undefined ? {} : { harnessOptions }) };
}

export function validateModeConfig(value: unknown): AgentModeConfig {
    const root = object(value, "agent mode config");
    exact(root, ["schemaVersion", "defaultMode", "execution", "modes"], "agent mode config");
    if (root.schemaVersion !== MODE_SCHEMA_VERSION) throw new Error("Unsupported agent mode config schemaVersion");
    const execution = validateExecutionConfig(root.execution, "execution");
    if (execution.harness !== "pi") throw new Error("execution must use the pi harness");
    const rawModes = object(root.modes, "modes");
    const modes: Record<string, AgentMode> = {};
    for (const [name, raw] of Object.entries(rawModes)) {
        text(name, "mode name");
        const mode = object(raw, `modes.${name}`);
        exact(mode, ["description", "tools", "skillOptIns", "instructions"], `modes.${name}`);
        modes[name] = {
            description: text(mode.description, `modes.${name}.description`),
            tools: strings(mode.tools, `modes.${name}.tools`),
            skillOptIns: strings(mode.skillOptIns, `modes.${name}.skillOptIns`),
            instructions: text(mode.instructions, `modes.${name}.instructions`),
        };
    }
    const defaultMode = text(root.defaultMode, "defaultMode");
    if (!modes[defaultMode]) throw new Error(`defaultMode references unknown mode: ${defaultMode}`);
    return { schemaVersion: MODE_SCHEMA_VERSION, defaultMode, execution, modes };
}
