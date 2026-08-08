import type { Usage } from "@earendil-works/pi-ai";
import type { AgentDefinition, AgentHarness, DelegationConfig, HarnessRuntimeConfig } from "./agent_types.ts";
export type { HarnessRuntimeConfig } from "./agent_types.ts";
export const AGENT_STATES = ["creating", "idle", "busy", "stopping", "stopped", "failed"] as const;
export const TASK_STATES = ["created", "running", "succeeded", "failed", "stopped"] as const;
export type AgentState = (typeof AGENT_STATES)[number]; export type TaskState = (typeof TASK_STATES)[number]; export type TerminalTaskState = Extract<TaskState, "succeeded" | "failed" | "stopped">;
export type TmuxOwnership = "origin-hub" | "dedicated";
export interface TmuxAgentReference { socket: string; serverPid: string; sessionId: string; sessionName: string; windowId: string; paneId: string; windowName: string }
export interface NativeCapabilities { nativeScreen: boolean; taskDelivery: boolean; taskCompletion: boolean; taskCancellation?: boolean; usage: boolean; interactiveInterventions: boolean; terminalHistory?: boolean }
export type HarnessAdapterKind = HarnessRuntimeConfig["adapter"];
export type SubagentRuntimeConfig = DelegationConfig;
export interface AgentLineage { callerIdentity: string; targetAgent: string; depth: number; parentAgentId?: string; originSessionId: string; originSessionFile?: string }
export interface AgentRecord extends AgentLineage { schemaVersion: 2; agentId: string; agent: string; harness: AgentHarness; cwd: string; createdAt: string; agentSnapshot: AgentDefinition; launchEnvelope: string; launchEnvelopeDigest: string; tmux: TmuxAgentReference; tmuxOwnership?: TmuxOwnership; capabilities: NativeCapabilities }
export interface AgentStatus { schemaVersion: 2; agentId: string; state: AgentState; activeTaskId?: string; latestTaskId?: string; bridgeReady: boolean; childSessionId?: string; childSessionFile?: string; agentUsage: Usage; accountedTaskIds: string[]; updatedAt: string; exitReason?: string }
export interface TaskRequest { schemaVersion: 2; agentId: string; taskId: string; prompt: string; createdAt: string }
export interface TaskCancelRequest { schemaVersion: 2; agentId: string; taskId: string; requestedAt: string; reason: string }
export interface Intervention { sequence: number; timestamp: string; taskId?: string; text: string; deliveryMode: "steer" | "followUp" | "idle"; images: string[] }
export interface TaskStatus { schemaVersion: 2; agentId: string; taskId: string; state: TaskState; createdAt: string; startedAt?: string; finishedAt?: string; error?: string }
export interface TaskResult { schemaVersion: 2; agentId: string; taskId: string; outcome: TerminalTaskState; output: string; usage: Usage; turns: number; interventions: Intervention[]; startedAt: string; finishedAt: string; error?: string }
export interface UsageClaim { schemaVersion: 2; originSessionId: string; parentSessionFile?: string; toolCallId: string; toolName: "subagent_run" | "subagent_submit" | "subagent_get" | "subagent_wait" | "subagent_stop"; agentId: string; taskId: string; claimedAt: string }
export interface AgentSnapshot { agent: AgentRecord; status: AgentStatus; task?: TaskSnapshot }
export interface TaskSnapshot { request: TaskRequest; status: TaskStatus; result: TaskResult | null; interventions: Intervention[]; claimed: boolean; directory: string }
export function promptSummary(prompt: string, max = 96): string { const line = prompt.split(/\r?\n/u).map(value => value.replace(/\s+/gu, " ").trim()).find(Boolean) ?? "Task"; return Array.from(line).slice(0, max).join(""); }
export function validateNatureHandleWords(value: unknown): string[] { if (!Array.isArray(value) || value.some(v => typeof v !== "string" || !v.trim() || v.includes("-"))) throw new Error("natureHandleWords must be non-empty strings without '-'"); const words = value as string[]; if (!words.length || new Set(words).size !== words.length) throw new Error("natureHandleWords must be a non-empty unique list"); return [...words]; }
export function emptyUsage(): Usage { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }; }
export function addUsage(target: Usage, usage: Partial<Usage> | undefined): void { if (!usage) return; for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) target[key] += usage[key] ?? 0; if (usage.reasoning !== undefined) target.reasoning = (target.reasoning ?? 0) + usage.reasoning; if (usage.cacheWrite1h !== undefined) target.cacheWrite1h = (target.cacheWrite1h ?? 0) + usage.cacheWrite1h; for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) target.cost[key] += usage.cost?.[key] ?? 0; }
export function isTerminalTask(state: TaskState): state is TerminalTaskState { return state === "succeeded" || state === "failed" || state === "stopped"; } export function isTerminalAgent(state: AgentState): boolean { return state === "stopped" || state === "failed"; } export function tmuxOwnership(agent: AgentRecord): TmuxOwnership { return agent.tmuxOwnership ?? "dedicated"; }
