import type { Usage } from "@earendil-works/pi-ai";
import type { AgentProfile } from "./profile_types.ts";

export const SUBAGENT_CONFIG_SCHEMA_VERSION = 1 as const;
export const SUBAGENT_SCHEMA_VERSION = 2 as const;
export const RESOLVED_RUN_SCHEMA_VERSION = 3 as const;

export const RUN_STATES = ["created", "starting", "running", "succeeded", "failed"] as const;
export type RunState = (typeof RUN_STATES)[number];
export type TerminalRunState = Extract<RunState, "succeeded" | "failed">;
export type FailureCategory = "launch" | "harness" | "protocol" | "runner_lost";

export interface SubagentRuntimeConfig {
    schemaVersion: 1;
    stateRoot: string;
    runner: { node: string; script: string; extensions: string[] };
    harnesses: { pi: { command: string } };
    maxDepth: number;
}

export interface SubagentFacet {
    allowedTargets: string[];
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
    schemaVersion: 3;
    runId: string;
    profile: string;
    profileSnapshot: AgentProfile;
    command: string;
    extensionPaths: string[];
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

export type NormalizedEventType = "run_started" | "assistant_text" | "tool_started" | "tool_finished" | "diagnostic" | "run_finished";
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
    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item.trim() === "")) throw new Error(`${label} must be an array of non-empty strings`);
    return [...value] as string[];
}

export function validateSubagentRuntimeConfig(value: unknown): SubagentRuntimeConfig {
    const root = object(value, "subagent config");
    if (root.schemaVersion !== SUBAGENT_CONFIG_SCHEMA_VERSION) throw new Error("Unsupported subagent config schemaVersion");
    const runner = object(root.runner, "runner");
    const harnesses = object(root.harnesses, "harnesses");
    const pi = object(harnesses.pi, "harnesses.pi");
    if (!Number.isInteger(root.maxDepth) || (root.maxDepth as number) < 0) throw new Error("maxDepth must be a non-negative integer");
    const extensions = stringArray(runner.extensions, "runner.extensions");
    if (extensions.length === 0) throw new Error("runner.extensions must not be empty");
    const stateRoot = nonBlank(root.stateRoot, "stateRoot");
    if (Buffer.byteLength(stateRoot, "utf8") > 4096) throw new Error("stateRoot must be at most 4096 UTF-8 bytes");
    return {
        schemaVersion: 1,
        stateRoot,
        runner: { node: nonBlank(runner.node, "runner.node"), script: nonBlank(runner.script, "runner.script"), extensions },
        harnesses: { pi: { command: nonBlank(pi.command, "harnesses.pi.command") } },
        maxDepth: root.maxDepth as number,
    };
}

export function parseSubagentFacet(value: unknown): SubagentFacet {
    const facet = object(value, "extensions.subagent");
    const unknown = Object.keys(facet).filter(key => key !== "allowedTargets");
    if (unknown.length > 0) throw new Error(`extensions.subagent contains unknown keys: ${unknown.join(", ")}`);
    const allowedTargets = stringArray(facet.allowedTargets, "extensions.subagent.allowedTargets");
    if (new Set(allowedTargets).size !== allowedTargets.length) throw new Error("extensions.subagent.allowedTargets must not contain duplicates");
    return { allowedTargets };
}

export function emptyUsage(): Usage {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}
export function addUsage(target: Usage, usage: Partial<Usage> | undefined): void {
    if (!usage) return;
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) target[key] += usage[key] ?? 0;
    if (usage.reasoning !== undefined) target.reasoning = (target.reasoning ?? 0) + usage.reasoning;
    if (usage.cacheWrite1h !== undefined) target.cacheWrite1h = (target.cacheWrite1h ?? 0) + usage.cacheWrite1h;
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) target.cost[key] += usage.cost?.[key] ?? 0;
}
export function isTerminalState(state: RunState): state is TerminalRunState { return state === "succeeded" || state === "failed"; }
