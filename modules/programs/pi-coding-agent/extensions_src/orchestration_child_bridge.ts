import { readFileSync } from "node:fs";
import type { StopReason, Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { onResolvedAgent } from "./utilities/agent_events.ts";
import { launchEnvelopeDigest, validateLaunchEnvelope } from "./utilities/agent_types.ts";
import { addUsage, emptyUsage, type TerminalTaskState } from "./utilities/orchestration_types.ts";
import { claimPendingTask, failAgent, finishTask, markBridgeReady, agentPaths, readAgentStatus, readTaskCancellation, recordChildSessionIdentity, recordIdleUsage, recordIntervention } from "./utilities/orchestration_store.ts";

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function usage(value: unknown): Partial<Usage> | undefined { const item = record(value); return typeof item.input === "number" || typeof item.output === "number" ? item as unknown as Partial<Usage> : undefined; }
function text(value: unknown): string { const message = record(value); if (!Array.isArray(message.content)) return ""; return message.content.map(part => { const item = record(part); return item.type === "text" && typeof item.text === "string" ? item.text : ""; }).join(""); }
function imageTypes(images: unknown): string[] { if (!Array.isArray(images)) return []; return images.map(image => record(image).mimeType).filter((type): type is string => typeof type === "string"); }
function terminal(stopReason: StopReason | undefined, errorMessage: string | undefined): { outcome: TerminalTaskState; error?: string } {
    if (stopReason === "aborted") return { outcome: "stopped", error: errorMessage ?? "Assistant turn was aborted" };
    if (stopReason === "error") return { outcome: "failed", error: errorMessage ?? "Assistant turn failed" };
    if (stopReason === "length") return { outcome: "failed", error: errorMessage ?? "Assistant turn reached the token limit" };
    if (stopReason === "toolUse") return { outcome: "failed", error: errorMessage ?? "Assistant settled while awaiting tool execution" };
    return { outcome: "succeeded" };
}

export interface SubagentChildBridgeDependencies {
    finishTask?: typeof finishTask;
    retryIntervalMs?: number;
    deliveryAckTimeoutMs?: number;
    publicationTimeoutMs?: number;
    publicationRetryMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => number;
    setInterval?: (callback: () => void | Promise<void>, intervalMs: number) => unknown;
    clearInterval?: (timer: unknown) => void;
}

function expectedResolvedAgent(env: NodeJS.ProcessEnv) { const path = env.PI_AGENT_RESOLVED_AGENT; return path ? validateLaunchEnvelope(JSON.parse(readFileSync(path, "utf8"))) : undefined; }
function isMissingPublication(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === "ENOENT"; }

async function markReadyAfterPublication(paths: ReturnType<typeof agentPaths>, digest: string, dependencies: SubagentChildBridgeDependencies): Promise<void> {
    const now = dependencies.now ?? Date.now;
    const deadline = now() + (dependencies.publicationTimeoutMs ?? 5000);
    const sleep = dependencies.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    while (true) {
        try { await markBridgeReady(paths, digest); return; }
        catch (error) {
            if (!isMissingPublication(error)) throw error;
            if (now() >= deadline) throw new Error("Timed out waiting for parent agent publication");
            await sleep(dependencies.publicationRetryMs ?? 25);
        }
    }
}

export function registerSubagentChildBridge(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env, dependencies: SubagentChildBridgeDependencies = {}): boolean {
    const agentId = env.PI_SUBAGENT_AGENT_ID;
    const directory = env.PI_SUBAGENT_AGENT_DIR;
    if (!agentId || !directory) return false;
    const stateRoot = directory.replace(/\/agents\/[^/]+$/u, "");
    const hasResolvedAgent = Boolean(env.PI_AGENT_RESOLVED_AGENT);
    let expectedEnvelope: ReturnType<typeof expectedResolvedAgent>; let resolvedAgentInvalid = false; let activatedExpected = false;
    if (hasResolvedAgent) { try { expectedEnvelope = expectedResolvedAgent(env); } catch { resolvedAgentInvalid = true; } }
    onResolvedAgent(pi, event => { if (expectedEnvelope !== undefined && launchEnvelopeDigest(event.envelope) === launchEnvelopeDigest(expectedEnvelope)) activatedExpected = true; });
    let activeTaskId: string | undefined;
    let taskUsage = emptyUsage();
    let turns = 0;
    let output = "";
    let stopReason: StopReason | undefined;
    let errorMessage: string | undefined;
    let pumping = false;
    let completing = false;
    let settled = true;
    let pendingCompletion: { taskId: string; input: Parameters<typeof finishTask>[3] } | undefined;
    let awaitingDelivery: { taskId: string; prompt: string; deadline: number } | undefined;
    let timer: unknown;
    let bridgeContext: ExtensionContext | undefined;
    let cancellationAbortedTaskId: string | undefined;
    const persistCompletion = async () => {
        if (!pendingCompletion || completing) return;
        completing = true;
        const pending = pendingCompletion;
        try {
            await (dependencies.finishTask ?? finishTask)(stateRoot, agentId, pending.taskId, pending.input);
            if (pendingCompletion === pending) pendingCompletion = undefined;
            if (activeTaskId === pending.taskId) activeTaskId = undefined;
        } finally { completing = false; }
    };
    const pump = async () => {
        if (pumping || pendingCompletion || activeTaskId || !settled) return;
        pumping = true;
        try {
            const task = await claimPendingTask(stateRoot, agentId);
            if (!task) return;
            activeTaskId = task.request.taskId;
            cancellationAbortedTaskId = undefined;
            taskUsage = emptyUsage();
            turns = 0;
            output = "";
            stopReason = undefined;
            errorMessage = undefined;
            settled = false;
            awaitingDelivery = { taskId: task.request.taskId, prompt: task.request.prompt, deadline: (dependencies.now ?? Date.now)() + (dependencies.deliveryAckTimeoutMs ?? 5000) };
            try { pi.sendUserMessage(task.request.prompt); }
            catch (error) {
                awaitingDelivery = undefined;
                settled = true;
                pendingCompletion = { taskId: task.request.taskId, input: { outcome: "failed", error: `Could not deliver task: ${error instanceof Error ? error.message : String(error)}` } };
                await persistCompletion();
            }
        } finally { pumping = false; }
    };
    const tick = async () => {
        if (activeTaskId && cancellationAbortedTaskId !== activeTaskId) {
            const cancellation = await readTaskCancellation(stateRoot, agentId, activeTaskId);
            if (cancellation) {
                cancellationAbortedTaskId = activeTaskId;
                if (awaitingDelivery?.taskId === activeTaskId) {
                    awaitingDelivery = undefined;
                    settled = true;
                    pendingCompletion = { taskId: activeTaskId, input: { outcome: "stopped", output, usage: taskUsage, turns, error: cancellation.reason } };
                } else bridgeContext?.abort();
            }
        }
        if (awaitingDelivery && (dependencies.now ?? Date.now)() >= awaitingDelivery.deadline) {
            const taskId = awaitingDelivery.taskId;
            awaitingDelivery = undefined;
            settled = true;
            pendingCompletion = { taskId, input: { outcome: "failed", error: "Could not deliver task: child Pi did not accept the extension message" } };
        }
        if (pendingCompletion) await persistCompletion();
        if (!pendingCompletion) await pump();
    };
    pi.on("session_start", async (_event, ctx?: ExtensionContext) => {
        bridgeContext = ctx;
        const paths = agentPaths(stateRoot, agentId);
        const childSessionId = ctx?.sessionManager.getSessionId() ?? env.PI_SESSION_ID;
        const childSessionFile = ctx?.sessionManager.getSessionFile() ?? env.PI_SESSION_FILE;
        if (childSessionId) await recordChildSessionIdentity(paths, childSessionId, childSessionFile);
        if (hasResolvedAgent && (resolvedAgentInvalid || !activatedExpected)) {
            const reason = resolvedAgentInvalid || !expectedEnvelope
                ? "Child resolved agent envelope is invalid"
                : `Child identity ${expectedEnvelope.identity} did not resolve from the complete launch envelope`;
            await failAgent(stateRoot, agentId, reason);
            ctx?.shutdown();
            return;
        }
        try { await markReadyAfterPublication(paths, launchEnvelopeDigest(expectedEnvelope!), dependencies); }
        catch (error) { await failAgent(stateRoot, agentId, error instanceof Error ? error.message : String(error)); ctx?.shutdown(); return; }
        const schedule = dependencies.setInterval ?? ((callback, intervalMs) => setInterval(() => { void callback(); }, intervalMs));
        timer = schedule(() => tick().catch(() => {}), dependencies.retryIntervalMs ?? 100);
        await tick();
    });
    pi.on("before_agent_start", event => { if (awaitingDelivery?.prompt === event.prompt) awaitingDelivery = undefined; });
    pi.on("agent_start", () => { awaitingDelivery = undefined; settled = false; });
    pi.on("input", async event => {
        if (event.source === "extension") return { action: "continue" as const };
        if (event.source !== "interactive") return { action: "continue" as const };
        settled = false;
        const mode = event.streamingBehavior ?? (activeTaskId ? "followUp" : "idle");
        await recordIntervention(stateRoot, agentId, { taskId: activeTaskId, text: event.text, deliveryMode: mode, images: imageTypes(event.images) });
        return { action: "continue" as const };
    });
    pi.on("message_end", async event => {
        const message = record(event.message);
        if (message.role === "assistant") {
            if (activeTaskId) {
                addUsage(taskUsage, usage(message.usage));
                turns += 1;
                output = text(message);
                stopReason = typeof message.stopReason === "string" ? message.stopReason as StopReason : undefined;
                errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : undefined;
            } else { const idleUsage = emptyUsage(); addUsage(idleUsage, usage(message.usage)); await recordIdleUsage(stateRoot, agentId, idleUsage); }
        } else if (message.role === "toolResult" && activeTaskId) addUsage(taskUsage, usage(message.usage));
    });
    pi.on("agent_settled", async () => {
        awaitingDelivery = undefined;
        settled = true;
        if (activeTaskId && !pendingCompletion) pendingCompletion = { taskId: activeTaskId, input: { ...terminal(stopReason, errorMessage), output, usage: taskUsage, turns } };
        await tick();
    });
    pi.on("session_shutdown", async event => {
        if (timer !== undefined) (dependencies.clearInterval ?? (value => clearInterval(value as NodeJS.Timeout)))(timer);
        awaitingDelivery = undefined;
        if (pendingCompletion) await persistCompletion().catch(() => {});
        if (event.reason !== "quit") {
            if (activeTaskId) await finishTask(stateRoot, agentId, activeTaskId, { outcome: "failed", error: `Child pi session was replaced (${event.reason}) during the task` });
            return;
        }
        const status = await readAgentStatus(agentPaths(stateRoot, agentId)).catch(() => undefined);
        if (status && status.state !== "stopped" && status.state !== "failed") await failAgent(stateRoot, agentId, "Child pi session shut down", status.state === "stopping");
    });
    return true;
}
export default registerSubagentChildBridge;
