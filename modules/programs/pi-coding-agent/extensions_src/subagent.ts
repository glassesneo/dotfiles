import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { StringEnum, type Usage } from "@earendil-works/pi-ai";
import { defineTool, getAgentDir, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { loadAgentProfileConfig } from "./profile.ts";
import { onActiveProfile } from "./utilities/profile_events.ts";
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
} from "./utilities/subagent_cards.ts";
import { resolveHarnessAdapter } from "./utilities/subagent_harness.ts";
import { cleanupOriginAgents, failStartedSubagentAgent, readReconciledAgentSnapshot, stopSubagentAgentWithDisposition, stopSubagentTask, stopSubagentTaskWithDisposition } from "./utilities/subagent_management.ts";
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
} from "./utilities/subagent_projection.ts";
import { claimTaskUsage, createTask, findTaskAgent, prepareAgent, publishAgent, readAgentSnapshot, reconcileOriginUsageClaims, removePreparedAgent } from "./utilities/subagent_store.ts";
import { inspectAgentTmux, launchAgentSession, probeTmux, stopAgentSession, type CommandExecutor } from "./utilities/subagent_tmux.ts";
import { PURPOSE_MAX_LENGTH, addUsage, emptyUsage, fallbackRunPurpose, isTerminalAgent, isTerminalTask, parseSubagentFacet, projectChildEffectiveProfile, validateSubagentRuntimeConfig, type AgentSnapshot, type SubagentFacet, type SubagentRuntimeConfig, type UsageClaim } from "./utilities/subagent_types.ts";
import { NATURE_HANDLE_WORDS } from "./utilities/subagent_display_tree.ts";
import { openSubagentPalette } from "./utilities/subagent_palette.ts";
import { loadPaletteKeymap } from "./utilities/command_palette_keymap.ts";
import { loadFeatureKeybindings } from "./utilities/extension_keybindings.ts";
import { provideCommandPaletteContribution } from "./utilities/command_palette_contributions.ts";

const CONFIG = join(getAgentDir(), "subagent.json"); const PROFILES = join(getAgentDir(), "agent-profiles.json");
const taskPromptGuideline = "For `subagent_run` and `subagent_submit`, treat the selected target profile as a stable capability contract. Include the local objective and task-specific input or context in `prompt`; add task-specific constraints, output requirements, or stop conditions only when the target profile or its discoverable receiver skill does not already own them. Omit invocation instructions, skill paths, procedures, default constraints, and default output contracts already owned by the target profile or discoverable skill. To intentionally override the profile's normal skill, name the different skill; provide a skill path only for a task-specific resource that cannot be discovered by name. If the profile does not fit and no override is intended, choose a suitable profile or stop and report the gap.";
const runPromptGuidelines = [
    taskPromptGuideline,
    "Use `subagent_run` when the child result is the next dependency; do not call `subagent_wait` after it.",
    "Emit multiple sibling `subagent_run` calls for independent foreground tasks on distinct or new agents.",
];
const submitPromptGuidelines = ["Use `subagent_submit` only when independent parent work can proceed before the child result is needed."];
const getPromptGuidelines = ["Use `subagent_get` for one-time nonblocking inspection of a task or agent."];
const waitPromptGuidelines = ["Use `subagent_wait` only to collect previously background-submitted task IDs."];
const stopPromptGuidelines = ["Use `subagent_stop` only to terminate one task or agent."];
const taskParametersFor = (allowedTargets: readonly string[]) => Type.Object({
    profile: Type.Optional(StringEnum([...allowedTargets], {
        description: allowedTargets.length > 0
            ? `New agent profile target. Allowed: ${allowedTargets.join(", ")}`
            : "No new-agent profile targets are allowed for the active profile",
    })),
    agentId: Type.Optional(Type.String({ description: "Existing idle agent target. Mutually exclusive with profile." })),
    purpose: Type.String({ minLength: 1, maxLength: PURPOSE_MAX_LENGTH }),
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
export interface ActiveSubagentProfile { name: string; facet?: SubagentFacet; error?: string }
export interface SubagentDependencies { configPath: string; profileConfigPath?: string; env: NodeJS.ProcessEnv; exec: CommandExecutor; activeProfile?: () => ActiveSubagentProfile | undefined; natureHandleWords?: () => readonly string[]; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; now?: () => number }
export async function loadSubagentConfig(path: string): Promise<SubagentRuntimeConfig> { try { return validateSubagentRuntimeConfig(JSON.parse(await readFile(path, "utf8"))); } catch (error) { throw new Error(`Cannot read subagent config ${path}: ${error instanceof Error ? error.message : String(error)}`); } }
function origin(ctx: ExtensionContext, env: NodeJS.ProcessEnv) { const raw = Number.parseInt(env.PI_SUBAGENT_DEPTH ?? "0", 10); return { depth: Number.isInteger(raw) && raw >= 0 ? raw : 0, parentAgentId: env.PI_SUBAGENT_AGENT_ID, originSessionId: env.PI_SUBAGENT_ORIGIN_SESSION_ID ?? ctx.sessionManager.getSessionId(), originSessionFile: ctx.sessionManager.getSessionFile() ?? env.PI_SUBAGENT_ORIGIN_SESSION_FILE }; }
function sleep(ms: number, signal?: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { if (signal?.aborted) { reject(signal.reason); return; } const timer = setTimeout(resolve, ms); signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); }); }
function errorText(value: unknown): string { if (value instanceof Error) return value.message; if (typeof value === "string") return value; return JSON.stringify(value) ?? "Unknown error"; }

function asRecord(args: unknown): Record<string, unknown> {
    if (!args || typeof args !== "object" || Array.isArray(args)) return {};
    return { ...(args as Record<string, unknown>) };
}

/** Strip legacy `detail` before schema validation. */
function stripLegacyDetail(args: unknown): Record<string, unknown> {
    const value = asRecord(args);
    delete value.detail;
    return value;
}

function prepareGetArguments(args: unknown): Static<typeof getParameters> {
    const value = asRecord(args);
    if (value.debug === undefined && value.detail === true) value.debug = true;
    delete value.detail;
    return value as Static<typeof getParameters>;
}

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

function active(deps: SubagentDependencies) { const value = deps.activeProfile?.(); if (!value) throw new Error("Subagent configuration unavailable: no active-profile event has been received"); if (value.error) throw new Error(`Subagent configuration unavailable: ${value.error}`); return value; }
function rejectSelfTarget(env: NodeJS.ProcessEnv, agentId: string, operation: "run" | "submit" | "get" | "stop" | "wait"): void {
    const self = env.PI_SUBAGENT_AGENT_ID;
    if (self && self === agentId) throw new Error(`subagent_${operation} cannot target the calling agent itself (${agentId})`);
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

async function startProfileSubmission(
    deps: SubagentDependencies,
    config: SubagentRuntimeConfig,
    current: ActiveSubagentProfile,
    params: TaskParameters & { profile: string },
    signal: AbortSignal | undefined,
    ctx: ExtensionContext,
    onTaskCreated?: (snapshot: AgentSnapshot) => void,
    preserveOnAbortAfterSubmission = false,
): Promise<AgentSnapshot> {
    if (signal?.aborted) throw signal.reason;
    if (!current.facet?.allowedTargets.includes(params.profile)) throw new Error(`Profile ${current.name} is not allowed to start subagent profile ${params.profile}`);
    const profiles = await loadAgentProfileConfig(deps.profileConfigPath ?? PROFILES, deps.env);
    const profile = profiles.profiles[params.profile];
    if (!profile) throw new Error(`Unknown subagent profile: ${params.profile}`);
    if (profile.allowAllTools) throw new Error(`Subagent target profile ${params.profile} uses allowAllTools and cannot be used as a child target`);
    if (!profile.availability.includes("subagent")) throw new Error(`Subagent target profile ${params.profile} is not available to subagents`);
    const effective = projectChildEffectiveProfile(profile, config.childExcludedTools);
    const lineage = origin(ctx, deps.env);
    const depth = lineage.depth + 1;
    if (depth > config.maxDepth) throw new Error(`Subagent depth ${depth} exceeds maxDepth ${config.maxDepth}`);
    const harness = (profile.extensions.subagent as { harness?: string } | undefined)?.harness ?? "pi";
    const resolvedHarness = resolveHarnessAdapter(config, harness, effective);
    const { adapter } = resolvedHarness;
    const context = await probeTmux(deps.exec, config.tmux, deps.env);
    if (!context) throw new Error("Subagent start requires a usable current tmux context");
    const prepared = await prepareAgent(config.stateRoot, {
        profile: params.profile,
        purpose: params.purpose,
        harness,
        cwd: ctx.cwd,
        profileSnapshot: effective,
        lineage: { callerProfile: current.name, targetProfile: params.profile, depth, parentAgentId: lineage.parentAgentId, originSessionId: lineage.originSessionId, originSessionFile: lineage.originSessionFile },
        capabilities: adapter.capabilities,
    });
    let tmux;
    let published = false;
    let taskCreated = false;
    try {
        const launch = adapter.launch(config, resolvedHarness.harness, {
            agentId: prepared.agentId,
            agentDirectory: prepared.paths.directory,
            profile: params.profile,
            profileSnapshot: effective,
            depth,
            originSessionId: lineage.originSessionId,
            originSessionFile: lineage.originSessionFile,
            cwd: ctx.cwd,
        });
        tmux = await launchAgentSession(deps.exec, config.tmux, context, { agentId: prepared.agentId, profile: params.profile, originSessionId: lineage.originSessionId, cwd: ctx.cwd, launch });
        await publishAgent(prepared.paths, {
            agentId: prepared.agentId,
            profile: params.profile,
            purpose: params.purpose,
            harness,
            cwd: ctx.cwd,
            profileSnapshot: effective,
            tmux,
            tmuxOwnership: "origin-hub",
            capabilities: adapter.capabilities,
            callerProfile: current.name,
            targetProfile: params.profile,
            depth,
            parentAgentId: lineage.parentAgentId,
            originSessionId: lineage.originSessionId,
            originSessionFile: lineage.originSessionFile,
        });
        published = true;
        if (signal?.aborted) throw signal.reason;
        const task = await createTask(config.stateRoot, prepared.agentId, params.purpose, params.prompt);
        taskCreated = true;
        onTaskCreated?.(await readAgentSnapshot(config.stateRoot, prepared.agentId, task.request.taskId));
        const readyTimeoutMs = resolvedHarness.harness.bridgeReadyTimeoutMs ?? config.bridgeReadyTimeoutMs ?? 5000;
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

function validateTaskTarget(params: TaskParameters, toolName: "subagent_run" | "subagent_submit"): { kind: "profile"; profile: string } | { kind: "agent"; agentId: string } {
    const hasProfile = params.profile !== undefined;
    const hasAgent = params.agentId !== undefined;
    if (hasProfile === hasAgent) throw new Error(`${toolName} requires exactly one of profile or agentId`);
    return hasProfile ? { kind: "profile", profile: params.profile! } : { kind: "agent", agentId: params.agentId! };
}

export function createSubagentRunTool(deps: SubagentDependencies, allowedTargets: readonly string[] = []): ToolDefinition {
    const parameters = taskParametersFor(allowedTargets);
    return defineTool({
        name: "subagent_run",
        label: "Run agent task",
        description: "Run one task on exactly one target and wait until it is terminal. Use profile for a new agent or agentId for an existing idle agent. Child failed or stopped outcomes are returned normally. Independent sibling runs can execute concurrently.",
        promptSnippet: "Run one foreground task on a new or existing persistent agent",
        promptGuidelines: runPromptGuidelines,
        parameters,
        prepareArguments(args) {
            const value = stripLegacyDetail(args) as TaskParameters & { purpose?: string; prompt: string };
            return value.purpose === undefined ? { ...value, purpose: fallbackRunPurpose(value.prompt) } : value;
        },
        async execute(toolCallId, params, signal, update, ctx) {
            const target = validateTaskTarget(params, "subagent_run");
            const config = await loadSubagentConfig(deps.configPath);
            let snapshot: AgentSnapshot | undefined;
            try {
                if (target.kind === "profile") {
                    snapshot = await startProfileSubmission(deps, config, active(deps), { ...params, profile: target.profile }, signal, ctx, created => { snapshot = created; }, true);
                } else {
                    if (signal?.aborted) throw signal.reason;
                    rejectSelfTarget(deps.env, target.agentId, "run");
                    const stored = await readAgentSnapshot(config.stateRoot, target.agentId);
                    if (stored.agent.originSessionId !== origin(ctx, deps.env).originSessionId) throw new Error(`Agent ${target.agentId} belongs to a different origin session`);
                    await readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, target.agentId);
                    if (signal?.aborted) throw signal.reason;
                    const task = await createTask(config.stateRoot, target.agentId, params.purpose, params.prompt);
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

export function createSubagentSubmitTool(deps: SubagentDependencies, allowedTargets: readonly string[] = []): ToolDefinition {
    const parameters = taskParametersFor(allowedTargets);
    return defineTool({
        name: "subagent_submit",
        label: "Submit agent task",
        description: "Submit one task to exactly one target: profile for a new profiled agent or agentId for an existing idle agent. Returns one submission result with distinct agentId and taskId. Returns immediately after task creation. Busy existing agents reject without queueing. Use subagent_run when the result is the next dependency, subagent_wait for background fan-in, and subagent_get for later inspection.",
        promptSnippet: "Submit one background task to a new or existing persistent agent",
        promptGuidelines: submitPromptGuidelines,
        parameters,
        executionMode: "sequential",
        prepareArguments(args) {
            const value = stripLegacyDetail(args) as TaskParameters & { purpose?: string; prompt: string };
            return value.purpose === undefined ? { ...value, purpose: fallbackRunPurpose(value.prompt) } : value;
        },
        async execute(toolCallId, params, signal, update, ctx) {
            const target = validateTaskTarget(params, "subagent_submit");
            let config: SubagentRuntimeConfig;
            let snapshot: AgentSnapshot;
            if (target.kind === "profile") {
                config = await loadSubagentConfig(deps.configPath);
                snapshot = await startProfileSubmission(deps, config, active(deps), { ...params, profile: target.profile }, signal, ctx);
            } else {
                rejectSelfTarget(deps.env, target.agentId, "submit");
                config = await loadSubagentConfig(deps.configPath);
                const stored = await readAgentSnapshot(config.stateRoot, target.agentId);
                if (stored.agent.originSessionId !== origin(ctx, deps.env).originSessionId) throw new Error(`Agent ${target.agentId} belongs to a different origin session`);
                await readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, target.agentId);
                await createTask(config.stateRoot, target.agentId, params.purpose, params.prompt);
                snapshot = await readAgentSnapshot(config.stateRoot, target.agentId);
            }

            return submitResult(snapshot, await claim(config, snapshot, ctx, deps.env, toolCallId, "subagent_submit"));
        },
        renderCall(args, theme, context) { return renderSubmitCall(args, theme, context); },
        renderResult(result, options, theme, context) { return renderSubmitResult(result, options, theme, context, deps.natureHandleWords?.()); },
    });
}
export function createSubagentGetTool(deps: SubagentDependencies): ToolDefinition<typeof getParameters, unknown> {
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
            const config = await loadSubagentConfig(deps.configPath);
            const expectedOrigin = origin(ctx, deps.env).originSessionId;
            const stored = await readAgentSnapshot(config.stateRoot, params.agentId, params.taskId);
            if (stored.agent.originSessionId !== expectedOrigin) throw new Error(`Agent ${params.agentId} belongs to a different origin session`);
            const snapshot = await readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, params.agentId, params.taskId);
            return agentResult(snapshot, await claim(config, snapshot, ctx, deps.env, id, "subagent_get"), params.debug === true);
        },
        renderCall(args, theme, context) { return renderGetCall(args, theme, context); },
        renderResult(result, options, theme, context) {
            return renderAgentToolResult(result, options, theme, context, undefined, context.args?.debug === true, deps.natureHandleWords?.());
        },
    });
}
export function createSubagentWaitTool(deps: SubagentDependencies): ToolDefinition<typeof waitParameters, unknown> {
    return defineTool({
        name: "subagent_wait",
        label: "Wait for tasks",
        description: "Wait for specified task IDs to become terminal without a deadline until the any/all condition is met. Aborting this observer leaves agent tasks alive. For abnormal-state diagnosis of one agent, use subagent_get with debug=true.",
        promptSnippet: "Wait for one or more background tasks",
        promptGuidelines: waitPromptGuidelines,
        parameters: waitParameters,
        executionMode: "sequential",
        prepareArguments(args) { return stripLegacyDetail(args) as Static<typeof waitParameters>; },
        async execute(id, params, signal, update, ctx) {
            const config = await loadSubagentConfig(deps.configPath);
            const session = origin(ctx, deps.env).originSessionId;
            const mapping = new Map<string, string>();
            for (const taskId of params.taskIds) mapping.set(taskId, await findTaskAgent(config.stateRoot, taskId, session));
            for (const [taskId, agentId] of mapping) {
                if (deps.env.PI_SUBAGENT_AGENT_ID && agentId === deps.env.PI_SUBAGENT_AGENT_ID) {
                    throw new Error(`subagent_wait cannot wait on the calling agent's own task ${taskId}`);
                }
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
export function createSubagentStopTool(deps: SubagentDependencies): ToolDefinition<typeof stopParameters, unknown> {
    return defineTool({
        name: "subagent_stop",
        label: "Stop agent or task",
        description: "Stop exactly one agent or task. agentId terminates the whole persistent agent session; taskId cancels only that task and leaves the agent reusable.",
        promptSnippet: "Stop one persistent agent session or one task",
        promptGuidelines: stopPromptGuidelines,
        parameters: stopParameters,
        executionMode: "sequential",
        prepareArguments(args) { return stripLegacyDetail(args) as Static<typeof stopParameters>; },
        async execute(id, params, _signal, _update, ctx) {
            const hasAgent = params.agentId !== undefined;
            const hasTask = params.taskId !== undefined;
            if (hasAgent === hasTask) throw new Error("subagent_stop requires exactly one of agentId or taskId");
            const config = await loadSubagentConfig(deps.configPath);
            let snapshot: AgentSnapshot;
            let stopDisposition: "stopped-now" | "stop-pending" | "already-terminal";
            if (params.agentId) {
                rejectSelfTarget(deps.env, params.agentId, "stop");
                const stopped = await stopSubagentAgentWithDisposition({ stateRoot: config.stateRoot, agentId: params.agentId, originSessionId: origin(ctx, deps.env).originSessionId, exec: deps.exec, tmux: config.tmux });
                stopDisposition = stopped.disposition;
                snapshot = stopped.snapshot;
            } else {
                const taskId = params.taskId!;
                const agentId = await findTaskAgent(config.stateRoot, taskId, origin(ctx, deps.env).originSessionId);
                rejectSelfTarget(deps.env, agentId, "stop");
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
export async function registerSubagent(pi: ExtensionAPI, options: Partial<Pick<SubagentDependencies, "configPath" | "profileConfigPath" | "env">> = {}): Promise<boolean> {
    loadFeatureKeybindings("subagentPalette");
    loadFeatureKeybindings("tmuxPreview");
    const configPath = options.configPath ?? CONFIG;
    const profileConfigPath = options.profileConfigPath ?? PROFILES;
    const env = options.env ?? process.env;
    let current: ActiveSubagentProfile | undefined;
    let natureHandleWords: readonly string[] = NATURE_HANDLE_WORDS;
    const exec: CommandExecutor = async (command, args) => {
        const value = await pi.exec(command, args);
        return { stdout: value.stdout, stderr: value.stderr, code: value.code };
    };
    const deps: SubagentDependencies = {
        configPath,
        profileConfigPath,
        env,
        exec,
        activeProfile: () => current,
        natureHandleWords: () => natureHandleWords,
    };
    const registerDispatch = (targets: readonly string[]) => {
        pi.registerTool(createSubagentRunTool(deps, targets));
        pi.registerTool(createSubagentSubmitTool(deps, targets));
    };
    onActiveProfile(pi, event => {
        try {
            const facet = parseSubagentFacet(event.profile.extensions.subagent ?? { allowedTargets: [] });
            current = { name: event.name, facet };
            registerDispatch(facet.allowedTargets);
        } catch (error) {
            current = { name: event.name, error: error instanceof Error ? error.message : String(error) };
            registerDispatch([]);
        }
    }, error => {
        current = { name: "unknown", error: error.message };
        registerDispatch([]);
    });
    pi.on("session_start", async (_event, ctx) => {
        const config = await loadSubagentConfig(configPath);
        natureHandleWords = config.natureHandleWords;
        const lineage = origin(ctx, env);
        await reconcileOriginUsageClaims(config.stateRoot, lineage.originSessionId, lineage.originSessionFile);
    });
    const open = async (ctx: ExtensionContext) => {
        const config = await loadSubagentConfig(configPath);
        natureHandleWords = config.natureHandleWords;
        return openSubagentPalette(ctx, loadPaletteKeymap(undefined, "subagentPalette").keymap, {
            stateRoot: config.stateRoot,
            originSessionId: origin(ctx, env).originSessionId,
            exec,
            env,
            tmux: config.tmux,
            historyViewerExtension: config.historyViewerExtension,
            piCommand: config.harnesses.pi.command,
            natureHandleWords: config.natureHandleWords,
            tmuxPreviewActions: loadFeatureKeybindings("tmuxPreview").actions,
        });
    };
    const unregister = provideCommandPaletteContribution(pi.events, {
        owner: "subagent",
        id: "agents",
        label: "/subagent  Manage agent sessions",
        description: "Open, unlink, or stop native tmux agent sessions.",
        keywords: ["agents", "tmux"],
        run: open,
    });
    pi.registerCommand("subagent", { description: "Manage persistent agent sessions", handler: async (_args, ctx) => { await open(ctx); } });
    pi.on("session_shutdown", async (event, ctx) => {
        unregister();
        const lineage = origin(ctx, env);
        if (lineage.depth > 0 || event.reason === "reload") return;
        const config = await loadSubagentConfig(configPath);
        const hubContext = await probeTmux(exec, config.tmux, env) ?? undefined;
        await cleanupOriginAgents({ stateRoot: config.stateRoot, originSessionId: lineage.originSessionId, exec, tmux: config.tmux, shutdownReason: event.reason, hubContext });
    });
    registerDispatch([]);
    pi.registerTool(createSubagentGetTool(deps));
    pi.registerTool(createSubagentWaitTool(deps));
    pi.registerTool(createSubagentStopTool(deps));
    return true;
}
export default registerSubagent;
