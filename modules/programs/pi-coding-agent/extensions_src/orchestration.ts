import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { StringEnum, type Usage } from "@earendil-works/pi-ai";
import { defineTool, formatSkillsForPrompt, getAgentDir, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { emitResolvedAgent } from "./utilities/agent_events.ts";
import { buildLaunchEnvelope, projectLaunchEnvelope, validateAgentCatalog, validateDelegationConfig, validateLaunchEnvelope, type AgentCatalog, type AgentDefinition, type AgentLaunchEnvelope } from "./utilities/agent_types.ts";
import { onActiveMode } from "./utilities/mode_events.ts";
import {
    renderAgentToolResult,
    renderGetCall,
    renderRunCall,
    renderRunResult,
    renderStopCall,
    renderStopResult,
    renderSubmitCall,
    renderSubmitResult,
    renderWaitCall,
    renderWaitResult,
} from "./utilities/orchestration_cards.ts";
import { resolveHarnessAdapter } from "./utilities/orchestration_harness.ts";
import { cleanupOriginAgents, failStartedSubagentAgent, readReconciledAgentSnapshot, stopSubagentAgentWithDisposition, stopSubagentTask, stopSubagentTaskWithDisposition } from "./utilities/orchestration_management.ts";
import {
    projectDebugSnapshot,
    projectMinimalAgentTask,
    projectMinimalWaitResult,
    projectMinimalSubmitResult,
    sanitizeSnapshot,
    serializeModelVisibleJson,
    type AgentToolDetails,
    type SubmitDetails,
    type WaitDetails,
} from "./utilities/orchestration_projection.ts";
import { claimTaskUsage, createTask, findTaskAgent, prepareAgent, publishAgent, readAgentSnapshot, reconcileOriginUsageClaims, removePreparedAgent } from "./utilities/orchestration_store.ts";
import { inspectAgentTmux, launchAgentSession, probeTmux, stopAgentSession, type CommandExecutor } from "./utilities/orchestration_tmux.ts";
import { addUsage, emptyUsage, isTerminalAgent, isTerminalTask, type AgentSnapshot, type SubagentRuntimeConfig, type UsageClaim } from "./utilities/orchestration_types.ts";
import { SubagentPaletteComponent, type SubagentPaletteDependencies } from "./utilities/orchestration_palette.ts";
import { openPopupView, providePopupView } from "./popup.ts";
import { loadPaletteKeymap } from "./utilities/command_palette_keymap.ts";
import { loadFeatureKeybindings } from "./utilities/extension_keybindings.ts";
import { provideCommandPaletteContribution } from "./utilities/command_palette_contributions.ts";

const CONFIG = join(getAgentDir(), "orchestration.json"); const CATALOG = join(getAgentDir(), "agent-catalog.json");
const PARENT_NAVIGATION_STATUS = "subagent-parent-navigation";
const taskPromptGuideline = "Give the selected agent one local objective with sufficient task-specific context. Rely on its catalog description and discoverable skills for stable behavior.";
const runPromptGuidelines = [
    taskPromptGuideline,
    "Use `subagent_run` when the child result is the next dependency; do not call `subagent_wait` after it.",
    "Emit multiple sibling `subagent_run` calls for independent foreground tasks on distinct or new agents.",
];
const submitPromptGuidelines = ["Use `subagent_submit` only when independent parent work can proceed before the child result is needed."];
const getPromptGuidelines = ["Use `subagent_get` for one-time nonblocking inspection of a task or agent."];
const waitPromptGuidelines = ["Use `subagent_wait` only to collect previously background-submitted task IDs."];
const stopPromptGuidelines = ["Use `subagent_stop` only to terminate one task or agent."];
const taskParametersFor = (targets: Readonly<Record<string, AgentDefinition>>) => Type.Object({
    agent: Type.Optional(StringEnum(Object.keys(targets), { description: Object.entries(targets).map(([name, definition]) => `${name}: ${definition.description}`).join("; ") || "No new child agents are available" })),
    agentId: Type.Optional(Type.String({ description: "Existing idle agent target. Mutually exclusive with agent." })),
    prompt: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
type TaskParameters = Static<ReturnType<typeof taskParametersFor>>;
const getParameters = Type.Object({
    agentId: Type.String(),
    taskId: Type.Optional(Type.String()),
    debug: Type.Optional(Type.Boolean({
        default: false,
        description: "Abnormal-state diagnosis only. When true, returns full sanitized persisted snapshot metadata. Not needed for normal operation.",
    })),
}, { additionalProperties: false });
const waitParameters = Type.Object({
    taskIds: Type.Array(Type.String(), { minItems: 1, maxItems: 128, uniqueItems: true }),
    condition: StringEnum(["any", "all"] as const),
}, { additionalProperties: false });
const stopParameters = Type.Object({ agentId: Type.Optional(Type.String()), taskId: Type.Optional(Type.String()) }, { additionalProperties: false });
export interface ActiveCaller { identity: string; targets: Record<string, AgentDefinition>; catalog: AgentCatalog; envelope?: AgentLaunchEnvelope; error?: string }
export interface OrchestrationDependencies { configPath: string; catalogPath?: string; env: NodeJS.ProcessEnv; exec: CommandExecutor; activeCaller?: () => ActiveCaller | undefined; natureHandleWords?: () => readonly string[]; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; now?: () => number }
export async function loadOrchestrationConfig(path: string): Promise<SubagentRuntimeConfig> { try { return validateDelegationConfig(JSON.parse(await readFile(path, "utf8"))); } catch (error) { throw new Error(`Cannot read orchestration config ${path}: ${error instanceof Error ? error.message : String(error)}`); } }
export async function loadAgentCatalog(path: string): Promise<AgentCatalog> { try { return validateAgentCatalog(JSON.parse(await readFile(path, "utf8"))); } catch (error) { throw new Error(`Cannot read agent catalog ${path}: ${error instanceof Error ? error.message : String(error)}`); } }
function origin(ctx: ExtensionContext, env: NodeJS.ProcessEnv) { const raw = Number.parseInt(env.PI_SUBAGENT_DEPTH ?? "0", 10); return { depth: Number.isInteger(raw) && raw >= 0 ? raw : 0, parentAgentId: env.PI_SUBAGENT_AGENT_ID, originSessionId: env.PI_SUBAGENT_ORIGIN_SESSION_ID ?? ctx.sessionManager.getSessionId(), originSessionFile: ctx.sessionManager.getSessionFile() ?? env.PI_SUBAGENT_ORIGIN_SESSION_FILE }; }
function sleep(ms: number, signal?: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { if (signal?.aborted) { reject(signal.reason); return; } const timer = setTimeout(resolve, ms); signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); }); }
function errorText(value: unknown): string { if (value instanceof Error) return value.message; if (typeof value === "string") return value; return JSON.stringify(value) ?? "Unknown error"; }

function asRecord(args: unknown): Record<string, unknown> {
    if (!args || typeof args !== "object" || Array.isArray(args)) return {};
    return { ...(args as Record<string, unknown>) };
}

function prepareGetArguments(args: unknown): Static<typeof getParameters> { return asRecord(args) as Static<typeof getParameters>; }

async function claim(config: SubagentRuntimeConfig, snapshot: AgentSnapshot, ctx: ExtensionContext, env: NodeJS.ProcessEnv, toolCallId: string, toolName: UsageClaim["toolName"]): Promise<{ usage?: Usage; claimedTaskIds: string[] }> {
    const task = snapshot.task;
    if (!snapshot.agent.capabilities.usage || !task?.result || !isTerminalTask(task.status.state)) return { claimedTaskIds: [] };
    const lineage = origin(ctx, env);
    const value = await claimTaskUsage(config.stateRoot, snapshot.agent.agentId, task.request.taskId, lineage.originSessionId, lineage.originSessionFile, toolCallId, toolName);
    return value.created ? { usage: value.result.usage, claimedTaskIds: [task.request.taskId] } : { claimedTaskIds: [] };
}

function agentResult(rawSnapshot: AgentSnapshot, accounting: { usage?: Usage; claimedTaskIds: string[] }, debug = false) {
    const snapshot = sanitizeSnapshot(rawSnapshot);
    const payload = debug ? projectDebugSnapshot(snapshot) : projectMinimalAgentTask(snapshot);
    const details: AgentToolDetails = { ...snapshot, accounting };
    return {
        content: [{ type: "text" as const, text: serializeModelVisibleJson(payload) }],
        details,
        usage: accounting.usage,
    };
}

function submitResult(
    rawSnapshot: AgentSnapshot,
    accounting: { usage?: Usage; claimedTaskIds: string[] },
) {
    const snapshot = sanitizeSnapshot(rawSnapshot);
    const payload = projectMinimalSubmitResult(snapshot);
    const details: SubmitDetails = {
        ...snapshot,
        accounting,
    };
    return {
        content: [{ type: "text" as const, text: serializeModelVisibleJson(payload) }],
        details,
        usage: accounting.usage,
    };
}

function active(deps: OrchestrationDependencies) { const value = deps.activeCaller?.(); if (!value) throw new Error("Orchestration unavailable: no caller identity has been resolved"); if (value.error) throw new Error(`Orchestration unavailable: ${value.error}`); return value; }
export function validateAgentTargetAuthorization(current: ActiveCaller, snapshot: AgentSnapshot): void { if (!current.targets[snapshot.agent.agent]) throw new Error(`${current.identity} is not allowed to access agent ${snapshot.agent.agent}`); }
export function validateAgentReuseAuthorization(current: ActiveCaller, snapshot: AgentSnapshot): void { try { validateAgentTargetAuthorization(current, snapshot); } catch { throw new Error(`${current.identity} is not allowed to reuse agent ${snapshot.agent.agent}`); } }
function rejectSelfTarget(env: NodeJS.ProcessEnv, agentId: string, operation: "run" | "submit" | "get" | "stop" | "wait"): void {
    const self = env.PI_SUBAGENT_AGENT_ID;
    if (self && self === agentId) throw new Error(`orchestration_${operation} cannot target the calling agent itself (${agentId})`);
}
type WaitAccounting = { usage?: Usage; claimedTaskIds: string[] };
type PollTasksOptions = {
    readSnapshots: () => Promise<AgentSnapshot[]>;
    condition: "any" | "all";
    signal?: AbortSignal;
    sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
    claim: (snapshot: AgentSnapshot) => Promise<{ usage?: Usage; claimedTaskIds: string[] }>;
    onWaiting?: (snapshots: AgentSnapshot[]) => void;
};
type PollTasksResult = { snapshots: AgentSnapshot[]; accounting: WaitAccounting };

async function pollTasks(options: PollTasksOptions): Promise<PollTasksResult> {
    while (true) {
        if (options.signal?.aborted) throw options.signal.reason;
        const snapshots = await options.readSnapshots();
        const done = snapshots.filter(value => value.task && isTerminalTask(value.task.status.state));
        const met = options.condition === "any" ? done.length > 0 : done.length === snapshots.length;
        if (met) {
            const accounting: WaitAccounting = { claimedTaskIds: [] };
            for (const snapshot of snapshots) {
                const item = await options.claim(snapshot);
                accounting.claimedTaskIds.push(...item.claimedTaskIds);
                if (item.usage) {
                    if (!accounting.usage) accounting.usage = emptyUsage();
                    addUsage(accounting.usage, item.usage);
                }
            }
            return { snapshots, accounting };
        }
        options.onWaiting?.(snapshots);
        await options.sleep(250, options.signal);
    }
}

function waitResult(
    snapshots: readonly AgentSnapshot[],
    condition: "any" | "all",
    outcome: "completed" | undefined,
    accounting: WaitAccounting,
) {
    const agents = snapshots.map(sanitizeSnapshot);
    const details: WaitDetails = { condition, ...(outcome ? { outcome } : {}), agents, accounting };
    const contentPayload = outcome
        ? projectMinimalWaitResult(agents, "completed")
        : { tasks: agents.map(projectMinimalAgentTask) };
    return {
        content: [{ type: "text" as const, text: serializeModelVisibleJson(contentPayload) }],
        details,
        usage: accounting.usage,
    };
}

async function startAgentSubmission(
    deps: OrchestrationDependencies,
    config: SubagentRuntimeConfig,
    current: ActiveCaller,
    params: TaskParameters & { agent: string },
    signal: AbortSignal | undefined,
    ctx: ExtensionContext,
    onTaskCreated?: (snapshot: AgentSnapshot) => void,
    preserveOnAbortAfterSubmission = false,
): Promise<AgentSnapshot> {
    if (signal?.aborted) throw signal.reason;
    const effective = current.targets[params.agent];
    if (!effective) throw new Error(`${current.identity} is not allowed to start agent ${params.agent}`);
    const lineage = origin(ctx, deps.env);
    const depth = lineage.depth + 1;
    if (depth > config.maxDepth) throw new Error(`Subagent depth ${depth} exceeds maxDepth ${config.maxDepth}`);
    const harness = effective.harness;
    const resolvedHarness = resolveHarnessAdapter(config, harness, effective);
    const { adapter } = resolvedHarness;
    const context = await probeTmux(deps.exec, config.tmux, deps.env);
    if (!context) throw new Error("Subagent start requires a usable current tmux context");
    const envelope = current.envelope
        ? projectLaunchEnvelope(params.agent, current.envelope)
        : buildLaunchEnvelope(params.agent, current.catalog, config.delegation, [config.popupExtension, config.orchestrationExtension, config.childBridgeExtension]);
    const envelopePath = join(config.stateRoot, "agents", "pending", "launch-envelope.json");
    const prepared = await prepareAgent(config.stateRoot, {
        agent: params.agent, harness, cwd: ctx.cwd, agentSnapshot: effective, launchEnvelope: envelopePath,
        lineage: { callerIdentity: current.identity, targetAgent: params.agent, depth, parentAgentId: lineage.parentAgentId, originSessionId: lineage.originSessionId, originSessionFile: lineage.originSessionFile }, capabilities: adapter.capabilities,
    });
    const actualEnvelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(actualEnvelopePath, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
    let tmux;
    let published = false;
    let taskCreated = false;
    try {
        const launch = adapter.launch(config, resolvedHarness.harness, {
            agentId: prepared.agentId,
            agentDirectory: prepared.paths.directory,
            agent: params.agent,
            launchEnvelope: actualEnvelopePath,
            launchEnvelopeSnapshot: envelope,
            depth,
            originSessionId: lineage.originSessionId,
            originSessionFile: lineage.originSessionFile,
            cwd: ctx.cwd,
        });
        tmux = await launchAgentSession(deps.exec, config.tmux, context, { agentId: prepared.agentId, agent: params.agent, originSessionId: lineage.originSessionId, cwd: ctx.cwd, launch });
        await publishAgent(prepared.paths, {
            agentId: prepared.agentId, agent: params.agent, harness, cwd: ctx.cwd, agentSnapshot: effective, launchEnvelope: actualEnvelopePath,
            tmux,
            tmuxOwnership: "origin-hub",
            capabilities: adapter.capabilities,
            callerIdentity: current.identity,
            targetAgent: params.agent,
            depth,
            parentAgentId: lineage.parentAgentId,
            originSessionId: lineage.originSessionId,
            originSessionFile: lineage.originSessionFile,
        });
        published = true;
        if (signal?.aborted) throw signal.reason;
        const task = await createTask(config.stateRoot, prepared.agentId, params.prompt);
        taskCreated = true;
        onTaskCreated?.(await readAgentSnapshot(config.stateRoot, prepared.agentId, task.request.taskId));
        const readyTimeoutMs = resolvedHarness.harness.bridgeReadyTimeoutMs ?? 5000;
        const deadline = (deps.now ?? (() => performance.now()))() + readyTimeoutMs;
        while ((deps.now ?? (() => performance.now()))() < deadline) {
            if (signal?.aborted) throw signal.reason;
            const snapshot = await readAgentSnapshot(config.stateRoot, prepared.agentId);
            if (isTerminalAgent(snapshot.status.state)) throw new Error(snapshot.status.exitReason ?? `Child agent became ${snapshot.status.state} during startup`);
            if (snapshot.status.bridgeReady) {
                const live = await readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, prepared.agentId);
                if (isTerminalAgent(live.status.state)) throw new Error(live.status.exitReason ?? `Child agent became ${live.status.state} during startup`);
                return live;
            }
            await (deps.sleep ?? sleep)(50, signal);
        }
        throw new Error("Child bridge readiness timed out");
    } catch (error) {
        if (preserveOnAbortAfterSubmission && taskCreated && signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : String(error);
        let cleanupError: unknown;
        if (published) {
            try { await failStartedSubagentAgent({ stateRoot: config.stateRoot, agentId: prepared.agentId, originSessionId: origin(ctx, deps.env).originSessionId, exec: deps.exec, tmux: config.tmux }, message); }
            catch (failure) { cleanupError = failure; }
        } else {
            let cleanupConfirmed = tmux === undefined;
            if (tmux) {
                try {
                    cleanupConfirmed = await stopAgentSession(deps.exec, config.tmux, tmux);
                    if (!cleanupConfirmed) {
                        const inspected = await inspectAgentTmux(deps.exec, config.tmux, tmux);
                        cleanupConfirmed = inspected.server === "absent" || inspected.server === "mismatch" || !inspected.paneAlive;
                    }
                } catch (failure) {
                    const inspected = await inspectAgentTmux(deps.exec, config.tmux, tmux).catch(() => undefined);
                    cleanupConfirmed = inspected !== undefined && (inspected.server === "absent" || inspected.server === "mismatch" || !inspected.paneAlive);
                    if (!cleanupConfirmed) cleanupError = failure;
                }
            }
            if (cleanupConfirmed) await removePreparedAgent(prepared.paths);
            else cleanupError ??= new Error("Could not confirm that the child tmux pane stopped");
        }
        if (cleanupError) throw new Error(`${message}; cleanup for agent ${prepared.agentId} remains incomplete: ${errorText(cleanupError)}`);
        throw error;
    }
}

function validateTaskTarget(params: TaskParameters, toolName: "subagent_run" | "subagent_submit"): { kind: "new"; agent: string } | { kind: "existing"; agentId: string } {
    const hasNew = params.agent !== undefined; const hasExisting = params.agentId !== undefined;
    if (hasNew === hasExisting) throw new Error(`${toolName} requires exactly one of agent or agentId`);
    return hasNew ? { kind: "new", agent: params.agent! } : { kind: "existing", agentId: params.agentId! };
}

export function createSubagentRunTool(deps: OrchestrationDependencies, targets: Readonly<Record<string, AgentDefinition>> = {}): ToolDefinition {
    const parameters = taskParametersFor(targets);
    return defineTool({
        name: "subagent_run",
        label: "Run agent task",
        description: "Run one task on exactly one target and wait until it is terminal. Use agent for a new child or agentId for an existing idle child. Child failed or stopped outcomes are returned normally. Independent sibling runs can execute concurrently.",
        promptSnippet: "Run one foreground task on a new or existing persistent agent",
        promptGuidelines: runPromptGuidelines,
        parameters,
        async execute(toolCallId, params, signal, update, ctx) {
            const target = validateTaskTarget(params, "subagent_run");
            const config = await loadOrchestrationConfig(deps.configPath);
            let snapshot: AgentSnapshot | undefined;
            try {
                if (target.kind === "new") {
                    snapshot = await startAgentSubmission(deps, config, active(deps), { ...params, agent: target.agent }, signal, ctx, created => { snapshot = created; }, true);
                } else {
                    if (signal?.aborted) throw signal.reason;
                    rejectSelfTarget(deps.env, target.agentId, "run");
                    const stored = await readAgentSnapshot(config.stateRoot, target.agentId);
                    if (stored.agent.originSessionId !== origin(ctx, deps.env).originSessionId) throw new Error(`Agent ${target.agentId} belongs to a different origin session`);
                    validateAgentReuseAuthorization(active(deps), stored);
                    await readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, target.agentId);
                    if (signal?.aborted) throw signal.reason;
                    const task = await createTask(config.stateRoot, target.agentId, params.prompt);
                    snapshot = await readAgentSnapshot(config.stateRoot, target.agentId, task.request.taskId);
                }
                const taskId = snapshot.task!.request.taskId;
                update?.(agentResult(snapshot, { claimedTaskIds: [] }));
                const waited = await pollTasks({
                    readSnapshots: async () => [await readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, snapshot!.agent.agentId, taskId)],
                    condition: "all",
                    signal,
                    sleep: deps.sleep ?? sleep,
                    claim: value => claim(config, value, ctx, deps.env, toolCallId, "subagent_run"),
                    onWaiting: values => update?.(agentResult(values[0]!, { claimedTaskIds: [] })),
                });
                return agentResult(waited.snapshots[0]!, waited.accounting);
            } catch (error) {
                if (!signal?.aborted || !snapshot?.task) throw error;
                const taskId = snapshot.task.request.taskId;
                try {
                    await stopSubagentTask({ stateRoot: config.stateRoot, agentId: snapshot.agent.agentId, taskId, originSessionId: origin(ctx, deps.env).originSessionId, reason: "Foreground run aborted by parent" });
                } catch (cleanupError) {
                    throw new Error(`subagent_run abort cleanup failed for agent ${snapshot.agent.agentId}, task ${taskId}; durable cancellation state may remain active: ${errorText(cleanupError)}`, { cause: error });
                }
                throw error;
            }
        },
        renderCall(args, theme, context) { return renderRunCall(args, theme, context); },
        renderResult(result, options, theme, context) { return renderRunResult(result, options, theme, context, deps.natureHandleWords?.()); },
    });
}

export function createSubagentSubmitTool(deps: OrchestrationDependencies, targets: Readonly<Record<string, AgentDefinition>> = {}): ToolDefinition {
    const parameters = taskParametersFor(targets);
    return defineTool({
        name: "subagent_submit",
        label: "Submit agent task",
        description: "Submit one task to exactly one target: agent for a new child or agentId for an existing idle child. Returns one submission result with distinct agentId and taskId. Returns immediately after task creation. Busy existing agents reject without queueing. Use subagent_run when the result is the next dependency, subagent_wait for background fan-in, and subagent_get for later inspection.",
        promptSnippet: "Submit one background task to a new or existing persistent agent",
        promptGuidelines: submitPromptGuidelines,
        parameters,
        executionMode: "sequential",
        async execute(toolCallId, params, signal, update, ctx) {
            const target = validateTaskTarget(params, "subagent_submit");
            let config: SubagentRuntimeConfig;
            let snapshot: AgentSnapshot;
            if (target.kind === "new") {
                config = await loadOrchestrationConfig(deps.configPath);
                snapshot = await startAgentSubmission(deps, config, active(deps), { ...params, agent: target.agent }, signal, ctx);
            } else {
                rejectSelfTarget(deps.env, target.agentId, "submit");
                config = await loadOrchestrationConfig(deps.configPath);
                const stored = await readAgentSnapshot(config.stateRoot, target.agentId);
                if (stored.agent.originSessionId !== origin(ctx, deps.env).originSessionId) throw new Error(`Agent ${target.agentId} belongs to a different origin session`);
                validateAgentReuseAuthorization(active(deps), stored);
                await readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, target.agentId);
                await createTask(config.stateRoot, target.agentId, params.prompt);
                snapshot = await readAgentSnapshot(config.stateRoot, target.agentId);
            }

            return submitResult(snapshot, await claim(config, snapshot, ctx, deps.env, toolCallId, "subagent_submit"));
        },
        renderCall(args, theme, context) { return renderSubmitCall(args, theme, context); },
        renderResult(result, options, theme, context) { return renderSubmitResult(result, options, theme, context, deps.natureHandleWords?.()); },
    });
}
export function createSubagentGetTool(deps: OrchestrationDependencies): ToolDefinition<typeof getParameters, unknown> {
    return defineTool({
        name: "subagent_get",
        label: "Get agent task",
        description: "Read a persistent agent and a specified, active, or latest task once without waiting. Optional debug returns full sanitized persisted snapshot metadata for abnormal-state diagnosis only; it is not needed for normal operation.",
        promptSnippet: "Read an agent session and task state",
        promptGuidelines: getPromptGuidelines,
        parameters: getParameters,
        executionMode: "sequential",
        prepareArguments: prepareGetArguments,
        async execute(id, params, _signal, _update, ctx) {
            rejectSelfTarget(deps.env, params.agentId, "get");
            const config = await loadOrchestrationConfig(deps.configPath);
            const expectedOrigin = origin(ctx, deps.env).originSessionId;
            const stored = await readAgentSnapshot(config.stateRoot, params.agentId, params.taskId);
            if (stored.agent.originSessionId !== expectedOrigin) throw new Error(`Agent ${params.agentId} belongs to a different origin session`);
            validateAgentTargetAuthorization(active(deps), stored);
            const snapshot = await readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, params.agentId, params.taskId);
            return agentResult(snapshot, await claim(config, snapshot, ctx, deps.env, id, "subagent_get"), params.debug === true);
        },
        renderCall(args, theme, context) { return renderGetCall(args, theme, context); },
        renderResult(result, options, theme, context) {
            return renderAgentToolResult(result, options, theme, context, undefined, context.args?.debug === true, deps.natureHandleWords?.());
        },
    });
}
export function createSubagentWaitTool(deps: OrchestrationDependencies): ToolDefinition<typeof waitParameters, unknown> {
    return defineTool({
        name: "subagent_wait",
        label: "Wait for tasks",
        description: "Wait for specified task IDs to become terminal without a deadline until the any/all condition is met. Aborting this observer leaves agent tasks alive. For abnormal-state diagnosis of one agent, use subagent_get with debug=true.",
        promptSnippet: "Wait for one or more background tasks",
        promptGuidelines: waitPromptGuidelines,
        parameters: waitParameters,
        executionMode: "sequential",
        prepareArguments(args) { return asRecord(args) as Static<typeof waitParameters>; },
        async execute(id, params, signal, update, ctx) {
            const config = await loadOrchestrationConfig(deps.configPath);
            const session = origin(ctx, deps.env).originSessionId;
            const mapping = new Map<string, string>();
            for (const taskId of params.taskIds) mapping.set(taskId, await findTaskAgent(config.stateRoot, taskId, session));
            for (const [taskId, agentId] of mapping) {
                if (deps.env.PI_SUBAGENT_AGENT_ID && agentId === deps.env.PI_SUBAGENT_AGENT_ID) {
                    throw new Error(`subagent_wait cannot wait on the calling agent's own task ${taskId}`);
                }
                validateAgentTargetAuthorization(active(deps), await readAgentSnapshot(config.stateRoot, agentId, taskId));
            }
            const readSnapshots = async () => Promise.all(params.taskIds.map(taskId => readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, mapping.get(taskId)!, taskId)));
            const waited = await pollTasks({
                readSnapshots,
                condition: params.condition,
                signal,
                sleep: deps.sleep ?? sleep,
                claim: snapshot => claim(config, snapshot, ctx, deps.env, id, "subagent_wait"),
                onWaiting: snapshots => update?.(waitResult(snapshots, params.condition, undefined, { claimedTaskIds: [] })),
            });
            return waitResult(waited.snapshots, params.condition, "completed", waited.accounting);
        },
        renderCall(args, theme, context) { return renderWaitCall(args, theme, context); },
        renderResult(result, options, theme, context) { return renderWaitResult(result, options, theme, context, deps.natureHandleWords?.()); },
    });
}
export function createSubagentStopTool(deps: OrchestrationDependencies): ToolDefinition<typeof stopParameters, unknown> {
    return defineTool({
        name: "subagent_stop",
        label: "Stop agent or task",
        description: "Stop exactly one agent or task. agentId terminates the whole persistent agent session; taskId cancels only that task and leaves the agent reusable.",
        promptSnippet: "Stop one persistent agent session or one task",
        promptGuidelines: stopPromptGuidelines,
        parameters: stopParameters,
        executionMode: "sequential",
        prepareArguments(args) { return asRecord(args) as Static<typeof stopParameters>; },
        async execute(id, params, _signal, _update, ctx) {
            const hasAgent = params.agentId !== undefined;
            const hasTask = params.taskId !== undefined;
            if (hasAgent === hasTask) throw new Error("subagent_stop requires exactly one of agentId or taskId");
            const config = await loadOrchestrationConfig(deps.configPath);
            let snapshot: AgentSnapshot;
            let stopDisposition: "stopped-now" | "stop-pending" | "already-terminal";
            if (params.agentId) {
                rejectSelfTarget(deps.env, params.agentId, "stop");
                const stored = await readAgentSnapshot(config.stateRoot, params.agentId);
                if (stored.agent.originSessionId !== origin(ctx, deps.env).originSessionId) throw new Error(`Agent ${params.agentId} belongs to a different origin session`);
                validateAgentTargetAuthorization(active(deps), stored);
                const stopped = await stopSubagentAgentWithDisposition({ stateRoot: config.stateRoot, agentId: params.agentId, originSessionId: origin(ctx, deps.env).originSessionId, exec: deps.exec, tmux: config.tmux });
                stopDisposition = stopped.disposition;
                snapshot = stopped.snapshot;
            } else {
                const taskId = params.taskId!;
                const agentId = await findTaskAgent(config.stateRoot, taskId, origin(ctx, deps.env).originSessionId);
                rejectSelfTarget(deps.env, agentId, "stop");
                validateAgentTargetAuthorization(active(deps), await readAgentSnapshot(config.stateRoot, agentId, taskId));
                const stopped = await stopSubagentTaskWithDisposition({ stateRoot: config.stateRoot, agentId, taskId, originSessionId: origin(ctx, deps.env).originSessionId });
                stopDisposition = stopped.disposition;
                snapshot = stopped.snapshot;
            }
            const result = agentResult(snapshot, await claim(config, snapshot, ctx, deps.env, id, "subagent_stop"));
            return { ...result, details: { ...result.details, stopDisposition } };
        },
        renderCall(args, theme, context) { return renderStopCall(args, theme, context); },
        renderResult(result, options, theme, context) { return renderStopResult(result, options, theme, context, deps.natureHandleWords?.()); },
    });
}
export async function registerOrchestration(pi: ExtensionAPI, options: Partial<Pick<OrchestrationDependencies, "configPath" | "catalogPath" | "env">> = {}): Promise<boolean> {
    loadFeatureKeybindings("subagentPalette"); loadFeatureKeybindings("tmuxPreview");
    const configPath = options.configPath ?? CONFIG; const catalogPath = options.catalogPath ?? CATALOG; const env = options.env ?? process.env;
    const runtime = await loadOrchestrationConfig(configPath);
    let current: ActiveCaller | undefined; let natureHandleWords: readonly string[] = runtime.natureHandleWords;
    const exec: CommandExecutor = async (command, args) => { const value = await pi.exec(command, args); return { stdout: value.stdout, stderr: value.stderr, code: value.code }; };
    const deps: OrchestrationDependencies = { configPath, catalogPath, env, exec, activeCaller: () => current, natureHandleWords: () => natureHandleWords };
    const registerDispatch = (targets: Record<string, AgentDefinition>) => { pi.registerTool(createSubagentRunTool(deps, targets)); pi.registerTool(createSubagentSubmitTool(deps, targets)); };
    const resolvedPath = env.PI_AGENT_RESOLVED_AGENT; let resolvedEnvelope: AgentLaunchEnvelope | undefined;
    if (resolvedPath) {
        try {
            const envelope = validateLaunchEnvelope(JSON.parse(await readFile(resolvedPath, "utf8"))); resolvedEnvelope = envelope;
            const names = envelope.delegation[envelope.identity] ?? [];
            const targets = Object.fromEntries(names.map(name => [name, envelope.catalog[name]!]).filter(([, value]) => value !== undefined));
            current = { identity: envelope.identity, targets, catalog: { schemaVersion: 1, agents: envelope.catalog }, envelope }; registerDispatch(targets);
        } catch (error) { current = { identity: "agent:invalid", targets: {}, catalog: { schemaVersion: 1, agents: {} }, error: error instanceof Error ? error.message : String(error) }; registerDispatch({}); }
    } else {
        const catalog = await loadAgentCatalog(catalogPath);
        onActiveMode(pi, event => {
            const identity = `mode:${event.name}`; const names = runtime.delegation[identity] ?? [];
            const targets = Object.fromEntries(names.map(name => [name, catalog.agents[name]!]).filter(([, value]) => value !== undefined));
            current = { identity, targets, catalog }; registerDispatch(targets);
        }, error => { current = { identity: "mode:invalid", targets: {}, catalog, error: error.message }; registerDispatch({}); });
        registerDispatch({});
    }
    if (env.PI_SUBAGENT_AGENT_ID) {
        pi.registerCommand("parent", {
            description: "Return to this subagent's parent tmux window",
            async handler(_args, ctx) {
                const config = await loadOrchestrationConfig(configPath);
                const result = await exec(config.returnParentCommand, []);
                if (result.code !== 0) ctx.ui.notify(result.stderr.trim() || "Could not return to the parent window", "error");
            },
        });
    }
    pi.on("session_start", async (_event, ctx) => {
        const config = await loadOrchestrationConfig(configPath); if (resolvedEnvelope) emitResolvedAgent(pi, resolvedEnvelope);
        natureHandleWords = config.natureHandleWords;
        if (env.PI_SUBAGENT_AGENT_ID) ctx.ui.setStatus(PARENT_NAVIGATION_STATUS, config.parentNavigationHint);
        const lineage = origin(ctx, env);
        await reconcileOriginUsageClaims(config.stateRoot, lineage.originSessionId, lineage.originSessionFile);
    });
    if (resolvedEnvelope) pi.on("before_agent_start", (event, ctx) => { const definition = resolvedEnvelope!.self; const opted = new Set(definition.skillOptIns); const loaded = event.systemPromptOptions.skills ?? []; const names = new Set(loaded.map(skill => skill.name)); const missing = definition.skillOptIns.filter(name => !names.has(name)); if (missing.length) ctx.ui.notify(`Agent ${resolvedEnvelope!.identity}: opted-in skills unavailable: ${missing.join(", ")}`, "warning"); const skills = loaded.filter(skill => opted.has(skill.name) && skill.disableModelInvocation).map(skill => ({ ...skill, disableModelInvocation: false })); const addition = [formatSkillsForPrompt(skills), definition.instructions].filter(Boolean).join("\n\n"); if (addition) return { systemPrompt: `${event.systemPrompt}\n\n${addition}` }; });
    const paletteDeps = (ctx: ExtensionContext, config: SubagentRuntimeConfig): SubagentPaletteDependencies => { const caller = active(deps); return { stateRoot: config.stateRoot, originSessionId: origin(ctx, env).originSessionId, authorizedAgents: Object.keys(caller.targets), callerIdentity: caller.identity, exec, env, tmux: config.tmux, historyViewerExtension: config.historyViewerExtension, piCommand: config.harnesses.pi!.command, natureHandleWords: config.natureHandleWords, tmuxPreviewActions: loadFeatureKeybindings("tmuxPreview").actions }; };
    providePopupView(pi, { id: "agent-sessions", title: "Agent Sessions", create(view) { const component = new SubagentPaletteComponent({ tui: view.tui, theme: view.theme, ui: view.extensionContext.ui, keymap: loadPaletteKeymap(undefined, "subagentPalette").keymap, deps: paletteDeps(view.extensionContext, runtime), done: disposition => view.done(disposition === "close" ? "close-all" : "back") }); component.start(); return component; } });
    const open = async (ctx: ExtensionContext, placement: "root" | "push" = "root") => openPopupView(pi, "agent-sessions", ctx, placement);
    const unregister = provideCommandPaletteContribution(pi.events, {
        owner: "subagent",
        id: "agents",
        label: "/subagent  Manage agent sessions",
        description: "Open, unlink, or stop native tmux agent sessions.",
        keywords: ["agents", "tmux"],
        run: async ctx => { const result = await open(ctx, "push"); return result === "close-all" ? "close" : "return"; },
    });
    pi.registerCommand("subagent", { description: "Manage persistent agent sessions", handler: async (_args, ctx) => { await open(ctx, "root"); } });
    pi.on("session_shutdown", async (event, ctx) => {
        unregister();
        const lineage = origin(ctx, env);
        if (lineage.depth > 0 || event.reason === "reload") return;
        const config = await loadOrchestrationConfig(configPath);
        const hubContext = await probeTmux(exec, config.tmux, env) ?? undefined;
        await cleanupOriginAgents({ stateRoot: config.stateRoot, originSessionId: lineage.originSessionId, exec, tmux: config.tmux, shutdownReason: event.reason, hubContext });
    });
    pi.registerTool(createSubagentGetTool(deps));
    pi.registerTool(createSubagentWaitTool(deps));
    pi.registerTool(createSubagentStopTool(deps));
    return true;
}
export default registerOrchestration;
