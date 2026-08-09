import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomicJson as atomicJson } from "./orchestration_json.ts";
import { meshDirectory, withMeshAgentLock } from "./orchestration_lock.ts";
import { assertCurrentAgentRuntime } from "./orchestration_runtime.ts";
import { isTerminalAgent, type AgentStatus } from "./orchestration_types.ts";

export const DEFAULT_ACTIVITY_STALE_MS = 10_000;
export const DEFAULT_CONTEXT_HEADROOM_TOKENS = 32_768;

export const ACTIVITY_PHASES = ["starting", "idle", "running", "compacting", "offline"] as const;
export type AgentActivityPhase = (typeof ACTIVITY_PHASES)[number];
export type AgentCompactionReason = "manual" | "threshold" | "overflow";
export type AgentContextHealth = "healthy" | "retire" | "unknown";

export interface AgentActivityContext {
    state: "available" | "unsupported" | "unknown";
    tokens?: number;
    contextWindow?: number;
    reserveTokens?: number;
    compactionThreshold?: number;
    tokensUntilCompaction?: number;
    retirementHeadroomTokens?: number;
    health: AgentContextHealth;
}

export interface AgentActivity {
    schemaVersion: 1;
    meshId: string;
    agentId: string;
    runtimeId: string;
    sequence: number;
    phase: AgentActivityPhase;
    acceptingTask: boolean;
    pendingMessages: boolean;
    phaseSince: string;
    observedAt: string;
    heartbeatAt: string;
    compactionReason?: AgentCompactionReason;
    context: AgentActivityContext;
}

export interface AgentActivityProjection {
    phase: Exclude<AgentActivityPhase, "starting"> | "unknown";
    acceptingTask: boolean;
    pendingMessages: boolean | null;
    phaseSince: string | null;
    lastHeartbeatAt: string | null;
    compactionReason: AgentCompactionReason | null;
    context: {
        state: AgentActivityContext["state"];
        tokens: number | null;
        contextWindow: number | null;
        reserveTokens: number | null;
        compactionThreshold: number | null;
        tokensUntilCompaction: number | null;
        retirementHeadroomTokens: number | null;
        health: AgentContextHealth;
    };
    retirementReason: "context-headroom" | null;
}

export type ActivityPublication = Omit<AgentActivity, "schemaVersion" | "meshId" | "agentId" | "sequence">;

function activityFile(stateRoot: string, meshId: string, agentId: string): string {
    return join(meshDirectory(stateRoot, meshId), "agents", agentId, "activity.json");
}
function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string): void {
    const allowed = ["schemaVersion", ...required, ...optional];
    const unknown = Object.keys(value).filter(key => !allowed.includes(key));
    if (unknown.length) throw new Error(`${label} contains unknown keys: ${unknown.join(", ")}`);
    const missing = required.filter(key => !(key in value));
    if (missing.length) throw new Error(`${label} is missing required keys: ${missing.join(", ")}`);
}
function text(value: unknown, label: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
    return value;
}
function timestamp(value: unknown, label: string): string {
    const result = text(value, label);
    if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO timestamp`);
    return result;
}
function finite(value: unknown, label: string, nonnegative = false): number {
    if (typeof value !== "number" || !Number.isFinite(value) || nonnegative && value < 0) throw new Error(`${label} must be a ${nonnegative ? "non-negative " : ""}finite number`);
    return value;
}
function optionalFinite(value: unknown, label: string, nonnegative = false): number | undefined {
    return value === undefined ? undefined : finite(value, label, nonnegative);
}

export function validateAgentActivity(value: unknown, expected?: { meshId: string; agentId: string }): AgentActivity {
    const raw = object(value, "agent activity");
    exact(raw, ["meshId", "agentId", "runtimeId", "sequence", "phase", "acceptingTask", "pendingMessages", "phaseSince", "observedAt", "heartbeatAt", "context"], ["compactionReason"], "agent activity");
    if (raw.schemaVersion !== 1) throw new Error("Unsupported agent activity schemaVersion");
    const meshId = text(raw.meshId, "agent activity meshId"); const agentId = text(raw.agentId, "agent activity agentId");
    if (expected && (meshId !== expected.meshId || agentId !== expected.agentId)) throw new Error("Agent activity does not match path identity");
    text(raw.runtimeId, "agent activity runtimeId");
    const sequence = finite(raw.sequence, "agent activity sequence", true);
    if (!Number.isInteger(sequence) || sequence < 1) throw new Error("agent activity sequence must be a positive integer");
    if (!ACTIVITY_PHASES.includes(raw.phase as never)) throw new Error("agent activity phase is invalid");
    if (typeof raw.acceptingTask !== "boolean" || typeof raw.pendingMessages !== "boolean") throw new Error("agent activity booleans are invalid");
    timestamp(raw.phaseSince, "agent activity phaseSince"); timestamp(raw.observedAt, "agent activity observedAt"); timestamp(raw.heartbeatAt, "agent activity heartbeatAt");
    if (raw.compactionReason !== undefined && !["manual", "threshold", "overflow"].includes(raw.compactionReason as string)) throw new Error("agent activity compactionReason is invalid");
    const contextRaw = object(raw.context, "agent activity context");
    exact(contextRaw, ["state", "health"], ["tokens", "contextWindow", "reserveTokens", "compactionThreshold", "tokensUntilCompaction", "retirementHeadroomTokens"], "agent activity context");
    if (!["available", "unsupported", "unknown"].includes(contextRaw.state as string) || !["healthy", "retire", "unknown"].includes(contextRaw.health as string)) throw new Error("agent activity context state is invalid");
    const numbers = {
        tokens: optionalFinite(contextRaw.tokens, "agent activity context tokens", true),
        contextWindow: optionalFinite(contextRaw.contextWindow, "agent activity contextWindow", true),
        reserveTokens: optionalFinite(contextRaw.reserveTokens, "agent activity reserveTokens", true),
        compactionThreshold: optionalFinite(contextRaw.compactionThreshold, "agent activity compactionThreshold", true),
        tokensUntilCompaction: optionalFinite(contextRaw.tokensUntilCompaction, "agent activity tokensUntilCompaction"),
        retirementHeadroomTokens: optionalFinite(contextRaw.retirementHeadroomTokens, "agent activity retirementHeadroomTokens", true),
    };
    if (contextRaw.state === "available" && Object.values(numbers).some(item => item === undefined)) throw new Error("available agent activity context requires all numeric fields");
    if (contextRaw.state !== "available" && Object.values(numbers).some(item => item !== undefined)) throw new Error("unavailable agent activity context must not contain numeric fields");
    return value as AgentActivity;
}

async function optionalActivity(path: string, identity: { meshId: string; agentId: string }): Promise<AgentActivity | undefined> {
    try { return validateAgentActivity(JSON.parse(await readFile(path, "utf8")), identity); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export async function publishAgentActivity(stateRoot: string, meshId: string, agentId: string, publication: ActivityPublication): Promise<AgentActivity> {
    return withMeshAgentLock(stateRoot, meshId, agentId, async () => {
        await assertCurrentAgentRuntime(stateRoot, meshId, agentId, publication.runtimeId);
        const status = JSON.parse(await readFile(join(meshDirectory(stateRoot, meshId), "agents", agentId, "status.json"), "utf8")) as AgentStatus;
        if ((status.state === "stopping" || isTerminalAgent(status.state)) && publication.phase !== "offline") throw new Error(`Agent ${agentId} cannot publish non-terminal activity while ${status.state}`);
        const path = activityFile(stateRoot, meshId, agentId); const current = await optionalActivity(path, { meshId, agentId });
        if (current && Date.parse(publication.observedAt) < Date.parse(current.observedAt)) throw new Error("Agent activity observation is older than the current record");
        if (current && current.runtimeId !== publication.runtimeId && publication.phase !== "starting") throw new Error("A new activity runtime must publish starting before other phases");
        const next: AgentActivity = { schemaVersion: 1, meshId, agentId, ...publication, sequence: (current?.sequence ?? 0) + 1 };
        validateAgentActivity(next, { meshId, agentId }); await atomicJson(path, next); return next;
    });
}

export async function readAgentActivity(stateRoot: string, meshId: string, agentId: string): Promise<AgentActivity | undefined> {
    return optionalActivity(activityFile(stateRoot, meshId, agentId), { meshId, agentId });
}

export function availableContext(tokens: number | null | undefined, contextWindow: number | undefined, reserveTokens: number | undefined, retirementHeadroomTokens = DEFAULT_CONTEXT_HEADROOM_TOKENS): AgentActivityContext {
    if (tokens === null || tokens === undefined || !Number.isFinite(tokens) || !Number.isFinite(contextWindow) || !Number.isFinite(reserveTokens) || contextWindow! <= 0 || reserveTokens! < 0 || retirementHeadroomTokens < 0) return { state: "unknown", health: "unknown" };
    const compactionThreshold = contextWindow! - reserveTokens!; if (compactionThreshold < 0) return { state: "unknown", health: "unknown" };
    const tokensUntilCompaction = compactionThreshold - tokens;
    return { state: "available", tokens, contextWindow, reserveTokens, compactionThreshold, tokensUntilCompaction, retirementHeadroomTokens, health: tokensUntilCompaction <= retirementHeadroomTokens ? "retire" : "healthy" };
}
export function externalContext(): AgentActivityContext { return { state: "unsupported", health: "unknown" }; }

export const unknownAgentActivityProjection = (): AgentActivityProjection => ({
    phase: "unknown", acceptingTask: false, pendingMessages: null, phaseSince: null, lastHeartbeatAt: null, compactionReason: null,
    context: { state: "unknown", tokens: null, contextWindow: null, reserveTokens: null, compactionThreshold: null, tokensUntilCompaction: null, retirementHeadroomTokens: null, health: "unknown" }, retirementReason: null,
});

export function projectAgentActivity(status: AgentStatus, activity: AgentActivity | undefined, options: { now?: number; staleMs?: number; expectedRuntimeId?: string; activeStop?: boolean; allowUnsupportedContext?: boolean } = {}): AgentActivityProjection {
    if (!activity || activity.meshId !== status.meshId || activity.agentId !== status.agentId || options.expectedRuntimeId && activity.runtimeId !== options.expectedRuntimeId) return unknownAgentActivityProjection();
    const now = options.now ?? Date.now(); const age = now - Date.parse(activity.heartbeatAt);
    if (!Number.isFinite(age) || age < 0 || age > (options.staleMs ?? DEFAULT_ACTIVITY_STALE_MS) || activity.phase === "starting") return unknownAgentActivityProjection();
    const available = activity.context.state === "available";
    const externalAcceptable = activity.context.state === "unsupported" && options.allowUnsupportedContext !== false;
    const acceptingTask = status.state === "idle" && !status.activeTaskId && activity.phase === "idle" && !activity.pendingMessages && !options.activeStop && (activity.context.health === "healthy" || externalAcceptable);
    return {
        phase: activity.phase, acceptingTask, pendingMessages: activity.pendingMessages, phaseSince: activity.phaseSince, lastHeartbeatAt: activity.heartbeatAt, compactionReason: activity.compactionReason ?? null,
        context: { state: activity.context.state, tokens: available ? activity.context.tokens! : null, contextWindow: available ? activity.context.contextWindow! : null, reserveTokens: available ? activity.context.reserveTokens! : null, compactionThreshold: available ? activity.context.compactionThreshold! : null, tokensUntilCompaction: available ? activity.context.tokensUntilCompaction! : null, retirementHeadroomTokens: available ? activity.context.retirementHeadroomTokens! : null, health: activity.context.health },
        retirementReason: activity.context.health === "retire" ? "context-headroom" : null,
    };
}

export async function readProjectedAgentActivity(stateRoot: string, status: AgentStatus, options: Parameters<typeof projectAgentActivity>[2] = {}): Promise<AgentActivityProjection> {
    try { return projectAgentActivity(status, await readAgentActivity(stateRoot, status.meshId, status.agentId), options); }
    catch { return unknownAgentActivityProjection(); }
}

export function assertAgentAccepting(activity: AgentActivityProjection, status: AgentStatus): void {
    if (activity.acceptingTask) return;
    throw new Error(`Agent ${status.agentId} is not accepting tasks (lifecycle=${status.state}, activity=${activity.phase}, pending=${String(activity.pendingMessages)}, context=${activity.context.health})`);
}
