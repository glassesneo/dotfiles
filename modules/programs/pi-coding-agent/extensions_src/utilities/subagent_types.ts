import type { Usage } from "@earendil-works/pi-ai";
import type { AgentProfile } from "./profile_types.ts";

export const PURPOSE_MAX_LENGTH = 120;
export const AGENT_STATES = ["creating", "idle", "busy", "stopping", "stopped", "failed"] as const;
export const TASK_STATES = ["created", "running", "succeeded", "failed", "stopped"] as const;
export type AgentState = (typeof AGENT_STATES)[number];
export type TaskState = (typeof TASK_STATES)[number];
export type TerminalTaskState = Extract<TaskState, "succeeded" | "failed" | "stopped">;
export type TmuxOwnership = "origin-hub" | "dedicated";
export interface TmuxAgentReference { socket: string; serverPid: string; sessionId: string; sessionName: string; windowId: string; paneId: string; windowName: string }
export interface NativeCapabilities { nativeScreen: boolean; taskDelivery: boolean; taskCompletion: boolean; usage: boolean; interactiveInterventions: boolean; terminalHistory?: boolean }
export type HarnessAdapterKind = "pi-native" | "cursor-acp";
export interface HarnessRuntimeConfig { adapter: HarnessAdapterKind; command: string; workerCommand?: string; workerEntrypoint?: string }
export interface SubagentRuntimeConfig { schemaVersion: 7; stateRoot: string; tmux: string; historyViewerExtension: string; childExtensions: string[]; harnesses: Record<string, HarnessRuntimeConfig> & { pi: HarnessRuntimeConfig }; maxDepth: number; childExcludedTools: string[]; natureHandleWords: string[]; bridgeReadyTimeoutMs?: number }
export interface SubagentFacet { allowedTargets: string[]; harness?: string; harnessOptions?: Record<string, unknown> }
export interface AgentLineage { callerProfile: string; targetProfile: string; depth: number; parentAgentId?: string; originSessionId: string; originSessionFile?: string }
export interface AgentRecord extends AgentLineage { schemaVersion: 1; agentId: string; profile: string; purpose: string; harness: string; cwd: string; createdAt: string; profileSnapshot: AgentProfile; tmux: TmuxAgentReference; tmuxOwnership?: TmuxOwnership; capabilities: NativeCapabilities }
export interface AgentStatus { schemaVersion: 1; agentId: string; state: AgentState; activeTaskId?: string; latestTaskId?: string; bridgeReady: boolean; childSessionId?: string; childSessionFile?: string; agentUsage: Usage; accountedTaskIds: string[]; updatedAt: string; exitReason?: string }
export interface TaskRequest { schemaVersion: 1; agentId: string; taskId: string; purpose: string; prompt: string; createdAt: string }
export interface Intervention { sequence: number; timestamp: string; taskId?: string; text: string; deliveryMode: "steer" | "followUp" | "idle"; images: string[] }
export interface TaskStatus { schemaVersion: 1; agentId: string; taskId: string; state: TaskState; createdAt: string; startedAt?: string; finishedAt?: string; error?: string }
export interface TaskResult { schemaVersion: 1; agentId: string; taskId: string; outcome: TerminalTaskState; output: string; usage: Usage; turns: number; interventions: Intervention[]; startedAt: string; finishedAt: string; error?: string }
export interface UsageClaim { schemaVersion: 1; originSessionId: string; parentSessionFile?: string; toolCallId: string; toolName: "subagent_submit" | "subagent_start" | "subagent_get" | "subagent_wait" | "subagent_stop"; agentId: string; taskId: string; claimedAt: string }
export interface AgentSnapshot { agent: AgentRecord; status: AgentStatus; task?: TaskSnapshot }
export interface TaskSnapshot { request: TaskRequest; status: TaskStatus; result: TaskResult | null; interventions: Intervention[]; claimed: boolean; directory: string }

function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Record<string, unknown>; }
function nonBlank(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`); return value; }
function strings(value: unknown, label: string): string[] { if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) throw new Error(`${label} must be an array of non-empty strings`); return [...value] as string[]; }
export function validateRunPurpose(value: unknown): string { const purpose = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : ""; if (!purpose) throw new Error("Subagent purpose must not be empty"); if (Array.from(purpose).length > PURPOSE_MAX_LENGTH) throw new Error(`Subagent purpose must be at most ${PURPOSE_MAX_LENGTH} characters`); return purpose; }
export function fallbackRunPurpose(prompt: string): string { return Array.from(prompt.split(/\r?\n/u).map(line => line.replace(/\s+/gu, " ").trim()).find(Boolean) ?? "Task").slice(0, 96).join(""); }
export function validateNatureHandleWords(value: unknown): string[] {
    const words = strings(value, "natureHandleWords");
    if (words.length === 0) throw new Error("natureHandleWords must not be empty");
    if (new Set(words).size !== words.length) throw new Error("natureHandleWords must not contain duplicates");
    if (words.some(word => word.includes("-"))) throw new Error("natureHandleWords must not contain '-'");
    return words;
}
export function validateSubagentRuntimeConfig(value: unknown): SubagentRuntimeConfig {
    const root = object(value, "subagent config");
    if (root.schemaVersion !== 7) throw new Error("Unsupported subagent config schemaVersion");
    const harnesses = object(root.harnesses, "harnesses");
    const parsed: Record<string, HarnessRuntimeConfig> = {};
    for (const [id, raw] of Object.entries(harnesses)) {
        const entry = object(raw, `harnesses.${id}`);
        const unknown = Object.keys(entry).filter(key => !["adapter", "command", "workerCommand", "workerEntrypoint"].includes(key));
        if (unknown.length) throw new Error(`harnesses.${id} contains unknown keys: ${unknown.join(", ")}`);
        const adapter = nonBlank(entry.adapter, `harnesses.${id}.adapter`);
        if (adapter !== "pi-native" && adapter !== "cursor-acp") throw new Error(`harnesses.${id}.adapter is unknown: ${adapter}`);
        const workerCommand = entry.workerCommand === undefined ? undefined : nonBlank(entry.workerCommand, `harnesses.${id}.workerCommand`);
        const workerEntrypoint = entry.workerEntrypoint === undefined ? undefined : nonBlank(entry.workerEntrypoint, `harnesses.${id}.workerEntrypoint`);
        if (adapter === "cursor-acp" && (!workerCommand || !workerEntrypoint)) throw new Error(`harnesses.${id} cursor-acp adapter requires workerCommand and workerEntrypoint`);
        parsed[id] = { adapter, command: nonBlank(entry.command, `harnesses.${id}.command`), ...(workerCommand ? { workerCommand } : {}), ...(workerEntrypoint ? { workerEntrypoint } : {}) } as HarnessRuntimeConfig;
    }
    if (!parsed.pi || parsed.pi.adapter !== "pi-native") throw new Error("harnesses.pi must use the pi-native adapter");
    if (!Number.isInteger(root.maxDepth) || (root.maxDepth as number) < 0) throw new Error("maxDepth must be a non-negative integer");
    const childExcludedTools = strings(root.childExcludedTools, "childExcludedTools");
    if (new Set(childExcludedTools).size !== childExcludedTools.length) throw new Error("childExcludedTools must not contain duplicates");
    const natureHandleWords = validateNatureHandleWords(root.natureHandleWords);
    return {
        schemaVersion: 7,
        stateRoot: nonBlank(root.stateRoot, "stateRoot"),
        tmux: nonBlank(root.tmux, "tmux"),
        historyViewerExtension: nonBlank(root.historyViewerExtension, "historyViewerExtension"),
        childExtensions: strings(root.childExtensions, "childExtensions"),
        harnesses: parsed as SubagentRuntimeConfig["harnesses"],
        maxDepth: root.maxDepth as number,
        childExcludedTools,
        natureHandleWords,
        ...(Number.isInteger(root.bridgeReadyTimeoutMs) ? { bridgeReadyTimeoutMs: root.bridgeReadyTimeoutMs as number } : {}),
    };
}
export function projectChildEffectiveProfile(profile: AgentProfile, excludedTools: readonly string[]): AgentProfile {
    if (profile.allowAllTools) throw new Error("Child subagent targets must use an explicit tool allowlist; allowAllTools profiles are not allowed");
    const excluded = new Set(excludedTools);
    const next = structuredClone(profile);
    next.tools = next.tools.filter(tool => !excluded.has(tool));
    return next;
}
export function parseSubagentFacet(value: unknown): SubagentFacet { const facet = object(value, "extensions.subagent"); const unknown = Object.keys(facet).filter(key => key !== "allowedTargets" && key !== "harness" && key !== "harnessOptions"); if (unknown.length) throw new Error(`extensions.subagent contains unknown keys: ${unknown.join(", ")}`); const allowedTargets = strings(facet.allowedTargets, "extensions.subagent.allowedTargets"); if (new Set(allowedTargets).size !== allowedTargets.length) throw new Error("extensions.subagent.allowedTargets must not contain duplicates"); return { allowedTargets, harness: facet.harness === undefined ? "pi" : nonBlank(facet.harness, "extensions.subagent.harness"), ...(facet.harnessOptions === undefined ? {} : { harnessOptions: structuredClone(object(facet.harnessOptions, "extensions.subagent.harnessOptions")) }) }; }
export function emptyUsage(): Usage { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }; }
export function addUsage(target: Usage, usage: Partial<Usage> | undefined): void { if (!usage) return; for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) target[key] += usage[key] ?? 0; if (usage.reasoning !== undefined) target.reasoning = (target.reasoning ?? 0) + usage.reasoning; if (usage.cacheWrite1h !== undefined) target.cacheWrite1h = (target.cacheWrite1h ?? 0) + usage.cacheWrite1h; for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) target.cost[key] += usage.cost?.[key] ?? 0; }
export function isTerminalTask(state: TaskState): state is TerminalTaskState { return state === "succeeded" || state === "failed" || state === "stopped"; }
export function isTerminalAgent(state: AgentState): boolean { return state === "stopped" || state === "failed"; }
export function tmuxOwnership(agent: AgentRecord): TmuxOwnership { return agent.tmuxOwnership ?? "dedicated"; }
