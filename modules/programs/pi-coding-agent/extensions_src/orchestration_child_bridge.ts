import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { StopReason, Usage } from "@earendil-works/pi-ai";
import { getAgentDir, SettingsManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { onResolvedAgent } from "./utilities/agent_events.ts";
import { launchEnvelopeDigest, validateLaunchEnvelope } from "./utilities/agent_types.ts";
import { availableContext, publishAgentActivity, type AgentActivityPhase, type AgentCompactionReason } from "./utilities/orchestration_activity.ts";
import { addUsage, emptyUsage, type TerminalTaskState } from "./utilities/orchestration_types.ts";
import { bindAgentRuntime, readCurrentPiRuntimeGeneration, unbindAgentRuntime } from "./utilities/orchestration_runtime.ts";
import { claimPendingTask, failAgent, finishTask, markBridgeReady, patchAgentStatus, readAgentStatus, readTaskCancellation, recordChildSessionIdentity, recordIdleUsage, recordIntervention } from "./utilities/orchestration_store.ts";
import { FALLBACK_CONTINUE_CONTENT, FALLBACK_CONTINUE_CUSTOM_TYPE, NATIVE_COMPACTION_RESERVE_TOKENS, initialModelRoute, preflightProfileCandidates, reconcileForwardIndex, recordModelRouteAttempt, restoreCompatibleRoute, sanitizeDiagnostic, selectRuntimePromotion, type ModelRouteState } from "./utilities/orchestration_profile_fallback.ts";
import { createDirectoryWake, workerTaskInboxDirectory, type DirectoryWake, type DirectoryWakeDependencies } from "./utilities/orchestration_wake.ts";

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function usage(value: unknown): Partial<Usage> | undefined { const item = record(value); return ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "reasoning", "cacheWrite1h"].some(key => typeof item[key] === "number") || item.cost && typeof item.cost === "object" ? item as unknown as Partial<Usage> : undefined; }
function text(value: unknown): string { const message = record(value); if (!Array.isArray(message.content)) return ""; return message.content.map(part => { const item = record(part); return item.type === "text" && typeof item.text === "string" ? item.text : ""; }).join(""); }
function imageTypes(images: unknown): string[] { if (!Array.isArray(images)) return []; return images.map(image => record(image).mimeType).filter((type): type is string => typeof type === "string"); }
function terminal(stopReason: StopReason | undefined, errorMessage: string | undefined): { outcome: TerminalTaskState; error?: string } { if (stopReason === "aborted") return { outcome: "stopped", error: errorMessage ?? "Assistant turn was aborted" }; if (stopReason === "error") return { outcome: "failed", error: errorMessage ?? "Assistant turn failed" }; if (stopReason === "length") return { outcome: "failed", error: errorMessage ?? "Assistant turn reached the token limit" }; if (stopReason === "toolUse") return { outcome: "failed", error: errorMessage ?? "Assistant settled while awaiting tool execution" }; return { outcome: "succeeded" }; }

export interface MeshChildBridgeDependencies { claimPendingTask?: typeof claimPendingTask; readTaskCancellation?: typeof readTaskCancellation; finishTask?: typeof finishTask; failAgent?: typeof failAgent; markBridgeReady?: typeof markBridgeReady; patchAgentStatus?: typeof patchAgentStatus; recordChildSessionIdentity?: typeof recordChildSessionIdentity; publishAgentActivity?: typeof publishAgentActivity; resolveCompactionReserveTokens?: (ctx: ExtensionContext) => number | undefined; standaloneRuntimeBinding?: boolean; retryIntervalMs?: number; idleClaimIntervalMs?: number; activityHeartbeatMs?: number; contextHeadroomTokens?: number; deliveryAckTimeoutMs?: number; completionPersistenceTimeoutMs?: number; publicationTimeoutMs?: number; publicationRetryMs?: number; sleep?: (milliseconds: number) => Promise<void>; now?: () => number; setInterval?: (callback: () => void | Promise<void>, intervalMs: number) => unknown; clearInterval?: (timer: unknown) => void; cadenceSetTimeout?: (callback: () => void | Promise<void>, timeoutMs: number) => unknown; cadenceClearTimeout?: (timer: unknown) => void; setTimeout?: (callback: () => void, timeoutMs: number) => unknown; clearTimeout?: (timer: unknown) => void; wake?: DirectoryWakeDependencies }
function expectedResolvedAgent(env: NodeJS.ProcessEnv) { const path = env.PI_AGENT_RESOLVED_AGENT; return path ? validateLaunchEnvelope(JSON.parse(readFileSync(path, "utf8"))) : undefined; }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === "ENOENT"; }
async function markReadyAfterPublication(stateRoot: string, meshId: string, agentId: string, digest: string, runtimeId: string, dependencies: MeshChildBridgeDependencies): Promise<void> { const now = dependencies.now ?? Date.now; const deadline = now() + (dependencies.publicationTimeoutMs ?? 5000); const wait = dependencies.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))); while (true) try { await (dependencies.markBridgeReady ?? markBridgeReady)(stateRoot, meshId, agentId, digest, runtimeId); return; } catch (error) { if (!missing(error)) throw error; if (now() >= deadline) throw new Error("Timed out waiting for mesh agent publication"); await wait(dependencies.publicationRetryMs ?? 25); } }

export function registerMeshChildBridge(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env, dependencies: MeshChildBridgeDependencies = {}): boolean {
    const meshId = env.PI_MESH_ID; const agentId = env.PI_MESH_AGENT_ID; const directory = env.PI_MESH_AGENT_DIR; if (!meshId || !agentId || !directory) return false; const stateRoot = directory.replace(/\/meshes\/[^/]+\/agents\/[^/]+$/u, "");
    const hasResolvedAgent = Boolean(env.PI_AGENT_RESOLVED_AGENT); let expectedEnvelope: ReturnType<typeof expectedResolvedAgent>; let invalid = false; let activatedExpected = false; if (hasResolvedAgent) try { expectedEnvelope = expectedResolvedAgent(env); } catch { invalid = true; }
    onResolvedAgent(pi, event => { if (expectedEnvelope && launchEnvelopeDigest(event.envelope) === launchEnvelopeDigest(expectedEnvelope)) activatedExpected = true; });
    let activeTaskId: string | undefined; let taskUsage = emptyUsage(); let turns = 0; let output = ""; let stopReason: StopReason | undefined; let errorMessage: string | undefined; let pumping = false; let completing = false; let settled = true; let pendingCompletion: { taskId: string; input: Parameters<typeof finishTask>[3]; deadline: number } | undefined; let awaitingDelivery: { taskId: string; prompt: string; deadline: number } | undefined; let timer: unknown; let tickPass: Promise<void> | undefined; let nextClaimAt = Number.NEGATIVE_INFINITY; let bridgeContext: ExtensionContext | undefined; let cancellationAbortedTaskId: string | undefined; let taskWake: DirectoryWake | undefined; let shuttingDown = false; let shutdownAfterStoreFailure = false;
    let runtimeId: string = randomUUID(); let activityPhase: AgentActivityPhase = "starting"; let phaseSince = new Date((dependencies.now ?? Date.now)()).toISOString(); let compactionReason: AgentCompactionReason | undefined; let awaitingPostCompactionSettlement = false; let reserveTokens: number | undefined; let lastHeartbeat = Number.NEGATIVE_INFINITY; let compactionObservation = 0;
    let route: ModelRouteState | undefined; let fallbackSuspended = false; let applyingSetModel = false; let turnHadToolError = false; let promotionPass: Promise<"promoted" | "exhausted" | "stopped" | "settle"> | undefined;
    const publishActivity = async (phase = activityPhase, heartbeat = false) => { const ctx = bridgeContext; if (!ctx) return; const now = (dependencies.now ?? Date.now)(); if (heartbeat && now - lastHeartbeat < (dependencies.activityHeartbeatMs ?? 2000)) return; if (phase !== activityPhase) { activityPhase = phase; phaseSince = new Date(now).toISOString(); } lastHeartbeat = now; const observedAt = new Date(now).toISOString(); const usage = ctx.getContextUsage?.(); const context = availableContext(usage?.tokens, usage?.contextWindow, reserveTokens, dependencies.contextHeadroomTokens); await (dependencies.publishAgentActivity ?? publishAgentActivity)(stateRoot, meshId, agentId, { runtimeId, phase: activityPhase, acceptingTask: activityPhase === "idle", pendingMessages: ctx.hasPendingMessages?.() ?? false, phaseSince, observedAt, heartbeatAt: observedAt, ...(activityPhase === "compacting" && compactionReason ? { compactionReason } : {}), context }); };
    const queueCompletion = (taskId: string, input: Parameters<typeof finishTask>[3]) => { pendingCompletion = { taskId, input, deadline: (dependencies.now ?? Date.now)() + (dependencies.completionPersistenceTimeoutMs ?? 30_000) }; };
    const persistCompletion = async () => { if (!pendingCompletion || completing) return; completing = true; const pending = pendingCompletion; const now = dependencies.now ?? Date.now; const scheduleTimeout = dependencies.setTimeout ?? ((callback: () => void, timeoutMs: number) => globalThis.setTimeout(callback, timeoutMs)); let deadlineTimer: unknown; let timedOut = false; try { await Promise.race([(dependencies.finishTask ?? finishTask)(stateRoot, meshId, pending.taskId, pending.input, runtimeId), new Promise<never>((_resolve, reject) => { deadlineTimer = scheduleTimeout(() => { timedOut = true; reject(new Error("Timed out persisting mesh task completion")); }, Math.max(0, pending.deadline - now())); })]); if (pendingCompletion === pending) pendingCompletion = undefined; if (activeTaskId === pending.taskId) activeTaskId = undefined; } catch (error) { if (!timedOut && now() < pending.deadline) throw error; if (!shutdownAfterStoreFailure) { shutdownAfterStoreFailure = true; bridgeContext?.shutdown(); } } finally { if (deadlineTimer !== undefined) (dependencies.clearTimeout ?? (value => globalThis.clearTimeout(value as NodeJS.Timeout)))(deadlineTimer); completing = false; } };
    const taskCancellation = async () => activeTaskId ? (dependencies.readTaskCancellation ?? readTaskCancellation)(stateRoot, meshId, activeTaskId) : undefined;
    const queueStoppedPromotion = async (): Promise<boolean> => {
        const cancellation = await taskCancellation();
        if (!cancellation && !shuttingDown) return false;
        if (activeTaskId && !pendingCompletion) queueCompletion(activeTaskId, { outcome: "stopped", output, usage: taskUsage, turns, error: cancellation?.reason ?? "Child Pi session shut down" });
        return true;
    };
    const persistRouteStatus = (modelRoute: ModelRouteState) => (dependencies.patchAgentStatus ?? patchAgentStatus)(stateRoot, meshId, agentId, { modelRoute });
    const promoteAfterError = async (settledStopReason = stopReason, settledErrorMessage = errorMessage): Promise<"promoted" | "exhausted" | "stopped" | "settle"> => {
        const ctx = bridgeContext; const profile = expectedEnvelope?.executionProfile;
        if (!activeTaskId || pendingCompletion || fallbackSuspended || settledStopReason !== "error" || !profile || profile.harness !== "pi" || !route || !ctx) return "settle";
        if (await queueStoppedPromotion()) return "stopped";
        const registry = ctx.modelRegistry ?? { find: () => undefined };
        let currentRoute = route;
        while (true) {
            if (await queueStoppedPromotion()) return "stopped";
            const decision = await selectRuntimePromotion({ profile, profileName: expectedEnvelope!.selectedProfile, route: currentRoute, suspended: fallbackSuspended, stopReason: settledStopReason, cancelled: false, shuttingDown, usageTokens: ctx.getContextUsage?.()?.tokens, reserveTokens, registry, errorMessage: settledErrorMessage });
            if (await queueStoppedPromotion()) return "stopped";
            if (decision.action === "settle") return "settle";
            if (decision.action === "exhausted") {
                route = decision.route;
                await persistRouteStatus(decision.route).catch(() => {});
                if (await queueStoppedPromotion()) return "stopped";
                queueCompletion(activeTaskId, { outcome: "failed", error: decision.error, output, usage: taskUsage, turns });
                await persistCompletion();
                if (await queueStoppedPromotion()) return "stopped";
                await (dependencies.failAgent ?? failAgent)(stateRoot, meshId, agentId, decision.error, false, { expectedRuntimeId: runtimeId });
                return "exhausted";
            }
            if (await queueStoppedPromotion()) return "stopped";
            applyingSetModel = true;
            try {
                if (typeof pi.setModel !== "function" || !await pi.setModel(decision.model)) {
                    currentRoute = recordModelRouteAttempt(decision.route, { index: decision.route.activeIndex, model: decision.route.activeModel, category: "unavailable", at: new Date().toISOString(), message: sanitizeDiagnostic("setModel returned false") });
                    continue;
                }
                if (await queueStoppedPromotion()) return "stopped";
                if (profile.thinkingLevel) pi.setThinkingLevel(profile.thinkingLevel);
            } catch (error) {
                currentRoute = recordModelRouteAttempt(decision.route, { index: decision.route.activeIndex, model: decision.route.activeModel, category: "unavailable", at: new Date().toISOString(), message: sanitizeDiagnostic(error) });
                continue;
            } finally { applyingSetModel = false; }
            if (await queueStoppedPromotion()) return "stopped";
            route = decision.route;
            await persistRouteStatus(decision.route);
            if (await queueStoppedPromotion()) return "stopped";
            pi.sendMessage({ customType: FALLBACK_CONTINUE_CUSTOM_TYPE, content: FALLBACK_CONTINUE_CONTENT, display: false }, { triggerTurn: true });
            return "promoted";
        }
    };
    const pump = async (force = false) => { if (shuttingDown || pumping || pendingCompletion || activeTaskId || !settled) return; const now = (dependencies.now ?? Date.now)(); if (!force && now < nextClaimAt) return; nextClaimAt = now + (dependencies.idleClaimIntervalMs ?? 3000); pumping = true; try { const task = await (dependencies.claimPendingTask ?? claimPendingTask)(stateRoot, meshId, agentId, runtimeId); if (!task) return; activeTaskId = task.request.taskId; if (shuttingDown) return; cancellationAbortedTaskId = undefined; taskUsage = emptyUsage(); turns = 0; output = ""; stopReason = undefined; errorMessage = undefined; turnHadToolError = false; settled = false; awaitingDelivery = { taskId: task.request.taskId, prompt: task.request.prompt, deadline: (dependencies.now ?? Date.now)() + (dependencies.deliveryAckTimeoutMs ?? 5000) }; try { pi.sendUserMessage(task.request.prompt); } catch (error) { awaitingDelivery = undefined; settled = true; queueCompletion(task.request.taskId, { outcome: "failed", error: `Could not deliver task: ${error instanceof Error ? error.message : String(error)}` }); await persistCompletion(); } } finally { pumping = false; } };
    const tickOnce = async (forceClaim = false) => { if (shuttingDown) return; if (activeTaskId && cancellationAbortedTaskId !== activeTaskId) { const cancellation = await (dependencies.readTaskCancellation ?? readTaskCancellation)(stateRoot, meshId, activeTaskId); if (cancellation) { cancellationAbortedTaskId = activeTaskId; if (awaitingDelivery?.taskId === activeTaskId) { awaitingDelivery = undefined; settled = true; queueCompletion(activeTaskId, { outcome: "stopped", output, usage: taskUsage, turns, error: cancellation.reason }); } else bridgeContext?.abort(); } } if (awaitingDelivery && (dependencies.now ?? Date.now)() >= awaitingDelivery.deadline) { const taskId = awaitingDelivery.taskId; awaitingDelivery = undefined; settled = true; queueCompletion(taskId, { outcome: "failed", error: "Could not deliver task: child Pi did not accept the extension message" }); } if (pendingCompletion) await persistCompletion(); const ctx = bridgeContext; if (awaitingPostCompactionSettlement && settled && !activeTaskId && ctx?.isIdle() && !(ctx.hasPendingMessages?.() ?? false)) { awaitingPostCompactionSettlement = false; compactionReason = undefined; await publishActivity("idle"); } if (!pendingCompletion) await pump(forceClaim); await publishActivity(activityPhase, true); };
    const runTick = (forceClaim = false): Promise<void> => { if (shuttingDown) return Promise.resolve(); if (tickPass) return tickPass; const pass = tickOnce(forceClaim); tickPass = pass; const clear = () => { if (tickPass === pass) tickPass = undefined; }; void pass.then(clear, clear); return pass; };
    const scheduleNext = () => { if (shuttingDown || shutdownAfterStoreFailure || !bridgeContext) return; if (timer !== undefined) (dependencies.cadenceClearTimeout ?? (value => globalThis.clearTimeout(value as NodeJS.Timeout)))(timer); const now = (dependencies.now ?? Date.now)(); const activeState = Boolean(activeTaskId || awaitingDelivery || pendingCompletion || completing || !settled); const heartbeatAt = lastHeartbeat + (dependencies.activityHeartbeatMs ?? 2000); const deadline = activeState ? now + (dependencies.retryIntervalMs ?? 100) : Math.min(nextClaimAt, heartbeatAt); const scheduleTimeout = dependencies.cadenceSetTimeout ?? ((callback: () => void | Promise<void>, timeoutMs: number) => globalThis.setTimeout(() => { void callback(); }, timeoutMs)); timer = scheduleTimeout(() => runTick().catch(() => {}).finally(scheduleNext), Math.max(0, deadline - now)); };
    pi.on("session_start", async (_event, ctx) => { bridgeContext = ctx; try { const childSessionId = ctx?.sessionManager.getSessionId() ?? env.PI_SESSION_ID; const childSessionFile = ctx?.sessionManager.getSessionFile() ?? env.PI_SESSION_FILE; if (childSessionId && childSessionFile) { let binding; try { binding = await readCurrentPiRuntimeGeneration(stateRoot, meshId, agentId, childSessionId, childSessionFile); } catch (error) { if (!dependencies.standaloneRuntimeBinding) throw error; binding = await bindAgentRuntime(stateRoot, meshId, agentId, { runtimeId, kind: "pi", sessionId: childSessionId, sessionFile: childSessionFile }); } runtimeId = binding.runtimeId; await (dependencies.recordChildSessionIdentity ?? recordChildSessionIdentity)(stateRoot, meshId, agentId, childSessionId, childSessionFile, runtimeId); } else throw new Error("Mesh child session requires durable session identity"); if (hasResolvedAgent && (invalid || !activatedExpected)) throw new Error(invalid || !expectedEnvelope ? "Mesh launch envelope is invalid" : `Child role ${expectedEnvelope.role} did not resolve from its launch envelope`); try { const configuredReserveTokens = dependencies.resolveCompactionReserveTokens?.(ctx) ?? SettingsManager.create(ctx.cwd ?? process.cwd(), getAgentDir()).getCompactionReserveTokens(); reserveTokens = configuredReserveTokens ?? NATIVE_COMPACTION_RESERVE_TOKENS; } catch { reserveTokens = NATIVE_COMPACTION_RESERVE_TOKENS; } await publishActivity("starting"); await markReadyAfterPublication(stateRoot, meshId, agentId, launchEnvelopeDigest(expectedEnvelope!), runtimeId, dependencies);
            fallbackSuspended = false;
            if (expectedEnvelope) {
                const status = await readAgentStatus({ directory, agent: `${directory}/agent.json`, status: `${directory}/status.json`, stop: `${directory}/stop.json`, events: `${directory}/events.jsonl`, session: `${directory}/session` }, meshId);
                const profile = expectedEnvelope.executionProfile;
                const initialRoute = initialModelRoute(profile, expectedEnvelope.initialCandidateIndex);
                const persisted = restoreCompatibleRoute(profile, expectedEnvelope.selectedProfile, status.modelRoute ? { profile: expectedEnvelope.selectedProfile, candidates: profile.models, route: status.modelRoute } : undefined);
                route = initialRoute;
                if (persisted) {
                    applyingSetModel = true;
                    let restored: Awaited<ReturnType<typeof preflightProfileCandidates>>;
                    try {
                        restored = await preflightProfileCandidates({
                            profile,
                            profileName: expectedEnvelope.selectedProfile,
                            registry: ctx.modelRegistry ?? { find: () => undefined },
                            route: reconcileForwardIndex(profile, persisted, ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined),
                            setModel: async model => !shuttingDown && typeof pi.setModel === "function" && await pi.setModel(model) && !shuttingDown,
                        });
                    } finally { applyingSetModel = false; }
                    if (!restored.ok) throw new Error(restored.error);
                    route = restored.route;
                    if (profile.thinkingLevel) pi.setThinkingLevel(profile.thinkingLevel);
                }
                if (!status.modelRoute || status.modelRoute.activeIndex !== route.activeIndex || status.modelRoute.activeModel !== route.activeModel || status.modelRoute.attempts.length !== route.attempts.length) await persistRouteStatus(route);
            }
            await publishActivity("idle"); await runTick(true); taskWake = await createDirectoryWake({ directory: workerTaskInboxDirectory(stateRoot, meshId, agentId), run: () => runTick(true), onError: error => { try { bridgeContext?.ui.setStatus("mesh-task-wake", `Mesh task wake: ${error instanceof Error ? error.message : String(error)}`); } catch {} }, dependencies: dependencies.wake }); scheduleNext(); } catch (error) { await (dependencies.failAgent ?? failAgent)(stateRoot, meshId, agentId, error instanceof Error ? error.message : String(error), false, { expectedRuntimeId: runtimeId }).catch(() => {}); shutdownAfterStoreFailure = true; ctx?.shutdown(); } });
    pi.on("before_agent_start", async event => { if (awaitingDelivery?.prompt === event.prompt) awaitingDelivery = undefined; await publishActivity("running"); }); pi.on("agent_start", async () => { awaitingDelivery = undefined; settled = false; turnHadToolError = false; await publishActivity("running"); });
    pi.on("turn_start", () => { turnHadToolError = false; });
    pi.on("turn_end", event => { if (event.toolResults.some(result => result.isError)) turnHadToolError = true; });
    pi.on("session_before_compact", async event => { awaitingPostCompactionSettlement = false; compactionReason = event.reason; const observation = ++compactionObservation; await publishActivity("compacting"); event.signal.addEventListener("abort", () => { if (compactionObservation === observation && activityPhase === "compacting") { awaitingPostCompactionSettlement = false; void publishActivity(activeTaskId || !settled ? "running" : "idle").catch(() => {}); } }, { once: true }); });
    pi.on("session_compact", async event => { if (event.willRetry || activeTaskId || !settled) { awaitingPostCompactionSettlement = false; compactionReason = undefined; await publishActivity("running"); } else awaitingPostCompactionSettlement = true; });
    pi.on("input", async event => { if (event.source !== "interactive") return { action: "continue" as const }; settled = false; const mode = event.streamingBehavior ?? (activeTaskId ? "followUp" : "idle"); await recordIntervention(stateRoot, meshId, agentId, { taskId: activeTaskId, text: event.text, deliveryMode: mode, images: imageTypes(event.images) }, runtimeId); return { action: "continue" as const }; });
    pi.on("message_end", async event => { const message = record(event.message); if (message.role === "assistant") { if (activeTaskId) { addUsage(taskUsage, usage(message.usage)); turns += 1; output = text(message); stopReason = typeof message.stopReason === "string" ? message.stopReason as StopReason : undefined; errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : undefined; } else { const idle = emptyUsage(); addUsage(idle, usage(message.usage)); await recordIdleUsage(stateRoot, meshId, agentId, idle, runtimeId); } } else if (message.role === "toolResult") { if (message.isError === true) turnHadToolError = true; if (activeTaskId) addUsage(taskUsage, usage(message.usage)); else { const idle = emptyUsage(); addUsage(idle, usage(message.usage)); await recordIdleUsage(stateRoot, meshId, agentId, idle, runtimeId); } } });
    pi.on("model_select", event => { if (applyingSetModel || event.source === "restore") return; fallbackSuspended = true; bridgeContext?.ui.notify("Automatic profile fallback suspended after explicit model selection", "info"); });
    pi.on("agent_settled", async () => {
        const settledStopReason = stopReason;
        const settledErrorMessage = errorMessage;
        const toolError = turnHadToolError;
        stopReason = undefined;
        errorMessage = undefined;
        turnHadToolError = false;
        awaitingDelivery = undefined; awaitingPostCompactionSettlement = false; compactionReason = undefined;
        if (activeTaskId && !pendingCompletion && await queueStoppedPromotion()) {
            settled = true;
            await runTick().catch(() => {}); scheduleNext(); await publishActivity("idle").catch(() => {});
            return;
        }
        const pendingPromotion = toolError ? undefined : promoteAfterError(settledStopReason, settledErrorMessage);
        if (pendingPromotion) promotionPass = pendingPromotion;
        let fallback: "promoted" | "exhausted" | "stopped" | "settle";
        try { fallback = toolError ? "settle" : await pendingPromotion!; } finally { if (promotionPass === pendingPromotion) promotionPass = undefined; }
        if (fallback === "promoted") { settled = false; scheduleNext(); await publishActivity("running").catch(() => {}); return; }
        settled = true;
        if (fallback !== "exhausted" && fallback !== "stopped" && activeTaskId && !pendingCompletion) {
            if (!await queueStoppedPromotion()) queueCompletion(activeTaskId, { ...terminal(settledStopReason, settledErrorMessage), output, usage: taskUsage, turns });
        }
        await runTick().catch(() => {}); scheduleNext(); await publishActivity("idle").catch(() => {});
    });
    pi.on("session_shutdown", async event => { shuttingDown = true; try { await promotionPass?.catch(() => {}); await taskWake?.close(); taskWake = undefined; if (timer !== undefined) { (dependencies.cadenceClearTimeout ?? (value => clearTimeout(value as NodeJS.Timeout)))(timer); timer = undefined; } await tickPass?.catch(() => {}); awaitingDelivery = undefined; await publishActivity("offline").catch(() => {}); if (shutdownAfterStoreFailure) return; if (pendingCompletion) await persistCompletion().catch(() => {}); if (event.reason !== "quit") { if (activeTaskId) await finishTask(stateRoot, meshId, activeTaskId, { outcome: "failed", error: `Child Pi session was replaced (${event.reason}) during the task` }, runtimeId); return; } const status = await readAgentStatus({ directory, agent: `${directory}/agent.json`, status: `${directory}/status.json`, stop: `${directory}/stop.json`, events: `${directory}/events.jsonl`, session: `${directory}/session` }, meshId).catch(() => undefined); if (status && status.state !== "stopping" && status.state !== "stopped" && status.state !== "failed") await failAgent(stateRoot, meshId, agentId, "Child Pi session shut down", false, { expectedRuntimeId: runtimeId }); } finally { bridgeContext = undefined; await unbindAgentRuntime(stateRoot, meshId, agentId, runtimeId).catch(() => {}); } });
    return true;
}
export default registerMeshChildBridge;
