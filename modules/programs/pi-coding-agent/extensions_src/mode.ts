import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSkillsForPrompt, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { provideCommandPaletteContribution } from "./utilities/command_palette_contributions.ts";
import { emitActiveMode, type ActiveModeReason } from "./utilities/mode_events.ts";
import {
    PARENT_TRANSITION_REQUEST_EVENT,
    PARENT_TRANSITION_RESULT_EVENT,
    validateParentTransitionResult,
    type ParentTransitionResult,
} from "./utilities/orchestration_transition.ts";
import {
    PROFILE_FALLBACK_CONTINUATION_TYPE,
    formatProfileFallbackContinuation,
    reconcileProfileRoute,
    restoreCompatibleProfileRoute,
    selectProfileCandidate,
    promoteProfileCandidate,
    type ProfileRoute,
} from "./utilities/pi_profile_fallback.ts";
import {
    validateModeConfig,
    type AgentMode,
    type AgentModeConfig,
    type ExecutionConfig,
    type ThinkingLevel,
} from "./utilities/mode_types.ts";

const CONFIG = join(getAgentDir(), "agent-modes.json");
const MODE_STATE = "agent-mode-state";
const PARENT_EXECUTION_STATE = "agent-parent-execution-state";
const PARENT_EXECUTION_PROFILE = "parent";
const MODE_STATUS = "agent-mode-identity";
const MESH_TRANSITION = "agent-mesh-transition";
const HANDOFF_METADATA = "agent-session-handoff";
const TRANSITION_TIMEOUT_MS = 15000;
const PENDING_TRANSITION_TTL_MS = 5 * 60 * 1000;
interface TransitionReceipt { schemaVersion: 1; kind: "mode" | "handoff"; status: "applied" | "prepared"; mode?: string; requestId?: string; completedAt: string }
interface HandoffMetadata { schemaVersion: 1; requestId: string; sourceSessionId: string; targetMode: string }
interface ModeState { schemaVersion: 2; mode: string }
type ParentExecutionDisposition = "active" | "manual" | "exhausted";
interface ParentExecutionState { schemaVersion: 1; state: ParentExecutionDisposition; models: string[]; thinkingLevel: ThinkingLevel; route: ProfileRoute }
type ModeSwitchResult = { status: "applied" | "unchanged" | "refused" | "failed"; error?: string };

export async function loadAgentModeConfig(path = CONFIG): Promise<AgentModeConfig> {
    try { return validateModeConfig(JSON.parse(await readFile(path, "utf8"))); }
    catch (error) { throw new Error(`Cannot read agent mode config ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}
function modelName(model: ExtensionContext["model"]): string | undefined { return model ? `${model.provider}/${model.id}` : undefined; }
function latestCustomData(ctx: ExtensionContext, customType: string): unknown {
    const entry = [...ctx.sessionManager.getBranch()].reverse().find(item => item.type === "custom" && item.customType === customType) as { data?: unknown } | undefined;
    return entry?.data;
}
function restoredMode(ctx: ExtensionContext): string | undefined {
    const data = latestCustomData(ctx, MODE_STATE) as Partial<ModeState> | undefined;
    return data?.schemaVersion === 2 && typeof data.mode === "string" ? data.mode : undefined;
}
function restoredExecutionState(ctx: ExtensionContext): Partial<ParentExecutionState> | undefined {
    const value = latestCustomData(ctx, PARENT_EXECUTION_STATE);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Partial<ParentExecutionState> : undefined;
}
function restoredHandoffMetadata(ctx: ExtensionContext): Partial<HandoffMetadata> | undefined {
    const value = latestCustomData(ctx, HANDOFF_METADATA);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Partial<HandoffMetadata> : undefined;
}
function executionIdentityMatches(execution: ExecutionConfig, state: Partial<ParentExecutionState>): state is ParentExecutionState {
    return state.schemaVersion === 1
        && (state.state === "active" || state.state === "manual" || state.state === "exhausted")
        && Array.isArray(state.models)
        && state.models.length === execution.models.length
        && state.models.every((model, index) => model === execution.models[index])
        && state.thinkingLevel === execution.thinkingLevel
        && Boolean(state.route);
}
export function modeIdentityText(name: string, model = "unavailable", fallbackCount = 0): string {
    return `PARENT · mode:${name} · model:${model} · fallback:${fallbackCount}`;
}

export function registerModeController(pi: ExtensionAPI, configPath = CONFIG): { activeMode: () => string | undefined } {
    let config: AgentModeConfig | undefined;
    let activeName: string | undefined;
    let activeMode: AgentMode | undefined;
    let activeRoute: ProfileRoute | undefined;
    let executionState: ParentExecutionDisposition | undefined;
    let applyingSelection = false;
    let shuttingDown = false;
    let lastAssistantStopReason: string | undefined;
    let turnHadToolError = false;
    let activeTaskPrompt: string | undefined;
    let pendingFallbackPrompt: string | undefined;
    const setTools = (tools: string[]) => { const current = pi.getActiveTools(); if (current.length !== tools.length || current.some((tool, index) => tool !== tools[index])) pi.setActiveTools(tools); };
    const reassertTools = () => { if (activeMode) setTools(activeMode.tools); };
    const setIdentity = (ctx: ExtensionContext) => {
        if (!activeName) return;
        const routedModel = executionState === "active" ? activeRoute?.activeModel : undefined;
        ctx.ui.setStatus(MODE_STATUS, modeIdentityText(activeName, routedModel ?? modelName(ctx.model), activeRoute?.activeIndex ?? 0));
    };
    const ensureConfig = async (): Promise<void> => { config = config ?? await loadAgentModeConfig(configPath); };
    const persistExecution = (): void => {
        const execution = config?.execution;
        if (!execution || !executionState || !activeRoute || execution.thinkingLevel === undefined || activeRoute.activeModel !== execution.models[activeRoute.activeIndex]) return;
        pi.appendEntry(PARENT_EXECUTION_STATE, {
            schemaVersion: 1,
            state: executionState,
            models: [...execution.models],
            thinkingLevel: execution.thinkingLevel,
            route: structuredClone(activeRoute),
        } satisfies ParentExecutionState);
    };
    const restoreRoute = (ctx: ExtensionContext, execution: ExecutionConfig, state: ParentExecutionState): ProfileRoute | undefined => {
        const route = restoreCompatibleProfileRoute(execution, PARENT_EXECUTION_PROFILE, {
            profile: PARENT_EXECUTION_PROFILE,
            models: state.models,
            route: state.route,
        });
        return route ? reconcileProfileRoute(execution, route, modelName(ctx.model)) : undefined;
    };
    const initializeExecution = async (ctx: ExtensionContext, route?: ProfileRoute): Promise<boolean> => {
        const execution = config!.execution;
        applyingSelection = true;
        try {
            const result = await selectProfileCandidate({
                profile: execution,
                profileName: PARENT_EXECUTION_PROFILE,
                registry: ctx.modelRegistry,
                route,
                activate: async model => {
                    if (shuttingDown) return false;
                    const selected = await pi.setModel(model);
                    return selected && !shuttingDown;
                },
            });
            activeRoute = result.route;
            if (!result.ok) {
                executionState = "exhausted";
                persistExecution();
                setIdentity(ctx);
                ctx.ui.notify(result.error, "error");
                return false;
            }
            if (shuttingDown) return false;
            pi.setThinkingLevel(execution.thinkingLevel!);
            executionState = "active";
            persistExecution();
            setIdentity(ctx);
            return true;
        } catch (error) {
            executionState = "exhausted";
            persistExecution();
            setIdentity(ctx);
            ctx.ui.notify(`Parent execution: ${error instanceof Error ? error.message : String(error)}`, "error");
            return false;
        } finally { applyingSelection = false; }
    };
    const restoreExecution = async (ctx: ExtensionContext): Promise<void> => {
        const execution = config!.execution;
        const saved = restoredExecutionState(ctx);
        if (!saved || !executionIdentityMatches(execution, saved)) { await initializeExecution(ctx); return; }
        const route = restoreRoute(ctx, execution, saved);
        if (!route) { await initializeExecution(ctx); return; }
        activeRoute = route;
        executionState = saved.state;
        if (saved.state === "active") await initializeExecution(ctx, route);
        else setIdentity(ctx);
    };
    const applyModeDirect = async (name: string, ctx: ExtensionContext, persist: boolean, reason: ActiveModeReason): Promise<boolean> => {
        if (!ctx.isIdle()) { ctx.ui.notify("Mode can only be changed while the agent is idle", "warning"); return false; }
        await ensureConfig();
        const mode = config!.modes[name];
        if (!mode) { ctx.ui.notify(`Unknown mode ${name}. Available: ${Object.keys(config!.modes).join(", ")}`, "error"); return false; }
        const allTools = pi.getAllTools().map(tool => tool.name);
        const missing = mode.tools.filter(tool => !allTools.includes(tool));
        if (missing.length) { ctx.ui.notify(`Mode ${name}: tools unavailable: ${missing.join(", ")}`, "error"); return false; }
        const previousTools = pi.getActiveTools();
        try { setTools(mode.tools); }
        catch (error) {
            try { setTools(previousTools); } catch { /* Preserve the original mode and report the applying failure. */ }
            ctx.ui.notify(`Mode ${name}: ${error instanceof Error ? error.message : String(error)}`, "error");
            return false;
        }
        activeName = name;
        activeMode = structuredClone(mode);
        setIdentity(ctx);
        if (persist) pi.appendEntry(MODE_STATE, { schemaVersion: 2, mode: name } satisfies ModeState);
        emitActiveMode(pi, name, reason);
        return true;
    };
    const transitionRequests = new Map<string, { resolve: (result: ParentTransitionResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    pi.events.on(PARENT_TRANSITION_RESULT_EVENT, value => {
        let result: ParentTransitionResult;
        try { result = validateParentTransitionResult(value); }
        catch { return; }
        const pending = transitionRequests.get(result.requestId);
        if (!pending) return;
        transitionRequests.delete(result.requestId);
        clearTimeout(pending.timer);
        pending.resolve(result);
    });
    const requestTransition = (operation: "prepare" | "apply" | "cancel", fields: { token?: string; kind?: "mode" | "handoff"; fromMode?: string; targetMode?: string }): Promise<ParentTransitionResult> => {
        if (transitionRequests.size) return Promise.reject(new Error("A parent transition is already in progress"));
        const requestId = randomUUID();
        return new Promise<ParentTransitionResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                transitionRequests.delete(requestId);
                reject(new Error(`Parent transition ${operation} timed out waiting for the mesh responder`));
            }, TRANSITION_TIMEOUT_MS);
            transitionRequests.set(requestId, {
                timer,
                resolve: result => { clearTimeout(timer); resolve(result); },
                reject: error => { clearTimeout(timer); reject(error); },
            });
            pi.events.emit(PARENT_TRANSITION_REQUEST_EVENT, { schemaVersion: 1, operation, requestId, ...fields });
        });
    };
    const transitionError = (status: "rejected" | "failed", error: unknown): ParentTransitionResult => ({ schemaVersion: 1, requestId: "", status, error: error instanceof Error ? error.message : String(error) });
    const toolErrorResult = (message: string) => ({ content: [{ type: "text" as const, text: message }], details: undefined, isError: true });
    const pendingTransitionMessage = "A parent transition is already pending; wait for it to settle before scheduling another";
    const switchMode = async (name: string, ctx: ExtensionContext, options: { persist: boolean; reason: ActiveModeReason; triggerTurn?: boolean; receiptRequestId?: string }): Promise<ModeSwitchResult> => {
        await ensureConfig();
        if (name === activeName && activeMode) return { status: "unchanged" };
        const mode = config!.modes[name];
        if (!mode) { const error = `Unknown mode ${name}. Available: ${Object.keys(config!.modes).join(", ")}`; ctx.ui.notify(error, "error"); return { status: "failed", error }; }
        const allTools = pi.getAllTools().map(tool => tool.name);
        const missing = mode.tools.filter(tool => !allTools.includes(tool));
        if (missing.length) { const error = `Mode ${name}: tools unavailable: ${missing.join(", ")}`; ctx.ui.notify(error, "error"); return { status: "failed", error }; }
        const prepared = await requestTransition("prepare", { kind: "mode", fromMode: activeName, targetMode: name }).catch(error => transitionError("rejected", error));
        if (prepared.status !== "prepared" || !prepared.token) {
            const error = prepared.error ?? "mesh transition prepare failed";
            ctx.ui.notify(`Mode switch to ${name} was refused: ${error}`, "error");
            return { status: "refused", error };
        }
        const previousName = activeName;
        const previousMode = activeMode;
        const previousTools = pi.getActiveTools();
        try { setTools(mode.tools); }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            try { setTools(previousTools); } catch { /* Preserve the original mode and report the applying failure. */ }
            await requestTransition("cancel", { token: prepared.token, kind: "mode" }).catch(() => {});
            ctx.ui.notify(`Mode ${name}: ${message}`, "error");
            return { status: "failed", error: message };
        }
        activeName = name;
        activeMode = structuredClone(mode);
        setIdentity(ctx);
        if (options.persist) pi.appendEntry(MODE_STATE, { schemaVersion: 2, mode: name } satisfies ModeState);
        const applied = await requestTransition("apply", { token: prepared.token, kind: "mode" }).catch(error => transitionError("failed", error));
        if (applied.status !== "applied") {
            // Roll back the parent side and leave the fence in place: the mesh stays suspended until the user resolves it.
            try { setTools(previousTools); } catch { /* Keep the failed state visible and report it below. */ }
            activeName = previousName;
            activeMode = previousMode;
            setIdentity(ctx);
            if (options.persist && previousName) pi.appendEntry(MODE_STATE, { schemaVersion: 2, mode: previousName } satisfies ModeState);
            const error = applied.error ?? "mesh transition apply failed";
            ctx.ui.notify(`Mode switch to ${name} failed: ${error}. Mesh mutations remain suspended; review the failure before continuing.`, "error");
            return { status: "failed", error };
        }
        pi.appendEntry(MESH_TRANSITION, {
            schemaVersion: 1,
            kind: "mode",
            status: "applied",
            mode: name,
            ...(options.receiptRequestId === undefined ? {} : { requestId: options.receiptRequestId }),
            completedAt: new Date().toISOString(),
        } satisfies TransitionReceipt);
        emitActiveMode(pi, name, options.reason);
        if (options.triggerTurn) pi.sendMessage({ customType: "agent-mode-continuation", content: `Agent mode is now ${name}. Continue under the new mode.`, display: false }, { triggerTurn: true, deliverAs: "followUp" });
        return { status: "applied" };
    };
    const batchToolCalls = new Map<string, string>();
    const isStandaloneSwitchCall = async (toolCallId: string, toolName: string): Promise<string | undefined> => {
        // Give sibling tool_call events in the same model batch a short window to be observed.
        await new Promise(resolve => setTimeout(resolve, 250));
        if (batchToolCalls.size !== 1 || batchToolCalls.get(toolCallId) !== toolName) return `Tool ${toolName} must be the only tool call in its batch`;
        return undefined;
    };
    pi.on("turn_start", () => { batchToolCalls.clear(); });
    pi.on("tool_call", event => { batchToolCalls.set(event.toolCallId, event.toolName); });
    const chooseMode = async (ctx: ExtensionContext) => {
        if (!ctx.isIdle()) { ctx.ui.notify("Mode can only be changed while the agent is idle", "warning"); return; }
        await ensureConfig(); const selected = await ctx.ui.select("Agent mode", Object.keys(config!.modes)); if (selected) await switchMode(selected, ctx, { persist: true, reason: "switch" });
    };
    pi.registerFlag("agent-mode", { description: "Top-level agent mode", type: "string" });
    pi.registerCommand("mode", { description: "Show or switch the top-level agent mode", getArgumentCompletions(prefix) { if (!config) return null; return Object.entries(config.modes).filter(([name]) => name.startsWith(prefix)).map(([value, mode]) => ({ value, label: value, description: mode.description })); }, async handler(args, ctx) { if (!ctx.isIdle()) { ctx.ui.notify("Mode can only be changed while the agent is idle", "warning"); return; } const name = args.trim(); if (name) await switchMode(name, ctx, { persist: true, reason: "switch" }); else await chooseMode(ctx); } });
    provideCommandPaletteContribution(pi.events, { owner: "mode", id: "select", label: "/mode  Select agent mode", description: "Choose recon, leader, or ops for the parent session.", keywords: ["mode", "recon", "leader", "ops"], currentValue: () => activeName ? `Current: ${activeName}` : undefined, disabledReason: ctx => ctx.isIdle() ? undefined : "Mode can only be changed while the agent is idle", async run(ctx) { await chooseMode(ctx); return "return" as const; } });
    const transitionReceipt = (receipt: TransitionReceipt) => { pi.appendEntry(MESH_TRANSITION, receipt); };
    interface PendingModeSwitch { requestId: string; targetMode: string; sessionId: string; sessionFile: string; toolCallId: string; cancelled: boolean; createdAt: number }
    interface PendingHandoff { requestId: string; prompt: string; sessionId: string; sessionFile: string; sourceSessionId: string; toolCallId: string; cancelled: boolean; createdAt: number }
    let pendingModeSwitch: PendingModeSwitch | undefined;
    let pendingHandoff: PendingHandoff | undefined;
    const pendingIsLive = (pending: { cancelled: boolean; createdAt: number } | undefined) => !!pending && !pending.cancelled && Date.now() - pending.createdAt <= PENDING_TRANSITION_TTL_MS;
    const invalidatePendingTransitions = (note?: string) => {
        for (const pending of [pendingModeSwitch, pendingHandoff]) {
            if (pending && !pending.cancelled) {
                pending.cancelled = true;
                if (note) try { sessionContextForNotify?.ui.notify(note, "warning"); } catch {}
            }
        }
        pendingModeSwitch = undefined;
        pendingHandoff = undefined;
    };
    let sessionContextForNotify: ExtensionContext | undefined;
    const queueModeContinuation = (content: string): void => { pi.sendMessage({ customType: "agent-mode-continuation", content, display: false }, { triggerTurn: true, deliverAs: "followUp" }); };
    // Internal commands are registered before the tools that schedule them.
    pi.registerCommand("mode-switch", { description: "Apply a pending switch_mode request (internal)", handler: async (args, ctx) => {
        sessionContextForNotify = ctx;
        const requestId = args.trim();
        const request = pendingModeSwitch;
        pendingModeSwitch = undefined;
        if (!request || request.requestId !== requestId) { ctx.ui.notify("Mode switch request is unknown or was already consumed", "warning"); return; }
        if (Date.now() - request.createdAt > PENDING_TRANSITION_TTL_MS) { const continuation = "Mode switch request expired before it could run; call switch_mode again."; ctx.ui.notify(continuation, "warning"); queueModeContinuation(continuation); return; }
        await ctx.waitForIdle();
        if (request.cancelled) { const continuation = "Mode switch was cancelled before it could run."; ctx.ui.notify(continuation, "warning"); queueModeContinuation(continuation); return; }
        if (!ctx.isIdle()) { const continuation = "Mode switch was not applied: the agent is no longer idle."; ctx.ui.notify(continuation, "warning"); queueModeContinuation(continuation); return; }
        if (ctx.sessionManager.getSessionId() !== request.sessionId || ctx.sessionManager.getSessionFile() !== request.sessionFile) { const continuation = `Mode switch to ${request.targetMode} was not applied: the session changed while it was pending.`; ctx.ui.notify(continuation, "warning"); queueModeContinuation(continuation); return; }
        const switched = await switchMode(request.targetMode, ctx, { persist: true, reason: "switch", triggerTurn: true, receiptRequestId: request.requestId });
        if (switched.status === "applied") {
            ctx.ui.notify(`Mode is now ${request.targetMode}`, "info");
        } else if (switched.status === "refused") {
            const continuation = `Mode switch to ${request.targetMode} was not applied: ${switched.error ?? "mesh transition prepare failed"}. The mesh remains operational; wait for in-flight work to become quiescent before retrying.`;
            ctx.ui.notify(continuation, "error");
            queueModeContinuation(continuation);
        } else if (switched.status === "failed") {
            const continuation = `Mode switch to ${request.targetMode} was not applied: ${switched.error ?? "mesh transition apply failed"}. Mesh mutations remain suspended; review the failure before retrying.`;
            ctx.ui.notify(continuation, "error");
            queueModeContinuation(continuation);
        } else {
            const continuation = `Mode switch to ${request.targetMode} was already settled without a change. Continue under the current mode.`;
            queueModeContinuation(continuation);
        }
    } });
    pi.registerCommand("mesh-handoff", { description: "Execute a pending session handoff (internal)", handler: async (args, ctx) => {
        sessionContextForNotify = ctx;
        const requestId = args.trim();
        const request = pendingHandoff;
        pendingHandoff = undefined;
        if (!request || request.requestId !== requestId) { ctx.ui.notify("Session handoff request is unknown or was already consumed", "warning"); return; }
        if (Date.now() - request.createdAt > PENDING_TRANSITION_TTL_MS) { ctx.ui.notify("Session handoff request expired before it could run; call session_handoff again", "warning"); return; }
        await ctx.waitForIdle();
        if (request.cancelled) { ctx.ui.notify("Session handoff was cancelled before it could run", "warning"); return; }
        if (!ctx.isIdle()) { ctx.ui.notify("Session handoff was not applied: the agent is no longer idle", "warning"); return; }
        if (ctx.sessionManager.getSessionId() !== request.sessionId || ctx.sessionManager.getSessionFile() !== request.sessionFile) { ctx.ui.notify("Session handoff was not applied: the session changed while it was pending", "warning"); return; }
        const prepared = await requestTransition("prepare", { kind: "handoff", fromMode: activeName }).catch(error => transitionError("rejected", error));
        if (prepared.status !== "prepared" || !prepared.token) { ctx.ui.notify(`Session handoff was refused: ${prepared.error ?? "mesh transition prepare failed"}`, "error"); return; }
        transitionReceipt({ schemaVersion: 1, kind: "handoff", status: "prepared", requestId: request.requestId, completedAt: new Date().toISOString() });
        const result = await ctx.newSession({
            parentSession: request.sessionFile,
            setup: async sm => {
                sm.appendCustomEntry(MODE_STATE, { schemaVersion: 2, mode: "ops" } satisfies ModeState);
                sm.appendCustomEntry(HANDOFF_METADATA, { schemaVersion: 1, requestId: request.requestId, sourceSessionId: request.sourceSessionId, targetMode: "ops" } satisfies HandoffMetadata);
            },
            withSession: async fresh => {
                fresh.ui.setEditorText(request.prompt);
                fresh.ui.notify("Session handoff complete: the new session is in ops mode with the draft above left unsubmitted. Review and send it when ready.", "info");
            },
        });
        if (result.cancelled) {
            await requestTransition("cancel", { token: prepared.token, kind: "handoff" }).catch(() => {});
            ctx.ui.notify("Session handoff was cancelled by the session replacement guard", "error");
        }
    } });
    pi.registerTool({
        name: "switch_mode",
        label: "Switch agent mode",
        description: "Switch the parent session's authority mode (recon, leader, or ops). Must be the only tool call in its batch. The switch runs after the current turn settles and continues once under the new mode. It is refused unless mesh work is quiescent.",
        parameters: Type.Object({ mode: Type.String({ description: "Target mode name (for example recon, leader, or ops)" }) }, { additionalProperties: false }),
        execute: async (id, args, _signal, _onUpdate, ctx) => {
            const batchError = await isStandaloneSwitchCall(id, "switch_mode");
            if (batchError) return toolErrorResult(batchError);
            const input = args as { mode?: unknown };
            const modeName = typeof input.mode === "string" ? input.mode.trim() : "";
            await ensureConfig();
            const mode = config!.modes[modeName];
            if (!mode) return toolErrorResult(`Unknown mode ${modeName}. Available: ${Object.keys(config!.modes).join(", ")}`);
            if (modeName === activeName && activeMode) return { content: [{ type: "text", text: `unchanged: already in mode ${modeName}` }], details: undefined };
            if (pendingIsLive(pendingModeSwitch) || pendingIsLive(pendingHandoff)) return toolErrorResult(pendingTransitionMessage);
            const requestId = randomUUID();
            pendingModeSwitch = { requestId, targetMode: modeName, sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile() ?? "", toolCallId: id, cancelled: false, createdAt: Date.now() };
            pi.sendUserMessage(`/mode-switch ${requestId}`, { deliverAs: "followUp", expandPromptTemplates: true });
            return { content: [{ type: "text", text: `scheduled: mode switch to ${modeName} is reserved (request ${requestId}); it applies after this turn settles and continues once under the new mode.` }], details: undefined, terminate: true };
        },
    });
    pi.registerTool({
        name: "session_handoff",
        label: "Session handoff",
        description: "Hand the implementation work to a fresh ops session. Opens an editor prefilled with the given prompt (normally `Implement <design path>`); the confirmed text becomes an UNSUBMITTED draft in the new session, which starts in ops mode with fresh common execution. Must be the only tool call in its batch.",
        parameters: Type.Object({ prompt: Type.String({ description: "Initial draft text for the new ops session editor, for example `Implement <design path>`" }) }, { additionalProperties: false }),
        execute: async (id, args, _signal, _onUpdate, ctx) => {
            const batchError = await isStandaloneSwitchCall(id, "session_handoff");
            if (batchError) return toolErrorResult(batchError);
            const input = args as { prompt?: unknown };
            const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
            if (!prompt) return toolErrorResult("session_handoff requires a non-empty prompt (the initial draft for the new session)");
            const sessionFile = ctx.sessionManager.getSessionFile();
            if (!sessionFile) return toolErrorResult("session_handoff requires a persisted session");
            const existingDraft = ctx.ui.getEditorText?.().trim();
            if (existingDraft) return toolErrorResult("The core editor has an uncommitted draft. Handle that draft first, then retry session_handoff.");
            if (pendingIsLive(pendingModeSwitch) || pendingIsLive(pendingHandoff)) return toolErrorResult(pendingTransitionMessage);
            const requestId = randomUUID();
            pendingHandoff = { requestId, prompt: "", sessionId: ctx.sessionManager.getSessionId(), sessionFile, sourceSessionId: ctx.sessionManager.getSessionId(), toolCallId: id, cancelled: false, createdAt: Date.now() };
            const edited = await ctx.ui.editor("Initial input for the new ops session (stays unsubmitted after you confirm)", prompt);
            if (edited === null || edited === undefined) { invalidatePendingTransitions(); return { content: [{ type: "text", text: "cancelled: no session handoff was scheduled" }], details: undefined };
            }
            const text = edited.trim();
            if (!text) { invalidatePendingTransitions(); return { content: [{ type: "text", text: "cancelled: empty input does not start a handoff" }], details: undefined };
            }
            pendingHandoff.prompt = text;
            pi.sendUserMessage(`/mesh-handoff ${requestId}`, { deliverAs: "followUp", expandPromptTemplates: true });
            return { content: [{ type: "text", text: `scheduled: session handoff is reserved (request ${requestId}); the new ops session starts after this turn settles with your confirmed text as an unsubmitted draft.` }], details: undefined, terminate: true };
        },
    });
    pi.on("session_start", async (event, ctx) => {
        shuttingDown = false;
        config = await loadAgentModeConfig(configPath);
        activeRoute = undefined;
        executionState = undefined;
        sessionContextForNotify = ctx;
        invalidatePendingTransitions();
        const flag = pi.getFlag("agent-mode");
        const handoff = event.reason === "new" ? restoredHandoffMetadata(ctx) : undefined;
        const handoffMode = handoff?.schemaVersion === 1 && typeof handoff.targetMode === "string" && config.modes[handoff.targetMode] ? handoff.targetMode : undefined;
        const requested = handoffMode ?? (typeof flag === "string" && flag.trim() ? flag.trim() : restoredMode(ctx) ?? config.defaultMode);
        if (!await applyModeDirect(requested, ctx, true, "startup") && requested !== config.defaultMode) await applyModeDirect(config.defaultMode, ctx, true, "startup");
        await restoreExecution(ctx);
    });
    pi.on("session_tree", async (_event, ctx) => {
        invalidatePendingTransitions();
        await ensureConfig();
        const restored = restoredMode(ctx) ?? config!.defaultMode;
        await applyModeDirect(restored, ctx, false, "restore");
        await restoreExecution(ctx);
    });
    pi.on("model_select", (event, ctx) => {
        if (event.source === "restore" || applyingSelection || !activeMode || !activeName || !activeRoute) return;
        executionState = "manual";
        persistExecution();
        setIdentity(ctx);
        ctx.ui.notify("Automatic execution fallback suspended after explicit model selection", "info");
    });
    pi.on("thinking_level_select", (_event, ctx) => {
        if (applyingSelection || !activeMode || !activeName || !activeRoute) return;
        executionState = "manual";
        persistExecution();
        setIdentity(ctx);
    });
    pi.on("agent_start", () => { lastAssistantStopReason = undefined; turnHadToolError = false; });
    pi.on("turn_start", () => { turnHadToolError = false; });
    pi.on("turn_end", event => { if (event.toolResults.some(result => result.isError)) turnHadToolError = true; });
    pi.on("message_end", event => { if (event.message.role === "toolResult" && event.message.isError) turnHadToolError = true; });
    pi.on("agent_end", event => {
        const assistant = [...event.messages].reverse().find(message => message.role === "assistant") as { stopReason?: unknown } | undefined;
        lastAssistantStopReason = typeof assistant?.stopReason === "string" ? assistant.stopReason : undefined;
    });
    pi.on("agent_settled", async (_event, ctx) => {
        const stopReason = lastAssistantStopReason;
        const toolError = turnHadToolError;
        lastAssistantStopReason = undefined;
        turnHadToolError = false;
        const execution = config?.execution;
        if (shuttingDown || executionState !== "active" || !execution || !activeRoute || stopReason !== "error" || toolError) { activeTaskPrompt = undefined; return; }
        const usage = ctx.getContextUsage();
        applyingSelection = true;
        let promotion: Awaited<ReturnType<typeof promoteProfileCandidate>>;
        try {
            promotion = await promoteProfileCandidate({ profile: execution, profileName: PARENT_EXECUTION_PROFILE, route: activeRoute, registry: ctx.modelRegistry, tokens: usage?.tokens, activate: async model => {
                if (shuttingDown) return false;
                const selected = await pi.setModel(model);
                if (!selected || shuttingDown) return false;
                pi.setThinkingLevel(execution.thinkingLevel!);
                return !shuttingDown;
            } });
        } finally { applyingSelection = false; }
        if (shuttingDown) return;
        activeRoute = promotion.route;
        if (promotion.action === "exhausted") executionState = "exhausted";
        persistExecution();
        setIdentity(ctx);
        if (promotion.action === "exhausted") {
            activeTaskPrompt = undefined;
            ctx.ui.notify(promotion.error, "error");
            return;
        }
        pendingFallbackPrompt = formatProfileFallbackContinuation(activeTaskPrompt!);
        pi.sendMessage({ customType: PROFILE_FALLBACK_CONTINUATION_TYPE, content: pendingFallbackPrompt, display: false }, { triggerTurn: true });
    });
    pi.on("session_shutdown", () => { shuttingDown = true; invalidatePendingTransitions(); });
    pi.on("context", () => { reassertTools(); });
    pi.on("before_agent_start", (event, ctx) => {
        if (event.prompt === pendingFallbackPrompt) pendingFallbackPrompt = undefined;
        else activeTaskPrompt = event.prompt;
        if (!activeMode) return;
        reassertTools();
        const loaded = event.systemPromptOptions.skills ?? []; const names = new Set(loaded.map(skill => skill.name));
        const missing = activeMode.skillOptIns.filter(name => !names.has(name));
        if (missing.length) ctx.ui.notify(`Mode ${activeName}: opted-in skills unavailable: ${missing.join(", ")}`, "warning");
        const opted = new Set(activeMode.skillOptIns);
        const skills = loaded.filter(skill => opted.has(skill.name) && skill.disableModelInvocation).map(skill => ({ ...skill, disableModelInvocation: false }));
        const addition = [formatSkillsForPrompt(skills), activeMode.instructions].filter(Boolean).join("\n\n");
        if (addition) return { systemPrompt: `${event.systemPrompt}\n\n${addition}` };
    });
    pi.on("tool_call", event => { if (activeMode && !activeMode.tools.includes(event.toolName)) return { block: true, reason: `Tool ${event.toolName} is not allowed by mode ${activeName}` }; });
    return { activeMode: () => activeName };
}
export default registerModeController;
