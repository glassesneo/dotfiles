import type { Usage } from "@earendil-works/pi-ai";
import type { AgentHarness, CallerPolicy, HarnessRuntimeConfig, MeshBudgets, OrchestrationConfig, RoleDefinition } from "./agent_types.ts";
import type { ExecutionProfile } from "./mode_types.ts";
import type { AgentActivityProjection } from "./orchestration_activity.ts";
export type { HarnessRuntimeConfig, MeshBudgets, OrchestrationConfig } from "./agent_types.ts";

export const MESH_STATES = ["open", "closing", "closed"] as const;
export const AGENT_STATES = ["creating", "idle", "busy", "stopping", "stopped", "failed"] as const;
export const TASK_STATES = ["created", "running", "succeeded", "failed", "stopped"] as const;
export const RESERVATION_STATES = ["pending", "committed", "released"] as const;
export const AGENT_STOP_STATES = ["requested", "terminating", "confirmed", "failed"] as const;
export const AGENT_STOP_SOURCES = ["user", "peer", "gc-role", "gc-context", "gc-pressure", "shutdown", "recovery"] as const;
export type MeshState = (typeof MESH_STATES)[number];
export type AgentState = (typeof AGENT_STATES)[number];
export type TaskState = (typeof TASK_STATES)[number];
export type TerminalTaskState = Extract<TaskState, "succeeded" | "failed" | "stopped">;
export type ReservationState = (typeof RESERVATION_STATES)[number];
export type AgentStopState = (typeof AGENT_STOP_STATES)[number];
export type AgentStopSource = (typeof AGENT_STOP_SOURCES)[number];
export type AgentStopTerminalState = Extract<AgentState, "stopped" | "failed">;
export type TmuxOwnership = "mesh-hub" | "dedicated";
export interface TmuxAgentReference { socket: string; serverPid: string; sessionId: string; sessionName: string; windowId: string; paneId: string; windowName: string }
export interface NativeCapabilities { nativeScreen: boolean; taskDelivery: boolean; taskCompletion: boolean; taskCancellation?: boolean; usage: boolean; interactiveInterventions: boolean; terminalHistory?: boolean }
export type HarnessAdapterKind = HarnessRuntimeConfig["adapter"];
export type SubagentRuntimeConfig = OrchestrationConfig;

export interface MeshBudgetMigration { type: "mesh_budget_migrated"; from: MeshBudgets; to: MeshBudgets; migratedAt: string }
export interface MeshRecord { schemaVersion: 1; meshId: string; state: MeshState; recoverable: boolean; rootSessionId: string; rootSessionFile?: string; budgets: MeshBudgets; createdAt: string; updatedAt: string; rootAttachedAt?: string; currentEpochId?: string; closedAt?: string; budgetMigration?: MeshBudgetMigration }
export interface RootLease { schemaVersion: 1; meshId: string; leaseId: string; rootSessionId: string; rootSessionFile?: string; pid: number; acquiredAt: string; heartbeatAt: string; tmuxServerPid?: string; tmuxSessionId?: string }
export interface PolicyEpoch { schemaVersion: 2; meshId: string; epochId: string; mode: string; directRoles: string[]; roles: Record<string, RoleDefinition>; profiles: Record<string, ExecutionProfile>; policies: Record<string, CallerPolicy>; policyDigest: string; createdAt: string; /** Transitional runtime alias. */ readonly roleSet: string[] }
export interface BudgetReservation { schemaVersion: 1; meshId: string; reservationId: string; kind: "new-agent-task" | "existing-agent-task"; state: ReservationState; agentId?: string; taskId?: string; liveSlots: 0 | 1; taskSlots: 1; lifetimeTasks: 1; createdAt: string; updatedAt: string; committedAt?: string; releasedAt?: string; releaseReason?: string }
export interface MeshBudgetUsage { liveAgents: number; concurrentTasks: number; lifetimeTasks: number; pendingLiveSlots: number; pendingTaskSlots: number; pendingLifetimeTasks: number }

/** Creation provenance only. It is never an authority or lookup boundary. */
export interface AgentProvenance { parentAgentId?: string; creatorSessionId: string; creatorSessionFile?: string }
export interface AgentRecord extends AgentProvenance { schemaVersion: 2; meshId: string; agentId: string; epochId: string; role: string; selectedProfile: string; harness: AgentHarness; cwd: string; createdAt: string; roleSnapshot: RoleDefinition; profileSnapshot: ExecutionProfile; launchEnvelope: string; launchEnvelopeDigest: string; tmux: TmuxAgentReference; tmuxOwnership?: TmuxOwnership; capabilities: NativeCapabilities; /** Transitional runtime aliases. */ readonly agent: string; readonly agentSnapshot: RoleDefinition }
export interface AgentStatus { schemaVersion: 1; meshId: string; agentId: string; state: AgentState; activeTaskId?: string; latestTaskId?: string; bridgeReady: boolean; meshToolsEnabled: boolean; childSessionId?: string; childSessionFile?: string; agentUsage: Usage; accountedTaskIds: string[]; updatedAt: string; exitReason?: string }
export interface AgentStopRequest { schemaVersion: 1; meshId: string; agentId: string; stopRequestId: string; state: AgentStopState; source: AgentStopSource; requesterEndpointId?: string; reason: string; terminalState?: AgentStopTerminalState; activitySequence?: number; gcPassId?: string; previousAgentState: AgentState; requestedAt: string; updatedAt: string; terminatingAt?: string; confirmedAt?: string; failedAt?: string; failureCategory?: string; noticeCreatedAt?: string }
export interface TaskRequest { schemaVersion: 2; meshId: string; agentId: string; taskId: string; prompt: string; requesterEndpointId: string; requesterAgentId?: string; createdAt: string }
export interface TaskCancelRequest { schemaVersion: 1; meshId: string; agentId: string; taskId: string; requestedAt: string; reason: string }
export interface Intervention { sequence: number; timestamp: string; taskId?: string; text: string; deliveryMode: "steer" | "followUp" | "idle"; images: string[] }
export interface TaskStatus { schemaVersion: 1; meshId: string; agentId: string; taskId: string; state: TaskState; createdAt: string; startedAt?: string; finishedAt?: string; error?: string }
export interface TaskResult { schemaVersion: 1; meshId: string; agentId: string; taskId: string; outcome: TerminalTaskState; output: string; usage: Usage; turns: number; interventions: Intervention[]; startedAt: string; finishedAt: string; error?: string }
export interface UsageClaim { schemaVersion: 1; meshId: string; claimantSessionFile: string; toolCallId: string; toolName: "mesh_run" | "mesh_submit" | "mesh_get" | "mesh_wait" | "mesh_stop"; agentId: string; taskId: string; claimedAt: string }
export interface AgentSnapshot { agent: AgentRecord; status: AgentStatus; activity: AgentActivityProjection; stop: AgentStopRequest | null; task?: TaskSnapshot }
export interface TaskSnapshot { request: TaskRequest; status: TaskStatus; result: TaskResult | null; interventions: Intervention[]; claimed: boolean; directory: string }

export function promptSummary(prompt: string, max = 96): string { const line = prompt.split(/\r?\n/u).map(value => value.replace(/\s+/gu, " ").trim()).find(Boolean) ?? "Task"; return Array.from(line).slice(0, max).join(""); }
export function validateNatureHandleWords(value: unknown): string[] { if (!Array.isArray(value) || value.some(v => typeof v !== "string" || !v.trim() || v.includes("-"))) throw new Error("natureHandleWords must be non-empty strings without '-'"); const words = value as string[]; if (!words.length || new Set(words).size !== words.length) throw new Error("natureHandleWords must be a non-empty unique list"); return [...words]; }
export function emptyUsage(): Usage { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }; }
export function addUsage(target: Usage, usage: Partial<Usage> | undefined): void { if (!usage) return; for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) target[key] += usage[key] ?? 0; if (usage.reasoning !== undefined) target.reasoning = (target.reasoning ?? 0) + usage.reasoning; if (usage.cacheWrite1h !== undefined) target.cacheWrite1h = (target.cacheWrite1h ?? 0) + usage.cacheWrite1h; for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) target.cost[key] += usage.cost?.[key] ?? 0; }
export function isTerminalTask(state: TaskState): state is TerminalTaskState { return state === "succeeded" || state === "failed" || state === "stopped"; }
export function isTerminalAgent(state: AgentState): boolean { return state === "stopped" || state === "failed"; }
export function tmuxOwnership(agent: AgentRecord): TmuxOwnership { return agent.tmuxOwnership ?? "dedicated"; }
