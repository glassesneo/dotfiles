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
    renderSendCall,
    renderStartCall,
    renderStopCall,
    renderWaitCall,
    renderWaitResult,
} from "./utilities/subagent_cards.ts";
import { resolveHarnessAdapter } from "./utilities/subagent_harness.ts";
import { cleanupOriginAgents, failStartedSubagentAgent, readReconciledAgentSnapshot, stopSubagentAgent } from "./utilities/subagent_management.ts";
import {
    projectDebugSnapshot,
    projectMinimalAgentTask,
    projectMinimalWaitResult,
    sanitizeSnapshot,
    serializeModelVisibleJson,
    type AgentToolDetails,
    type WaitDetails,
} from "./utilities/subagent_projection.ts";
import { claimTaskUsage, createTask, findTaskAgent, prepareAgent, publishAgent, readAgentSnapshot, reconcileOriginUsageClaims, removePreparedAgent } from "./utilities/subagent_store.ts";
import { inspectAgentTmux, launchAgentSession, probeTmux, stopAgentSession, type CommandExecutor } from "./utilities/subagent_tmux.ts";
import { PURPOSE_MAX_LENGTH, addUsage, emptyUsage, fallbackRunPurpose, isTerminalAgent, isTerminalTask, parseSubagentFacet, projectChildEffectiveProfile, validateSubagentRuntimeConfig, type AgentSnapshot, type SubagentFacet, type SubagentRuntimeConfig } from "./utilities/subagent_types.ts";
import { NATURE_HANDLE_WORDS } from "./utilities/subagent_display_tree.ts";
import { openSubagentPalette } from "./utilities/subagent_palette.ts";
import { loadPaletteKeymap } from "./utilities/command_palette_keymap.ts";
import { provideCommandPaletteContribution } from "./utilities/command_palette_contributions.ts";

const CONFIG = join(getAgentDir(), "subagent.json"); const PROFILES = join(getAgentDir(), "agent-profiles.json");
const sendParameters = Type.Object({
    agentId: Type.String(),
    purpose: Type.String({ minLength: 1, maxLength: PURPOSE_MAX_LENGTH }),
    prompt: Type.String({ minLength: 1 }),
});
const getParameters = Type.Object({
    agentId: Type.String(),
    taskId: Type.Optional(Type.String()),
    debug: Type.Optional(Type.Boolean({
        default: false,
        description: "Abnormal-state diagnosis only. When true, returns full sanitized persisted snapshot metadata. Not needed for normal operation.",
    })),
});
const waitParameters = Type.Object({
    taskIds: Type.Array(Type.String(), { minItems: 1, maxItems: 128, uniqueItems: true }),
    condition: StringEnum(["any", "all"] as const),
    timeoutSeconds: Type.Integer({ minimum: 1, maximum: 3600 }),
});
const stopParameters = Type.Object({ agentId: Type.String() });
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

async function claim(config: SubagentRuntimeConfig, snapshot: AgentSnapshot, ctx: ExtensionContext, env: NodeJS.ProcessEnv, toolCallId: string, toolName: "subagent_start" | "subagent_get" | "subagent_wait" | "subagent_stop"): Promise<{ usage?: Usage; claimedTaskIds: string[] }> {
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
    });
}
export function createSubagentStartTool(deps: SubagentDependencies, allowedTargets: readonly string[] = []): ToolDefinition {
    const startParameters = startParametersFor(allowedTargets);
    return defineTool({
        name: "subagent_start",
        label: "Start agent session",
        description: "Start a persistent native tmux agent session and its first task. Returns distinct agentId and taskId values. For abnormal-state diagnosis of an existing agent, use subagent_get with debug=true.",
        promptSnippet: "Start a persistent profiled agent session",
        parameters: startParameters,
        executionMode: "sequential",
        prepareArguments(args) {
            const value = stripLegacyDetail(args) as Static<typeof startParameters> & { purpose?: string; prompt: string };
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
                await createTask(config.stateRoot, prepared.agentId, params.purpose, params.prompt);
                const deadline = (deps.now ?? (() => performance.now()))() + (config.bridgeReadyTimeoutMs ?? 5000);
                while ((deps.now ?? (() => performance.now()))() < deadline) {
                    if (signal?.aborted) throw signal.reason;
                    const snapshot = await readAgentSnapshot(config.stateRoot, prepared.agentId);
                    if (isTerminalAgent(snapshot.status.state)) throw new Error(snapshot.status.exitReason ?? `Child agent became ${snapshot.status.state} during startup`);
                    if (snapshot.status.bridgeReady) {
                        const live = await readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, prepared.agentId);
                        if (isTerminalAgent(live.status.state)) throw new Error(live.status.exitReason ?? `Child agent became ${live.status.state} during startup`);
                        return agentResult(live, await claim(config, live, ctx, deps.env, toolCallId, "subagent_start"));
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
        renderCall(args, theme, context) { return renderStartCall(args, theme, context); },
        renderResult(result, options, theme, context) {
            return renderAgentToolResult(result, options, theme, context, context.args?.prompt, undefined, deps.natureHandleWords?.());
        },
    });
}
export function createSubagentSendTool(deps: SubagentDependencies): ToolDefinition<typeof sendParameters, unknown> {
    return defineTool({
        name: "subagent_send",
        label: "Send agent task",
        description: "Send a new task to an idle persistent agent session. Busy agents reject the task without queueing it. For abnormal-state diagnosis, use subagent_get with debug=true.",
        promptSnippet: "Send another task to an existing idle agent session",
        parameters: sendParameters,
        executionMode: "sequential",
        prepareArguments(args) { return stripLegacyDetail(args) as Static<typeof sendParameters>; },
        async execute(_id, params, _signal, _update, ctx) {
            rejectSelfTarget(deps.env, params.agentId, "send");
            const config = await loadSubagentConfig(deps.configPath);
            const snapshot = await readAgentSnapshot(config.stateRoot, params.agentId);
            if (snapshot.agent.originSessionId !== origin(ctx, deps.env).originSessionId) throw new Error(`Agent ${params.agentId} belongs to a different origin session`);
            await readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, params.agentId);
            await createTask(config.stateRoot, params.agentId, params.purpose, params.prompt);
            return agentResult(await readAgentSnapshot(config.stateRoot, params.agentId), { claimedTaskIds: [] });
        },
        renderCall(args, theme, context) { return renderSendCall(args, theme, context); },
        renderResult(result, options, theme, context) {
            return renderAgentToolResult(result, options, theme, context, context.args?.prompt, undefined, deps.natureHandleWords?.());
        },
    });
}
export function createSubagentGetTool(deps: SubagentDependencies): ToolDefinition<typeof getParameters, unknown> {
    return defineTool({
        name: "subagent_get",
        label: "Get agent task",
        description: "Read a persistent agent and a specified, active, or latest task once without waiting. Optional debug returns full sanitized persisted snapshot metadata for abnormal-state diagnosis only; it is not needed for normal operation.",
        promptSnippet: "Read an agent session and task state",
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
        description: "Wait for specified task IDs to become terminal; timeout is a normal result and agent processes remain alive. For abnormal-state diagnosis of one agent, use subagent_get with debug=true.",
        promptSnippet: "Wait for one or more tasks",
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
            const started = (deps.now ?? (() => performance.now()))();
            const deadline = started + params.timeoutSeconds * 1000;
            while (true) {
                const snapshots = await Promise.all(params.taskIds.map(taskId => readReconciledAgentSnapshot(deps.exec, config.tmux, config.stateRoot, mapping.get(taskId)!, taskId)));
                const done = snapshots.filter(value => value.task && isTerminalTask(value.task.status.state));
                const met = params.condition === "any" ? done.length > 0 : done.length === snapshots.length;
                const timedOut = (deps.now ?? (() => performance.now()))() >= deadline;
                const finished = met || timedOut;
                const outcome = met ? "completed" as const : timedOut ? "timeout" as const : undefined;
                const accounting = { claimedTaskIds: [] as string[], usage: undefined as Usage | undefined };
                if (finished) for (const snapshot of snapshots) {
                    const item = await claim(config, snapshot, ctx, deps.env, id, "subagent_wait");
                    accounting.claimedTaskIds.push(...item.claimedTaskIds);
                    if (item.usage) {
                        if (!accounting.usage) accounting.usage = emptyUsage();
                        addUsage(accounting.usage, item.usage);
                    }
                }
                const agents = snapshots.map(sanitizeSnapshot);
                const details: WaitDetails = {
                    condition: params.condition,
                    timeoutSeconds: params.timeoutSeconds,
                    ...(outcome ? { outcome } : {}),
                    agents,
                    accounting,
                };
                const contentPayload = finished && outcome
                    ? projectMinimalWaitResult(agents, outcome)
                    : { tasks: agents.map(projectMinimalAgentTask) };
                const response = {
                    content: [{ type: "text" as const, text: serializeModelVisibleJson(contentPayload) }],
                    details,
                    usage: accounting.usage,
                };
                if (finished) return response;
                update?.(response);
                await (deps.sleep ?? sleep)(Math.min(1000, deadline - (deps.now ?? (() => performance.now()))()), signal);
            }
        },
        renderCall(args, theme, context) { return renderWaitCall(args, theme, context); },
        renderResult(result, options, theme, context) { return renderWaitResult(result, options, theme, context, deps.natureHandleWords?.()); },
    });
}
export function createSubagentStopTool(deps: SubagentDependencies): ToolDefinition<typeof stopParameters, unknown> {
    return defineTool({
        name: "subagent_stop",
        label: "Stop agent session",
        description: "Stop an agent's dedicated tmux session and terminalize its active task. For abnormal-state diagnosis, use subagent_get with debug=true.",
        promptSnippet: "Stop one persistent agent session",
        parameters: stopParameters,
        executionMode: "sequential",
        prepareArguments(args) { return stripLegacyDetail(args) as Static<typeof stopParameters>; },
        async execute(id, params, _signal, _update, ctx) {
            rejectSelfTarget(deps.env, params.agentId, "stop");
            const config = await loadSubagentConfig(deps.configPath);
            const snapshot = await stopSubagentAgent({ stateRoot: config.stateRoot, agentId: params.agentId, originSessionId: origin(ctx, deps.env).originSessionId, exec: deps.exec, tmux: config.tmux });
            return agentResult(snapshot, await claim(config, snapshot, ctx, deps.env, id, "subagent_stop"));
        },
        renderCall(args, theme, context) { return renderStopCall(args, theme, context); },
        renderResult(result, options, theme, context) { return renderAgentToolResult(result, options, theme, context, undefined, undefined, deps.natureHandleWords?.()); },
    });
}
export async function registerSubagent(pi: ExtensionAPI, options: Partial<Pick<SubagentDependencies, "configPath" | "profileConfigPath" | "env">> = {}): Promise<boolean> {
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
        natureHandleWords = config.natureHandleWords;
        const lineage = origin(ctx, env);
        await reconcileOriginUsageClaims(config.stateRoot, lineage.originSessionId, lineage.originSessionFile);
    });
    const open = async (ctx: ExtensionContext) => {
        const config = await loadSubagentConfig(configPath);
        natureHandleWords = config.natureHandleWords;
        return openSubagentPalette(ctx, loadPaletteKeymap().keymap, {
            stateRoot: config.stateRoot,
            originSessionId: origin(ctx, env).originSessionId,
            exec,
            env,
            tmux: config.tmux,
            historyViewerExtension: config.historyViewerExtension,
            piCommand: config.harnesses.pi.command,
            natureHandleWords: config.natureHandleWords,
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
    registerStart([]);
    pi.registerTool(createSubagentSendTool(deps));
    pi.registerTool(createSubagentGetTool(deps));
    pi.registerTool(createSubagentWaitTool(deps));
    pi.registerTool(createSubagentStopTool(deps));
    return true;
}
export default registerSubagent;
