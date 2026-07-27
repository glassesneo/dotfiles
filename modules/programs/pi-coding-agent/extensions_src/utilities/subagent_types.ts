import type { Usage } from "@earendil-works/pi-ai";

export const SUBAGENT_SCHEMA_VERSION = 2 as const;

export const RUN_STATES = ["created", "starting", "running", "succeeded", "failed"] as const;
export type RunState = (typeof RUN_STATES)[number];
export type TerminalRunState = Extract<RunState, "succeeded" | "failed">;
export type FailureCategory = "launch" | "harness" | "protocol" | "runner_lost";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentProfile {
    harness: "pi";
    model: string;
    thinkingLevel?: ThinkingLevel;
    allowAllTools: boolean;
    tools: string[];
    allowedSubagents: string[];
    instructions?: string;
}

export interface SubagentRuntimeConfig {
    schemaVersion: 2;
    stateRoot: string;
    runner: { node: string; script: string; extension: string };
    harnesses: { pi: { command: string } };
    defaultProfile: string;
    profileCycle: string[];
    maxDepth: number;
    profiles: Record<string, AgentProfile>;
}

export interface RunLineage {
    callerProfile: string;
    targetProfile: string;
    depth: number;
    parentRunId?: string;
    originSessionId: string;
    originSessionFile?: string;
}

export interface RunRequest extends RunLineage {
    schemaVersion: 2;
    runId: string;
    profile: string;
    prompt: string;
    cwd: string;
    createdAt: string;
}

export interface ResolvedRun extends RunLineage {
    schemaVersion: 2;
    runId: string;
    profile: string;
    harness: "pi";
    model: string;
    thinkingLevel?: ThinkingLevel;
    allowAllTools: boolean;
    tools: string[];
    allowedSubagents: string[];
    instructions?: string;
    command: string;
    extension: string;
}

export interface TmuxRunReference {
    sessionId: string;
    session: string;
    windowId: string;
    paneId: string;
    windowName: string;
}

export interface RunFailure {
    category: FailureCategory;
    message: string;
    exitCode?: number;
}

export interface RunStatus {
    schemaVersion: 2;
    runId: string;
    profile: string;
    status: RunState;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    runnerPid?: number;
    tmux?: TmuxRunReference;
    error?: RunFailure;
}

export interface RunResult {
    schemaVersion: 2;
    runId: string;
    outcome: TerminalRunState;
    output: string;
    error: RunFailure | null;
    usage: Usage;
    turns: number;
    startedAt: string;
    finishedAt: string;
}

export interface UsageClaim {
    schemaVersion: 1;
    originSessionId: string;
    toolCallId: string;
    toolName: "subagent_start" | "subagent_get" | "subagent_wait";
    runId: string;
    claimedAt: string;
}

export type NormalizedEventType =
    | "run_started"
    | "assistant_text"
    | "tool_started"
    | "tool_finished"
    | "diagnostic"
    | "run_finished";

export interface NormalizedEvent {
    schemaVersion: 2;
    sequence: number;
    timestamp: string;
    type: NormalizedEventType;
    data: Record<string, unknown>;
}

export interface RunSnapshot {
    schemaVersion: 2;
    runId: string;
    profile: string;
    status: RunState;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    tmux?: TmuxRunReference;
    runDirectory: string;
    paths: { events: string; stderr: string; result: string };
    accounting: { claimed: boolean; claim?: UsageClaim };
    result: RunResult | null;
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value as Record<string, unknown>;
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

export function validateRuntimeConfig(value: unknown): SubagentRuntimeConfig {
    const root = object(value, "agent profile config");
    if (root.schemaVersion !== SUBAGENT_SCHEMA_VERSION) throw new Error("Unsupported agent profile config schemaVersion");
    const runner = object(root.runner, "runner");
    const harnesses = object(root.harnesses, "harnesses");
    const pi = object(harnesses.pi, "harnesses.pi");
    const rawProfiles = object(root.profiles, "profiles");
    const profiles: Record<string, AgentProfile> = {};
    const thinkingLevels = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

    for (const [name, rawProfile] of Object.entries(rawProfiles)) {
        nonBlank(name, "profile name");
        const profile = object(rawProfile, `profiles.${name}`);
        if (profile.harness !== "pi") throw new Error(`profiles.${name}.harness is unsupported`);
        const thinkingLevel = profile.thinkingLevel;
        if (thinkingLevel !== undefined && (typeof thinkingLevel !== "string" || !thinkingLevels.has(thinkingLevel))) {
            throw new Error(`profiles.${name}.thinkingLevel is invalid`);
        }
        if (typeof profile.allowAllTools !== "boolean") throw new Error(`profiles.${name}.allowAllTools must be boolean`);
        const tools = stringArray(profile.tools, `profiles.${name}.tools`);
        if (profile.allowAllTools && tools.length > 0) throw new Error(`profiles.${name} cannot set tools when allowAllTools is true`);
        profiles[name] = {
            harness: "pi",
            model: nonBlank(profile.model, `profiles.${name}.model`),
            thinkingLevel: thinkingLevel as ThinkingLevel | undefined,
            allowAllTools: profile.allowAllTools,
            tools,
            allowedSubagents: stringArray(profile.allowedSubagents, `profiles.${name}.allowedSubagents`),
            instructions: profile.instructions === undefined ? undefined : nonBlank(profile.instructions, `profiles.${name}.instructions`),
        };
    }

    const defaultProfile = nonBlank(root.defaultProfile, "defaultProfile");
    const profileCycle = stringArray(root.profileCycle, "profileCycle");
    if (!Number.isInteger(root.maxDepth) || (root.maxDepth as number) < 0) throw new Error("maxDepth must be a non-negative integer");
    if (!profiles[defaultProfile]) throw new Error(`defaultProfile references unknown profile: ${defaultProfile}`);
    if (new Set(profileCycle).size !== profileCycle.length) throw new Error("profileCycle must not contain duplicates");
    for (const name of profileCycle) if (!profiles[name]) throw new Error(`profileCycle references unknown profile: ${name}`);
    for (const [name, profile] of Object.entries(profiles)) {
        for (const target of profile.allowedSubagents) {
            if (!profiles[target]) throw new Error(`profiles.${name}.allowedSubagents references unknown profile: ${target}`);
        }
    }

    const stateRoot = nonBlank(root.stateRoot, "stateRoot");
    if (Buffer.byteLength(stateRoot, "utf8") > 4096) throw new Error("stateRoot must be at most 4096 UTF-8 bytes");

    return {
        schemaVersion: 2,
        stateRoot,
        runner: {
            node: nonBlank(runner.node, "runner.node"),
            script: nonBlank(runner.script, "runner.script"),
            extension: nonBlank(runner.extension, "runner.extension"),
        },
        harnesses: { pi: { command: nonBlank(pi.command, "harnesses.pi.command") } },
        defaultProfile,
        profileCycle,
        maxDepth: root.maxDepth as number,
        profiles,
    };
}

export function emptyUsage(): Usage {
    return {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
}

export function addUsage(target: Usage, usage: Partial<Usage> | undefined): void {
    if (!usage) return;
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) target[key] += usage[key] ?? 0;
    if (usage.reasoning !== undefined) target.reasoning = (target.reasoning ?? 0) + usage.reasoning;
    if (usage.cacheWrite1h !== undefined) target.cacheWrite1h = (target.cacheWrite1h ?? 0) + usage.cacheWrite1h;
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) target.cost[key] += usage.cost?.[key] ?? 0;
}

export function isTerminalState(state: RunState): state is TerminalRunState {
    return state === "succeeded" || state === "failed";
}
