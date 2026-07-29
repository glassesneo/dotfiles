import type { StopReason, Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { onActiveProfile } from "./utilities/profile_events.ts";
import { validateResolvedProfile } from "./utilities/profile_types.ts";
import { addUsage, emptyUsage, type TerminalTaskState } from "./utilities/subagent_types.ts";
import { claimPendingTask, failAgent, finishTask, markBridgeReady, agentPaths, readAgentStatus, recordChildSessionIdentity, recordIdleUsage, recordIntervention } from "./utilities/subagent_store.ts";

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
    now?: () => number;
}

function expectedResolvedProfileName(env: NodeJS.ProcessEnv): string | undefined {
    const raw = env.PI_AGENT_RESOLVED_PROFILE;
    if (!raw) return undefined;
    return validateResolvedProfile(JSON.parse(raw)).name;
}

export function registerSubagentChildBridge(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env, dependencies: SubagentChildBridgeDependencies = {}): boolean {
    const agentId = env.PI_SUBAGENT_AGENT_ID;
    const directory = env.PI_SUBAGENT_AGENT_DIR;
    if (!agentId || !directory) return false;
    const stateRoot = directory.replace(/\/agents\/[^/]+$/u, "");
    const hasResolvedProfile = Boolean(env.PI_AGENT_RESOLVED_PROFILE);
    let expectedProfile: string | undefined;
    let resolvedProfileInvalid = false;
    if (hasResolvedProfile) {
        try { expectedProfile = expectedResolvedProfileName(env); }
        catch { resolvedProfileInvalid = true; }
    }
    let activatedExpected = false;
    onActiveProfile(pi, event => {
        if (expectedProfile !== undefined && event.name === expectedProfile) activatedExpected = true;
    });
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
    let timer: NodeJS.Timeout | undefined;
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
        const paths = agentPaths(stateRoot, agentId);
        const childSessionId = ctx?.sessionManager.getSessionId() ?? env.PI_SESSION_ID;
        const childSessionFile = ctx?.sessionManager.getSessionFile() ?? env.PI_SESSION_FILE;
        if (childSessionId) await recordChildSessionIdentity(paths, childSessionId, childSessionFile);
        if (hasResolvedProfile && (resolvedProfileInvalid || !activatedExpected)) {
            const reason = resolvedProfileInvalid || !expectedProfile
                ? "Child resolved profile is invalid"
                : `Child profile ${expectedProfile} did not become active`;
            await failAgent(stateRoot, agentId, reason);
            ctx?.shutdown();
            return;
        }
        await markBridgeReady(paths);
        timer = setInterval(() => { void tick().catch(() => {}); }, dependencies.retryIntervalMs ?? 100);
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
        if (timer) clearInterval(timer);
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
