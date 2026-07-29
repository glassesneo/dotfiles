import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { StringEnum, type Usage } from "@earendil-works/pi-ai";
import { defineTool, getAgentDir, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { loadAgentProfileConfig } from "./profile.ts";
import { onActiveProfile } from "./utilities/profile_events.ts";
import { resolveHarnessAdapter } from "./utilities/subagent_harness.ts";
import { cleanupOriginAgents, failStartedSubagentAgent, readReconciledAgentSnapshot, stopSubagentAgent } from "./utilities/subagent_management.ts";
import { claimTaskUsage, createTask, findTaskAgent, prepareAgent, publishAgent, readAgentSnapshot, reconcileOriginUsageClaims, removePreparedAgent } from "./utilities/subagent_store.ts";
import { inspectAgentTmux, launchAgentSession, probeTmux, stopAgentSession, type CommandExecutor } from "./utilities/subagent_tmux.ts";
import { PURPOSE_MAX_LENGTH, addUsage, emptyUsage, fallbackRunPurpose, isTerminalAgent, isTerminalTask, parseSubagentFacet, projectChildEffectiveProfile, validateSubagentRuntimeConfig, type AgentSnapshot, type SubagentFacet, type SubagentRuntimeConfig } from "./utilities/subagent_types.ts";
import { openSubagentPalette } from "./utilities/subagent_palette.ts";
import { loadPaletteKeymap } from "./utilities/command_palette_keymap.ts";
import { provideCommandPaletteContribution } from "./utilities/command_palette_contributions.ts";

const CONFIG = join(getAgentDir(), "subagent.json"); const PROFILES = join(getAgentDir(), "agent-profiles.json");
const detail = Type.Optional(Type.Boolean({ default: false }));
const sendParameters = Type.Object({ agentId: Type.String(), purpose: Type.String({ minLength: 1, maxLength: PURPOSE_MAX_LENGTH }), prompt: Type.String({ minLength: 1 }), detail });
const getParameters = Type.Object({ agentId: Type.String(), taskId: Type.Optional(Type.String()), detail });
const waitParameters = Type.Object({ taskIds: Type.Array(Type.String(), { minItems: 1, maxItems: 128, uniqueItems: true }), condition: StringEnum(["any", "all"] as const), timeoutSeconds: Type.Integer({ minimum: 1, maximum: 3600 }), detail });
const stopParameters = Type.Object({ agentId: Type.String(), detail });
export interface ActiveSubagentProfile { name: string; facet?: SubagentFacet; error?: string }
export interface SubagentDependencies { configPath: string; profileConfigPath?: string; env: NodeJS.ProcessEnv; exec: CommandExecutor; activeProfile?: () => ActiveSubagentProfile | undefined; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; now?: () => number }
export async function loadSubagentConfig(path: string): Promise<SubagentRuntimeConfig> { try { return validateSubagentRuntimeConfig(JSON.parse(await readFile(path, "utf8"))); } catch (error) { throw new Error(`Cannot read subagent config ${path}: ${error instanceof Error ? error.message : String(error)}`); } }
function origin(ctx: ExtensionContext, env: NodeJS.ProcessEnv) { const raw = Number.parseInt(env.PI_SUBAGENT_DEPTH ?? "0", 10); return { depth: Number.isInteger(raw) && raw >= 0 ? raw : 0, parentAgentId: env.PI_SUBAGENT_AGENT_ID, originSessionId: env.PI_SUBAGENT_ORIGIN_SESSION_ID ?? ctx.sessionManager.getSessionId(), originSessionFile: ctx.sessionManager.getSessionFile() ?? env.PI_SUBAGENT_ORIGIN_SESSION_FILE }; }
function sleep(ms: number, signal?: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { if (signal?.aborted) { reject(signal.reason); return; } const timer = setTimeout(resolve, ms); signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); }); }
function errorText(value: unknown): string { if (value instanceof Error) return value.message; if (typeof value === "string") return value; return JSON.stringify(value) ?? "Unknown error"; }
function sanitized(snapshot: AgentSnapshot): AgentSnapshot { const task = snapshot.task && !isTerminalTask(snapshot.task.status.state) && snapshot.task.result ? { ...snapshot.task, result: null } : snapshot.task; return { ...snapshot, task }; }
function summary(rawSnapshot: AgentSnapshot, detailed: boolean): Record<string, unknown> { const snapshot = sanitized(rawSnapshot); const task = snapshot.task; const interventions = task?.interventions ?? []; const base = { agentId: snapshot.agent.agentId, taskId: task?.request.taskId, profile: snapshot.agent.profile, purpose: task?.request.purpose ?? snapshot.agent.purpose, agentState: snapshot.status.state, taskState: task?.status.state, activeTaskId: snapshot.status.activeTaskId, latestTaskId: snapshot.status.latestTaskId, agentUsage: snapshot.status.agentUsage, interventions, ...(task?.result ? { result: { outcome: task.result.outcome, output: task.result.output, error: task.result.error, usage: task.result.usage, turns: task.result.turns } } : {}) }; return detailed ? { ...base, agent: snapshot.agent, status: snapshot.status, task } : base; }
async function claim(config: SubagentRuntimeConfig, snapshot: AgentSnapshot, ctx: ExtensionContext, env: NodeJS.ProcessEnv, toolCallId: string, toolName: "subagent_start" | "subagent_get" | "subagent_wait" | "subagent_stop"): Promise<{ usage?: Usage; claimedTaskIds: string[] }> { const task = snapshot.task; if (!task?.result || !isTerminalTask(task.status.state)) return { claimedTaskIds: [] }; const lineage = origin(ctx, env); const value = await claimTaskUsage(config.stateRoot, snapshot.agent.agentId, task.request.taskId, lineage.originSessionId, lineage.originSessionFile, toolCallId, toolName); return value.created ? { usage: value.result.usage, claimedTaskIds: [task.request.taskId] } : { claimedTaskIds: [] }; }
function result(rawSnapshot: AgentSnapshot, accounting: { usage?: Usage; claimedTaskIds: string[] }, detailed: boolean) { const snapshot = sanitized(rawSnapshot); return { content: [{ type: "text" as const, text: JSON.stringify(summary(snapshot, detailed)) }], details: { ...snapshot, accounting }, usage: accounting.usage }; }
function active(deps: SubagentDependencies) { const value = deps.activeProfile?.(); if (!value) throw new Error("Subagent configuration unavailable: no active-profile event has been received"); if (value.error) throw new Error(`Subagent configuration unavailable: ${value.error}`); return value; }
function rejectSelfTarget(env: NodeJS.ProcessEnv, agentId: string, operation: "send" | "get" | "stop" | "wait"): void {
    const self = env.PI_SUBAGENT_AGENT_ID;
    if (self && self === agentId) throw new Error(`subagent_${operation} cannot target the calling agent itself (${agentId})`);
}
function startParametersFor(allowedTargets: readonly string[]) {
    const names = [...allowedTargets];
    return Type.Object({
        profile: StringEnum(names, {
            description: names.length > 0
                ? `Target agent profile. Allowed: ${names.join(", ")}`
                : "No subagent target profiles are allowed for the active profile",
        }),
        purpose: Type.String({ minLength: 1, maxLength: PURPOSE_MAX_LENGTH }),
        prompt: Type.String({ minLength: 1 }),
        detail,
    });
}
export function createSubagentStartTool(deps: SubagentDependencies, allowedTargets: readonly string[] = []): ToolDefinition {
    const startParameters = startParametersFor(allowedTargets);
    return defineTool({
        name: "subagent_start",
        label: "Start agent session",
        description: "Start a persistent native tmux agent session and its first task. Returns distinct agentId and taskId values.",
        promptSnippet: "Start a persistent profiled agent session",
        parameters: startParameters,
        executionMode: "sequential",
        prepareArguments(args) {
            const value = args as Static<typeof startParameters>;
            return value.purpose === undefined ? { ...value, purpose: fallbackRunPurpose(value.prompt) } : value;
        },
        async execute(toolCallId, params, signal, _update, ctx) {
            const config = await loadSubagentConfig(deps.configPath);
            const current = active(deps);
            if (!current.facet?.allowedTargets.includes(params.profile)) throw new Error(`Profile ${current.name} is not allowed to start subagent profile ${params.profile}`);
            const profiles = await loadAgentProfileConfig(deps.profileConfigPath ?? PROFILES, deps.env);
            const profile = profiles.profiles[params.profile];
            if (!profile) throw new Error(`Unknown subagent profile: ${params.profile}`);
            if (profile.allowAllTools) throw new Error(`Subagent target profile ${params.profile} uses allowAllTools and cannot be used as a child target`);
            const effective = projectChildEffectiveProfile(profile, config.childExcludedTools);
            const lineage = origin(ctx, deps.env);
            const depth = lineage.depth + 1;
            if (depth > config.maxDepth) throw new Error(`Subagent depth ${depth} exceeds maxDepth ${config.maxDepth}`);
            const context = await probeTmux(deps.exec, config.tmux, deps.env);
            if (!context) throw new Error("Subagent start requires a usable current tmux context");
            const harness = (profile.extensions.subagent as { harness?: string } | undefined)?.harness ?? "pi";
            const adapter = resolveHarnessAdapter(harness);
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
            try {
                const launch = adapter.launch(config, {
                    agentId: prepared.agentId,
                    agentDirectory: prepared.paths.directory,
                    profile: params.profile,
                    profileSnapshot: effective,
                    depth,
                    originSessionId: lineage.originSessionId,
                    originSessionFile: lineage.originSessionFile,
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
                await createTask(config.stateRoot, prepared.agentId, params.purpose, params.prompt);
                const deadline = (deps.now ?? (() => performance.now()))() + (config.bridgeReadyTimeoutMs ?? 5000);
                while ((deps.now ?? (() => performance.now()))() < deadline) {
                    if (signal?.aborted) throw signal.reason;
                    const snapshot = await readAgentSnapshot(config.stateRoot, prepared.agentId);
                    if (isTerminalAgent(snapshot.status.state)) throw new Error(snapshot.status.exitReason ?? `Child agent became ${snapshot.status.state} during startup`);
                    if (snapshot.status.bridgeReady) {
                        const live = await readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, prepared.agentId);
                        if (isTerminalAgent(live.status.state)) throw new Error(live.status.exitReason ?? `Child agent became ${live.status.state} during startup`);
                        return result(live, await claim(config, live, ctx, deps.env, toolCallId, "subagent_start"), params.detail === true);
                    }
                    await (deps.sleep ?? sleep)(50, signal);
                }
                throw new Error("Child bridge readiness timed out");
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                let cleanupError: unknown;
                if (published) {
                    try { await failStartedSubagentAgent({ stateRoot: config.stateRoot, agentId: prepared.agentId, originSessionId: lineage.originSessionId, exec: deps.exec, tmux: config.tmux }, message); }
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
        },
    });
}
export function createSubagentSendTool(deps: SubagentDependencies): ToolDefinition<typeof sendParameters, unknown> {
    return defineTool({
        name: "subagent_send",
        label: "Send agent task",
        description: "Send a new task to an idle persistent agent session. Busy agents reject the task without queueing it.",
        promptSnippet: "Send another task to an existing idle agent session",
        parameters: sendParameters,
        executionMode: "sequential",
        async execute(_id, params, _signal, _update, ctx) {
            rejectSelfTarget(deps.env, params.agentId, "send");
            const config = await loadSubagentConfig(deps.configPath);
            const snapshot = await readAgentSnapshot(config.stateRoot, params.agentId);
            if (snapshot.agent.originSessionId !== origin(ctx, deps.env).originSessionId) throw new Error(`Agent ${params.agentId} belongs to a different origin session`);
            await readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, params.agentId);
            await createTask(config.stateRoot, params.agentId, params.purpose, params.prompt);
            return result(await readAgentSnapshot(config.stateRoot, params.agentId), { claimedTaskIds: [] }, params.detail === true);
        },
    });
}
export function createSubagentGetTool(deps: SubagentDependencies): ToolDefinition<typeof getParameters, unknown> {
    return defineTool({
        name: "subagent_get",
        label: "Get agent task",
        description: "Read a persistent agent and a specified, active, or latest task once without waiting.",
        promptSnippet: "Read an agent session and task state",
        parameters: getParameters,
        executionMode: "sequential",
        async execute(id, params, _signal, _update, ctx) {
            rejectSelfTarget(deps.env, params.agentId, "get");
            const config = await loadSubagentConfig(deps.configPath);
            const expectedOrigin = origin(ctx, deps.env).originSessionId;
            const stored = await readAgentSnapshot(config.stateRoot, params.agentId, params.taskId);
            if (stored.agent.originSessionId !== expectedOrigin) throw new Error(`Agent ${params.agentId} belongs to a different origin session`);
            const snapshot = await readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, params.agentId, params.taskId);
            return result(snapshot, await claim(config, snapshot, ctx, deps.env, id, "subagent_get"), params.detail === true);
        },
    });
}
export function createSubagentWaitTool(deps: SubagentDependencies): ToolDefinition<typeof waitParameters, unknown> {
    return defineTool({
        name: "subagent_wait",
        label: "Wait for tasks",
        description: "Wait for specified task IDs to become terminal; timeout is a normal result and agent processes remain alive.",
        promptSnippet: "Wait for one or more tasks",
        parameters: waitParameters,
        executionMode: "sequential",
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
            const started = (deps.now ?? (() => performance.now()))();
            const deadline = started + params.timeoutSeconds * 1000;
            while (true) {
                const snapshots = await Promise.all(params.taskIds.map(taskId => readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, mapping.get(taskId)!, taskId)));
                const done = snapshots.filter(value => value.task && isTerminalTask(value.task.status.state));
                const met = params.condition === "any" ? done.length > 0 : done.length === snapshots.length;
                const timedOut = (deps.now ?? (() => performance.now()))() >= deadline;
                const reason = met ? "condition_met" : timedOut ? "timeout" : "polling";
                const accounting = { claimedTaskIds: [] as string[], usage: undefined as Usage | undefined };
                if (met || timedOut) for (const snapshot of snapshots) {
                    const item = await claim(config, snapshot, ctx, deps.env, id, "subagent_wait");
                    accounting.claimedTaskIds.push(...item.claimedTaskIds);
                    if (item.usage) {
                        if (!accounting.usage) accounting.usage = emptyUsage();
                        addUsage(accounting.usage, item.usage);
                    }
                }
                const payload = {
                    reason,
                    completedTaskIds: done.map(value => value.task!.request.taskId),
                    pendingTaskIds: snapshots.filter(value => !value.task || !isTerminalTask(value.task.status.state)).map(value => value.task?.request.taskId),
                    agents: snapshots.map(value => summary(value, params.detail === true)),
                };
                const response = { content: [{ type: "text" as const, text: JSON.stringify(payload) }], details: { ...payload, accounting }, usage: accounting.usage };
                if (reason !== "polling") return response;
                update?.(response);
                await (deps.sleep ?? sleep)(Math.min(1000, deadline - (deps.now ?? (() => performance.now()))()), signal);
            }
        },
    });
}
export function createSubagentStopTool(deps: SubagentDependencies): ToolDefinition<typeof stopParameters, unknown> {
    return defineTool({
        name: "subagent_stop",
        label: "Stop agent session",
        description: "Stop an agent's dedicated tmux session and terminalize its active task.",
        promptSnippet: "Stop one persistent agent session",
        parameters: stopParameters,
        executionMode: "sequential",
        async execute(id, params, _signal, _update, ctx) {
            rejectSelfTarget(deps.env, params.agentId, "stop");
            const config = await loadSubagentConfig(deps.configPath);
            const snapshot = await stopSubagentAgent({ stateRoot: config.stateRoot, agentId: params.agentId, originSessionId: origin(ctx, deps.env).originSessionId, exec: deps.exec, tmux: config.tmux });
            return result(snapshot, await claim(config, snapshot, ctx, deps.env, id, "subagent_stop"), params.detail === true);
        },
    });
}
export async function registerSubagent(pi: ExtensionAPI, options: Partial<Pick<SubagentDependencies, "configPath" | "profileConfigPath" | "env">> = {}): Promise<boolean> {
    const configPath = options.configPath ?? CONFIG;
    const profileConfigPath = options.profileConfigPath ?? PROFILES;
    const env = options.env ?? process.env;
    let current: ActiveSubagentProfile | undefined;
    const exec: CommandExecutor = async (command, args) => {
        const value = await pi.exec(command, args);
        return { stdout: value.stdout, stderr: value.stderr, code: value.code };
    };
    const deps: SubagentDependencies = { configPath, profileConfigPath, env, exec, activeProfile: () => current };
    const registerStart = (targets: readonly string[]) => {
        pi.registerTool(createSubagentStartTool(deps, targets));
    };
    onActiveProfile(pi, event => {
        try {
            const facet = parseSubagentFacet(event.profile.extensions.subagent ?? { allowedTargets: [] });
            current = { name: event.name, facet };
            registerStart(facet.allowedTargets);
        } catch (error) {
            current = { name: event.name, error: error instanceof Error ? error.message : String(error) };
            registerStart([]);
        }
    }, error => {
        current = { name: "unknown", error: error.message };
        registerStart([]);
    });
    pi.on("session_start", async (_event, ctx) => {
        const config = await loadSubagentConfig(configPath);
        const lineage = origin(ctx, env);
        await reconcileOriginUsageClaims(config.stateRoot, lineage.originSessionId, lineage.originSessionFile);
    });
    const open = async (ctx: ExtensionContext) => {
        const config = await loadSubagentConfig(configPath);
        await openSubagentPalette(ctx, loadPaletteKeymap().keymap, {
            stateRoot: config.stateRoot,
            originSessionId: origin(ctx, env).originSessionId,
            exec,
            env,
            tmux: config.tmux,
            historyViewerExtension: config.historyViewerExtension,
            piCommand: config.harnesses.pi.command,
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
    pi.registerCommand("subagent", { description: "Manage persistent agent sessions", handler: async (_args, ctx) => open(ctx) });
    pi.on("session_shutdown", async (event, ctx) => {
        unregister();
        const lineage = origin(ctx, env);
        if (lineage.depth > 0 || event.reason === "reload") return;
        const config = await loadSubagentConfig(configPath);
        const hubContext = await probeTmux(exec, config.tmux, env) ?? undefined;
        await cleanupOriginAgents({ stateRoot: config.stateRoot, originSessionId: lineage.originSessionId, exec, tmux: config.tmux, shutdownReason: event.reason, hubContext });
    });
    registerStart([]);
    pi.registerTool(createSubagentSendTool(deps));
    pi.registerTool(createSubagentGetTool(deps));
    pi.registerTool(createSubagentWaitTool(deps));
    pi.registerTool(createSubagentStopTool(deps));
    return true;
}
export default registerSubagent;
