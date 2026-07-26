export const SUBAGENT_SCHEMA_VERSION = 1 as const;

export const RUN_STATES = ["created", "starting", "running", "succeeded", "failed"] as const;
export type RunState = (typeof RUN_STATES)[number];
export type TerminalRunState = Extract<RunState, "succeeded" | "failed">;
export type FailureCategory = "launch" | "harness" | "protocol" | "runner_lost";

export interface SubagentProfile {
    harness: "pi";
    model: string;
    thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
    tools?: string[];
}

export interface SubagentRuntimeConfig {
    schemaVersion: 1;
    stateRoot: string;
    runner: { node: string; script: string };
    harnesses: { pi: { command: string } };
    profiles: Record<string, SubagentProfile>;
}

export interface RunRequest {
    schemaVersion: 1;
    runId: string;
    profile: string;
    prompt: string;
    cwd: string;
    createdAt: string;
}

export interface ResolvedRun {
    schemaVersion: 1;
    runId: string;
    profile: string;
    harness: "pi";
    model: string;
    thinkingLevel?: SubagentProfile["thinkingLevel"];
    tools?: string[];
    command: string;
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
    schemaVersion: 1;
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

export interface NormalizedUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
    turns: number;
}

export interface RunResult {
    schemaVersion: 1;
    runId: string;
    outcome: TerminalRunState;
    output: string;
    error: RunFailure | null;
    usage: NormalizedUsage;
    startedAt: string;
    finishedAt: string;
}

export type NormalizedEventType =
    | "run_started"
    | "assistant_text"
    | "tool_started"
    | "tool_finished"
    | "diagnostic"
    | "run_finished";

export interface NormalizedEvent {
    schemaVersion: 1;
    sequence: number;
    timestamp: string;
    type: NormalizedEventType;
    data: Record<string, unknown>;
}

export interface RunSnapshot {
    schemaVersion: 1;
    runId: string;
    profile: string;
    status: RunState;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    tmux?: TmuxRunReference;
    runDirectory: string;
    paths: { events: string; stderr: string };
    result: RunResult | null;
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function nonBlank(value: unknown, label: string): string {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
    return value;
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item.trim() === "")) {
        throw new Error(`${label} must be an array of non-empty strings`);
    }
    return [...value] as string[];
}

export function validateRuntimeConfig(value: unknown): SubagentRuntimeConfig {
    const root = object(value, "subagent config");
    if (root.schemaVersion !== SUBAGENT_SCHEMA_VERSION) throw new Error("Unsupported subagent config schemaVersion");
    const runner = object(root.runner, "runner");
    const harnesses = object(root.harnesses, "harnesses");
    const pi = object(harnesses.pi, "harnesses.pi");
    const rawProfiles = object(root.profiles, "profiles");
    const profiles: Record<string, SubagentProfile> = {};
    const thinkingLevels = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

    for (const [name, rawProfile] of Object.entries(rawProfiles)) {
        nonBlank(name, "profile name");
        const profile = object(rawProfile, `profiles.${name}`);
        if (profile.harness !== "pi") throw new Error(`profiles.${name}.harness is unsupported`);
        const thinkingLevel = profile.thinkingLevel;
        if (thinkingLevel !== undefined && (typeof thinkingLevel !== "string" || !thinkingLevels.has(thinkingLevel))) {
            throw new Error(`profiles.${name}.thinkingLevel is invalid`);
        }
        profiles[name] = {
            harness: "pi",
            model: nonBlank(profile.model, `profiles.${name}.model`),
            thinkingLevel: thinkingLevel as SubagentProfile["thinkingLevel"],
            tools: optionalStringArray(profile.tools, `profiles.${name}.tools`),
        };
    }

    return {
        schemaVersion: 1,
        stateRoot: nonBlank(root.stateRoot, "stateRoot"),
        runner: {
            node: nonBlank(runner.node, "runner.node"),
            script: nonBlank(runner.script, "runner.script"),
        },
        harnesses: { pi: { command: nonBlank(pi.command, "harnesses.pi.command") } },
        profiles,
    };
}

export function resolveProfile(config: SubagentRuntimeConfig, name: string, runId: string): ResolvedRun {
    const profile = config.profiles[name];
    if (!profile) throw new Error(`Unknown subagent profile: ${name}`);
    return {
        schemaVersion: 1,
        runId,
        profile: name,
        harness: profile.harness,
        model: profile.model,
        thinkingLevel: profile.thinkingLevel,
        tools: profile.tools,
        command: config.harnesses.pi.command,
    };
}

export function emptyUsage(): NormalizedUsage {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, turns: 0 };
}

export function isTerminalState(state: RunState): state is TerminalRunState {
    return state === "succeeded" || state === "failed";
}
