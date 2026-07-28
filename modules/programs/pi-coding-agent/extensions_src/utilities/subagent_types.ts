import type { Usage } from "@earendil-works/pi-ai";
import type { AgentProfile } from "./profile_types.ts";

export const SUBAGENT_CONFIG_SCHEMA_VERSION = 2 as const;
export const SUBAGENT_SCHEMA_VERSION = 4 as const;
export const RUN_REQUEST_SCHEMA_VERSION = 4 as const;
export const RESOLVED_RUN_SCHEMA_VERSION = 4 as const;
export const HARNESS_PROTOCOL_VERSION = 1 as const;
export const PURPOSE_MAX_LENGTH = 120;
export const FALLBACK_PURPOSE_MAX_LENGTH = 96;

export const RUN_STATES = ["created", "starting", "running", "stopping", "succeeded", "failed", "stopped"] as const;
export type RunState = (typeof RUN_STATES)[number];
export type TerminalRunState = Extract<RunState, "succeeded" | "failed" | "stopped">;
export type StopMethod = "cooperative" | "forced";
export type FailureCategory = "launch" | "harness" | "protocol" | "runner_lost";

export interface TranscriptCapabilities { assistantText: boolean; toolCalls: boolean; toolResults: boolean; usage: boolean }
export interface HarnessRuntimeConfig { command: string }
export interface SubagentRuntimeConfig {
    schemaVersion: 1 | 2;
    stateRoot: string;
    runner: { node: string; script: string; supervisor?: string; viewer?: string; extensions: string[]; less?: string };
    harnesses: Record<string, HarnessRuntimeConfig> & { pi: HarnessRuntimeConfig };
    maxDepth: number;
}
export interface SubagentFacet { allowedTargets: string[]; harness?: string }
export interface RunLineage { callerProfile: string; targetProfile: string; depth: number; parentRunId?: string; originSessionId: string; originSessionFile?: string }
interface RunRequestBase extends RunLineage { runId: string; profile: string; prompt: string; cwd: string; createdAt: string }
export interface LegacyRunRequest extends RunRequestBase { schemaVersion: 2 | 3; purpose?: string }
export interface CurrentRunRequest extends RunRequestBase { schemaVersion: 4; purpose: string; harness: string }
export type RunRequest = LegacyRunRequest | CurrentRunRequest;
export type NormalizedRunRequest = RunRequestBase & { schemaVersion: 2 | 3 | 4; purpose: string; harness: string };

interface ResolvedRunBase extends RunLineage { runId: string; profile: string; profileSnapshot: AgentProfile; command: string; extensionPaths: string[] }
export type ResolvedRun = (ResolvedRunBase & { schemaVersion: 3 }) | (ResolvedRunBase & {
    schemaVersion: 4; harness: string; adapterProtocolVersion: number; transcriptCapabilities: TranscriptCapabilities;
});
export interface TmuxRunReference { sessionId: string; session: string; windowId: string; paneId: string; windowName: string }
export interface SupervisorClaim { instanceId: string; token: string; claimedAt: string }
export interface WorkerReference { token: string; pid: number; processGroupId: number; startedAt: string }
export interface RunFailure { category: FailureCategory; message: string; exitCode?: number }
interface RunStatusBase { runId: string; profile: string; status: RunState; createdAt: string; startedAt?: string; finishedAt?: string; runnerPid?: number; tmux?: TmuxRunReference; claim?: SupervisorClaim; worker?: WorkerReference; error?: RunFailure; stopRequestedAt?: string }
export type RunStatus =
    | (RunStatusBase & { schemaVersion: 2; status: Exclude<RunState, "stopping" | "stopped"> })
    | (RunStatusBase & RunLineage & { schemaVersion: 3 | 4 });
interface RunResultBase { runId: string; output: string; error: RunFailure | null; usage: Usage; turns: number; startedAt: string; finishedAt: string }
export type RunResult =
    | (RunResultBase & { schemaVersion: 2 | 3 | 4; outcome: "succeeded" | "failed"; stopMethod?: never })
    | (RunResultBase & { schemaVersion: 3 | 4; outcome: "stopped"; stopMethod: StopMethod });
export interface UsageClaim { schemaVersion: 1; originSessionId: string; toolCallId: string; toolName: "subagent_start" | "subagent_get" | "subagent_wait" | "subagent_stop"; runId: string; claimedAt: string }
export type NormalizedEventType = "parent_instruction" | "run_started" | "assistant_text" | "tool_started" | "tool_finished" | "raw_harness_output" | "diagnostic" | "run_finished";
export interface NormalizedEvent { schemaVersion: 2 | 4; sequence: number; timestamp: string; type: NormalizedEventType; data: Record<string, unknown> }
export interface WorkerHeartbeat { schemaVersion: 4; runId: string; workerToken: string; pid: number; updatedAt: string }
export interface SupervisorHeartbeat { schemaVersion: 4; instanceId: string; pid: number; startedAt: string; updatedAt: string }
export interface RunSnapshot { schemaVersion: 3 | 4; runId: string; purpose: string; profile: string; status: RunState; createdAt: string; startedAt?: string; finishedAt?: string; tmux?: TmuxRunReference; claim?: SupervisorClaim; worker?: WorkerReference; runDirectory: string; paths: { events: string; stderr: string; result: string; workerHeartbeat?: string }; accounting: { claimed: boolean; claim?: UsageClaim }; result: RunResult | null }

function object(value: unknown, label: string): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Record<string, unknown>; }
function nonBlank(value: unknown, label: string): string { if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`); return value; }
function stringArray(value: unknown, label: string): string[] { if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item.trim() === "")) throw new Error(`${label} must be an array of non-empty strings`); return [...value] as string[]; }
function compactWhitespace(value: string): string { return value.replace(/\s+/gu, " ").trim(); }
function truncateCharacters(value: string, maximum: number): string { return Array.from(value).slice(0, maximum).join(""); }
export function fallbackRunPurpose(prompt: string): string { const firstLine = prompt.split(/\r?\n/u).map(compactWhitespace).find(line => line.length > 0) ?? compactWhitespace(prompt); return truncateCharacters(firstLine, FALLBACK_PURPOSE_MAX_LENGTH); }
export function validateRunPurpose(purpose: unknown): string { const normalized = typeof purpose === "string" ? compactWhitespace(purpose) : ""; if (!normalized) throw new Error("Subagent purpose must not be empty"); if (Array.from(normalized).length > PURPOSE_MAX_LENGTH) throw new Error(`Subagent purpose must be at most ${PURPOSE_MAX_LENGTH} characters`); return normalized; }
export function normalizeRunRequest(request: RunRequest): NormalizedRunRequest {
    const root = object(request, "Run request");
    if (![2, 3, 4].includes(root.schemaVersion as number)) throw new Error("Unsupported run request schemaVersion");
    if (typeof request.prompt !== "string" || request.prompt.trim() === "") throw new Error("Run request prompt must be a non-empty string");
    if (typeof request.runId !== "string" || typeof request.profile !== "string" || !request.profile.trim()) throw new Error("Run request identity is invalid");
    const purpose = request.schemaVersion === 2 ? fallbackRunPurpose(request.prompt) : validateRunPurpose(request.purpose);
    return { ...request, purpose, harness: request.schemaVersion === 4 ? nonBlank(request.harness, "request.harness") : "pi" } as NormalizedRunRequest;
}
export function validateSubagentRuntimeConfig(value: unknown): SubagentRuntimeConfig {
    const root = object(value, "subagent config"); if (root.schemaVersion !== 1 && root.schemaVersion !== 2) throw new Error("Unsupported subagent config schemaVersion");
    const runner = object(root.runner, "runner"); const harnesses = object(root.harnesses, "harnesses"); const parsedHarnesses: Record<string, HarnessRuntimeConfig> = {};
    for (const [id, raw] of Object.entries(harnesses)) parsedHarnesses[id] = { command: nonBlank(object(raw, `harnesses.${id}`).command, `harnesses.${id}.command`) };
    if (!parsedHarnesses.pi) throw new Error("harnesses.pi must be configured");
    if (!Number.isInteger(root.maxDepth) || (root.maxDepth as number) < 0) throw new Error("maxDepth must be a non-negative integer");
    const extensions = stringArray(runner.extensions, "runner.extensions"); if (!extensions.length) throw new Error("runner.extensions must not be empty");
    const stateRoot = nonBlank(root.stateRoot, "stateRoot"); if (Buffer.byteLength(stateRoot, "utf8") > 4096) throw new Error("stateRoot must be at most 4096 UTF-8 bytes");
    return { schemaVersion: root.schemaVersion as 1 | 2, stateRoot, runner: { node: nonBlank(runner.node, "runner.node"), script: nonBlank(runner.script, "runner.script"), extensions, ...(runner.supervisor ? { supervisor: nonBlank(runner.supervisor, "runner.supervisor") } : {}), ...(runner.viewer ? { viewer: nonBlank(runner.viewer, "runner.viewer") } : {}), ...(runner.less ? { less: nonBlank(runner.less, "runner.less") } : {}) }, harnesses: parsedHarnesses as SubagentRuntimeConfig["harnesses"], maxDepth: root.maxDepth as number };
}
export function parseSubagentFacet(value: unknown): SubagentFacet {
    const facet = object(value, "extensions.subagent"); const unknown = Object.keys(facet).filter(key => key !== "allowedTargets" && key !== "harness"); if (unknown.length) throw new Error(`extensions.subagent contains unknown keys: ${unknown.join(", ")}`);
    const allowedTargets = stringArray(facet.allowedTargets, "extensions.subagent.allowedTargets"); if (new Set(allowedTargets).size !== allowedTargets.length) throw new Error("extensions.subagent.allowedTargets must not contain duplicates");
    return { allowedTargets, harness: facet.harness === undefined ? "pi" : nonBlank(facet.harness, "extensions.subagent.harness") };
}
export function emptyUsage(): Usage { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }; }
export function addUsage(target: Usage, usage: Partial<Usage> | undefined): void { if (!usage) return; for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) target[key] += usage[key] ?? 0; if (usage.reasoning !== undefined) target.reasoning = (target.reasoning ?? 0) + usage.reasoning; if (usage.cacheWrite1h !== undefined) target.cacheWrite1h = (target.cacheWrite1h ?? 0) + usage.cacheWrite1h; for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) target.cost[key] += usage.cost?.[key] ?? 0; }
export function isTerminalState(state: RunState): state is TerminalRunState { return state === "succeeded" || state === "failed" || state === "stopped"; }
