import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { StringEnum, type Usage } from "@earendil-works/pi-ai";
import {
    defineTool,
    getAgentDir,
    type ExtensionAPI,
    type ExtensionContext,
    type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { loadAgentProfileConfig } from "./profile.ts";
import { provideCommandPaletteContribution } from "./utilities/command_palette_contributions.ts";
import { loadPaletteKeymap } from "./utilities/command_palette_keymap.ts";
import { openSubagentPalette, type SubagentPaletteComponent } from "./utilities/subagent_palette.ts";
import { onActiveProfile } from "./utilities/profile_events.ts";
import { snapshotDetails } from "./utilities/subagent_json.ts";
import { withRunLock } from "./utilities/subagent_lock.ts";
import { readReconciledRunSnapshot, stopSubagentRun } from "./utilities/subagent_management.ts";
import {
    childPromptPreview,
    renderRunIdCall,
    renderRunResult,
    renderStartCall,
    renderStopResult,
    renderWaitCall,
    renderWaitResult,
    runToolResult,
    stopToolResult,
    waitToolResult,
    type ChildHandoff,
    type SubagentWaitResult,
} from "./utilities/subagent_render.ts";
import {
    assertRunOrigin,
    claimRunUsage,
    createRun,
    immediateChildRequests,
    readSnapshot,
    readStatus,
    releaseRunUsageClaim,
    runPaths,
} from "./utilities/subagent_store.ts";
import { type CommandExecutor } from "./utilities/subagent_tmux.ts";
import { readHealthySupervisor } from "./utilities/subagent_supervisor.ts";
import {
    addUsage,
    emptyUsage,
    fallbackRunPurpose,
    isTerminalState,
    parseSubagentFacet,
    PURPOSE_MAX_LENGTH,
    validateSubagentRuntimeConfig,
    type NormalizedRunRequest,
    type RunSnapshot,
    type SubagentFacet,
    type SubagentRuntimeConfig,
} from "./utilities/subagent_types.ts";

const DEFAULT_CONFIG_PATH = join(getAgentDir(), "subagent.json");
const DEFAULT_PROFILE_CONFIG_PATH = join(getAgentDir(), "agent-profiles.json");

const detailParameter = Type.Optional(Type.Boolean({
    default: false,
    description: "Include the full persisted snapshot metadata and file paths in model-visible content. Internal tool details are always retained.",
}));
const startParameters = Type.Object({
    profile: Type.String({ minLength: 1, description: "Semantic subagent profile name" }),
    purpose: Type.String({ minLength: 1, maxLength: PURPOSE_MAX_LENGTH, description: "Short display purpose for this delegated run" }),
    prompt: Type.String({ minLength: 1, description: "Task prompt delegated to the subagent" }),
    detail: detailParameter,
});
const getParameters = Type.Object({
    runId: Type.String({ description: "UUID returned by subagent_start" }),
    detail: detailParameter,
});
const waitParameters = Type.Object({
    runIds: Type.Array(Type.String({ description: "UUID returned by subagent_start" }), { minItems: 1, maxItems: 128, uniqueItems: true }),
    condition: StringEnum(["any", "all"] as const),
    timeoutSeconds: Type.Integer({ minimum: 1, maximum: 3600 }),
    detail: detailParameter,
});
const stopParameters = Type.Object({
    runId: Type.String({ description: "UUID of the single subagent run to stop" }),
    detail: detailParameter,
});

export type { SubagentWaitResult } from "./utilities/subagent_render.ts";

export interface ActiveSubagentProfile {
    name: string;
    facet?: SubagentFacet;
    error?: string;
}

export interface SubagentDependencies {
    configPath: string;
    profileConfigPath?: string;
    env: NodeJS.ProcessEnv;
    exec: CommandExecutor;
    activeProfile?: () => ActiveSubagentProfile | undefined;
    monotonicNow?: () => number;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export async function loadSubagentConfig(path: string): Promise<SubagentRuntimeConfig> {
    let value: unknown;
    try { value = JSON.parse(await readFile(path, "utf8")); }
    catch (error) { throw new Error(`Cannot read subagent config ${path}: ${error instanceof Error ? error.message : String(error)}`); }
    return validateSubagentRuntimeConfig(value);
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    if (signal.reason instanceof Error) throw signal.reason;
    throw new Error("Subagent wait cancelled");
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, milliseconds);
        const onAbort = () => {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", onAbort);
            reject(signal?.reason instanceof Error ? signal.reason : new Error("Subagent wait cancelled"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

function origin(ctx: ExtensionContext, env: NodeJS.ProcessEnv) {
    const depth = Number.parseInt(env.PI_SUBAGENT_DEPTH ?? "0", 10);
    return {
        depth: Number.isInteger(depth) && depth >= 0 ? depth : 0,
        parentRunId: env.PI_SUBAGENT_RUN_ID,
        originSessionId: env.PI_SUBAGENT_ORIGIN_SESSION_ID ?? ctx.sessionManager.getSessionId(),
        originSessionFile: env.PI_SUBAGENT_ORIGIN_SESSION_FILE ?? ctx.sessionManager.getSessionFile(),
    };
}

interface UsageClaimOperations {
    claim: typeof claimRunUsage;
    release: typeof releaseRunUsageClaim;
}

export async function claimUsageBatch(
    stateRoot: string,
    snapshots: RunSnapshot[],
    sessionId: string,
    toolCallId: string,
    toolName: "subagent_start" | "subagent_get" | "subagent_wait" | "subagent_stop",
    operations: UsageClaimOperations = { claim: claimRunUsage, release: releaseRunUsageClaim },
): Promise<{ usage?: Usage; claimedRunIds: string[] }> {
    const aggregate = emptyUsage();
    const claimedRunIds: string[] = [];
    try {
        for (const snapshot of snapshots) {
            if (!isTerminalState(snapshot.status) || !snapshot.result || snapshot.accounting.claimed) continue;
            try {
                const claimed = await operations.claim(stateRoot, snapshot.runId, sessionId, toolCallId, toolName);
                if (!claimed.created) continue;
                addUsage(aggregate, claimed.result.usage);
                claimedRunIds.push(snapshot.runId);
            } catch (error) {
                if (error instanceof Error && error.message.includes("different origin session")) continue;
                throw error;
            }
        }
    } catch (error) {
        const rollbacks = await Promise.allSettled(
            claimedRunIds.map(runId => operations.release(stateRoot, runId, sessionId, toolCallId)),
        );
        const rollbackErrors = rollbacks.flatMap(result => result.status === "rejected" ? [result.reason] : []);
        if (rollbackErrors.length > 0) throw new AggregateError([error, ...rollbackErrors], "Usage claim batch failed and could not be fully rolled back");
        throw error;
    }
    return { usage: claimedRunIds.length > 0 ? aggregate : undefined, claimedRunIds };
}

async function claimedUsage(
    config: SubagentRuntimeConfig,
    snapshots: RunSnapshot[],
    ctx: ExtensionContext,
    env: NodeJS.ProcessEnv,
    toolCallId: string,
    toolName: "subagent_start" | "subagent_get" | "subagent_wait" | "subagent_stop",
): Promise<{ usage?: Usage; claimedRunIds: string[] }> {
    return claimUsageBatch(config.stateRoot, snapshots, origin(ctx, env).originSessionId, toolCallId, toolName);
}

export function createSubagentStartTool(deps: SubagentDependencies): ToolDefinition<typeof startParameters, ReturnType<typeof snapshotDetails>> {
    return defineTool({
        name: "subagent_start", label: "Start subagent",
        description: "Start one supervisor-managed profiled subagent asynchronously without waiting for completion. Returns its run ID, purpose, profile, and status by default; set detail=true for the full persisted snapshot metadata and file paths.",
        promptSnippet: "Start an asynchronous profiled subagent and return its observable run summary",
        promptGuidelines: ["Use subagent_start with a semantic profile, a short purpose, and a complete task prompt; after it returns, continue useful independent main-agent work. Use subagent_wait only when the result is needed for the next work and no useful independent work remains."],
        parameters: startParameters,
        prepareArguments(args): Static<typeof startParameters> {
            if (args === null || typeof args !== "object" || Array.isArray(args)) return args as Static<typeof startParameters>;
            const input = args as { purpose?: unknown; prompt?: unknown };
            if (input.purpose !== undefined || typeof input.prompt !== "string") return args as Static<typeof startParameters>;
            return { ...input, purpose: fallbackRunPurpose(input.prompt) } as Static<typeof startParameters>;
        },
        executionMode: "sequential",
        renderCall(args, theme, context) { return renderStartCall(args, context.expanded, theme); },
        renderResult(result, options, theme) { return renderRunResult(result, options.expanded, theme); },
        async execute(toolCallId, params, _signal, _onUpdate, ctx) {
            const config = await loadSubagentConfig(deps.configPath);
            const profiles = await loadAgentProfileConfig(deps.profileConfigPath ?? DEFAULT_PROFILE_CONFIG_PATH, deps.env);
            const active = deps.activeProfile?.();
            if (!active) throw new Error("Subagent configuration unavailable: no active-profile event has been received");
            if (active.error) throw new Error(`Subagent configuration unavailable: ${active.error}`);
            const allowedTargets = active.facet?.allowedTargets ?? [];
            const targetProfile = profiles.profiles[params.profile];
            if (!targetProfile) throw new Error(`Unknown subagent profile: ${params.profile}`);
            if (!allowedTargets.includes(params.profile)) {
                throw new Error(`Profile ${active.name} is not allowed to start subagent profile ${params.profile}`);
            }
            const current = origin(ctx, deps.env);
            const childDepth = current.depth + 1;
            if (childDepth > config.maxDepth) throw new Error(`Subagent depth ${childDepth} exceeds maxDepth ${config.maxDepth}`);
            await readHealthySupervisor(config.stateRoot);
            const enqueue = async () => {
                if (current.parentRunId) {
                    const parentStatus = await readStatus(runPaths(config.stateRoot, current.parentRunId));
                    if (parentStatus.status === "stopping" || isTerminalState(parentStatus.status)) throw new Error(`Parent subagent ${current.parentRunId} is no longer runnable`);
                }
                return createRun(config, params.profile, targetProfile, params.purpose, params.prompt, ctx.cwd, {
                    callerProfile: active.name, depth: childDepth, parentRunId: current.parentRunId,
                    originSessionId: current.originSessionId, originSessionFile: current.originSessionFile,
                });
            };
            const run = current.parentRunId ? await withRunLock(runPaths(config.stateRoot, current.parentRunId).directory, enqueue) : await enqueue();
            const deadline = performance.now() + 1000;
            let snapshot = await readSnapshot(config.stateRoot, run.request.runId);
            while (snapshot.status === "created" && performance.now() < deadline) {
                await abortableSleep(25); snapshot = await readSnapshot(config.stateRoot, run.request.runId);
            }
            return runToolResult(snapshot, await claimedUsage(config, [snapshot], ctx, deps.env, toolCallId, "subagent_start"), params.detail === true, true);
        },
    });
}

async function childHandoffs(config: SubagentRuntimeConfig, parent: NormalizedRunRequest, detail: boolean): Promise<ChildHandoff[]> {
    const requests = await immediateChildRequests(config.stateRoot, parent);
    return Promise.all(requests.map(async request => {
        const paths = runPaths(config.stateRoot, request.runId);
        const status = await readStatus(paths).then(value => value.status).catch(() => "unknown");
        return {
            runId: request.runId, purpose: request.purpose, profile: request.profile, status,
            promptPreview: childPromptPreview(request.prompt), requestPath: paths.request,
            runDirectory: paths.directory, paths: { request: paths.request, result: paths.result },
            ...(detail ? { request } : {}),
        };
    }));
}

export function createSubagentStopTool(deps: SubagentDependencies): ToolDefinition<typeof stopParameters, Record<string, unknown>> {
    return defineTool({
        name: "subagent_stop", label: "Stop subagent",
        description: "Stop exactly one subagent run from the same origin session. Immediate children are not stopped; the terminal result returns their run IDs, status, purpose, profile, and prompt preview for explicit handoff.",
        promptSnippet: "Stop one subagent run without recursively stopping its children",
        promptGuidelines: ["After subagent_stop, decide for every handed-off immediate child whether to continue with subagent_get or subagent_wait, take over its work, or stop that child individually with subagent_stop."],
        parameters: stopParameters, executionMode: "sequential",
        renderCall(args, theme, context) { return renderRunIdCall("subagent_stop", args.runId, context.expanded, theme); },
        renderResult(result, options, theme) { return renderStopResult(result, options.expanded, theme); },
        async execute(toolCallId, params, signal, _onUpdate, ctx) {
            throwIfAborted(signal);
            const config = await loadSubagentConfig(deps.configPath);
            const originSessionId = origin(ctx, deps.env).originSessionId;
            const stopped = await stopSubagentRun({
                stateRoot: config.stateRoot, runId: params.runId, originSessionId, exec: deps.exec, signal,
                monotonicNow: deps.monotonicNow, sleep: deps.sleep,
            });
            const children = await childHandoffs(config, stopped.run.request, true);
            const accounting = await claimedUsage(config, [stopped.run.snapshot], ctx, deps.env, toolCallId, "subagent_stop");
            return stopToolResult(stopped.run.snapshot, children, accounting, params.detail === true);
        },
    });
}

export function createSubagentGetTool(deps: SubagentDependencies): ToolDefinition<typeof getParameters, ReturnType<typeof snapshotDetails>> {
    return defineTool({
        name: "subagent_get", label: "Get subagent run",
        description: "Read one subagent run's current persisted state without waiting. Returns an actionable run summary by default; set detail=true for the full persisted snapshot metadata and file paths. Full logs remain in those files.",
        promptSnippet: "Read one subagent run's current state once without waiting",
        promptGuidelines: ["Use subagent_get for a one-time non-blocking status check or to retrieve an already completed result."],
        parameters: getParameters, executionMode: "sequential",
        renderCall(args, theme, context) { return renderRunIdCall("subagent_get", args.runId, context.expanded, theme); },
        renderResult(result, options, theme) { return renderRunResult(result, options.expanded, theme); },
        async execute(toolCallId, params, _signal, _onUpdate, ctx) {
            const config = await loadSubagentConfig(deps.configPath);
            await assertRunOrigin(config.stateRoot, params.runId, origin(ctx, deps.env).originSessionId);
            const snapshot = await readReconciledRunSnapshot(deps.exec, config.stateRoot, params.runId);
            return runToolResult(snapshot, await claimedUsage(config, [snapshot], ctx, deps.env, toolCallId, "subagent_get"), params.detail === true);
        },
    });
}

export function createSubagentWaitTool(deps: SubagentDependencies): ToolDefinition<
    typeof waitParameters,
    Omit<SubagentWaitResult, "runs"> & { runs: ReturnType<typeof snapshotDetails>[]; accounting: { claimedRunIds: string[] } }
> {
    return defineTool({
        name: "subagent_wait", label: "Wait for subagents",
        description: "Wait until any or all specified subagent runs reach a terminal state, or until timeout. Returns the reason and actionable run summaries by default; set detail=true for full persisted snapshots and file paths. Timeout is a normal result.",
        promptSnippet: "Wait for any or all selected subagent runs to reach a terminal state",
        promptGuidelines: ["Use subagent_wait on its own only when no useful independent work remains and one or more delegated results are needed; use subagent_get instead for a one-time non-blocking status check."],
        parameters: waitParameters, executionMode: "sequential",
        renderCall(args, theme, context) { return renderWaitCall(args, context.expanded, theme); },
        renderResult(result, options, theme) { return renderWaitResult(result, options.expanded, theme); },
        async execute(toolCallId, params, signal, onUpdate, ctx) {
            throwIfAborted(signal);
            if (new Set(params.runIds).size !== params.runIds.length) throw new Error("subagent_wait runIds must not contain duplicates");
            const config = await loadSubagentConfig(deps.configPath);
            const originSessionId = origin(ctx, deps.env).originSessionId;
            for (const runId of params.runIds) {
                throwIfAborted(signal);
                await assertRunOrigin(config.stateRoot, runId, originSessionId);
                await readSnapshot(config.stateRoot, runId);
            }
            const monotonicNow = deps.monotonicNow ?? (() => performance.now());
            const sleep = deps.sleep ?? abortableSleep;
            const startedAt = new Date().toISOString();
            const deadline = monotonicNow() + params.timeoutSeconds * 1000;

            while (true) {
                throwIfAborted(signal);
                const runs: RunSnapshot[] = [];
                for (const runId of params.runIds) { throwIfAborted(signal); runs.push(await readReconciledRunSnapshot(deps.exec, config.stateRoot, runId)); }
                const completedRunIds = runs.filter(snapshot => isTerminalState(snapshot.status)).map(snapshot => snapshot.runId);
                const completed = new Set(completedRunIds);
                const pendingRunIds = params.runIds.filter(runId => !completed.has(runId));
                const current: SubagentWaitResult = {
                    schemaVersion: 2, condition: params.condition, reason: "polling",
                    timeoutSeconds: params.timeoutSeconds, startedAt, finishedAt: new Date().toISOString(),
                    completedRunIds, pendingRunIds, runs,
                };
                onUpdate?.(waitToolResult(current, { claimedRunIds: [] }, params.detail === true));
                const conditionMet = params.condition === "any" ? completedRunIds.length > 0 : pendingRunIds.length === 0;
                const timedOut = monotonicNow() >= deadline;
                if (conditionMet || timedOut) {
                    const value: SubagentWaitResult = {
                        ...current, reason: conditionMet ? "condition_met" : "timeout", finishedAt: new Date().toISOString(),
                    };
                    const accounting = await claimedUsage(config, runs, ctx, deps.env, toolCallId, "subagent_wait");
                    return waitToolResult(value, accounting, params.detail === true);
                }
                await sleep(Math.min(1000, deadline - monotonicNow()), signal);
            }
        },
    });
}

async function reconcileSessionAccounting(config: SubagentRuntimeConfig, ctx: ExtensionContext): Promise<void> {
    const sessionId = ctx.sessionManager.getSessionId();
    for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type !== "message" || entry.message.role !== "toolResult" || !entry.message.usage) continue;
        const toolName = entry.message.toolName;
        if (toolName !== "subagent_start" && toolName !== "subagent_get" && toolName !== "subagent_wait" && toolName !== "subagent_stop") continue;
        const details = entry.message.details as { accounting?: { claimedRunIds?: unknown } } | undefined;
        const runIds = details?.accounting?.claimedRunIds;
        if (!Array.isArray(runIds)) continue;
        for (const runId of runIds) {
            if (typeof runId !== "string") continue;
            await claimRunUsage(config.stateRoot, runId, sessionId, entry.message.toolCallId, toolName);
        }
    }
}

export async function registerSubagent(
    pi: ExtensionAPI,
    options: Partial<Pick<SubagentDependencies, "configPath" | "profileConfigPath" | "env">> = {},
): Promise<boolean> {
    const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;
    const profileConfigPath = options.profileConfigPath ?? DEFAULT_PROFILE_CONFIG_PATH;
    const env = options.env ?? process.env;
    let activeProfile: ActiveSubagentProfile | undefined;
    onActiveProfile(
        pi,
        event => {
            const rawFacet = event.profile.extensions.subagent;
            if (rawFacet === undefined) {
                activeProfile = { name: event.name, facet: { allowedTargets: [] } };
                return;
            }
            try { activeProfile = { name: event.name, facet: parseSubagentFacet(rawFacet) }; }
            catch (error) { activeProfile = { name: event.name, error: error instanceof Error ? error.message : String(error) }; }
        },
        error => { activeProfile = { name: "unknown", error: error.message }; },
    );
    const exec: CommandExecutor = async (command, args) => {
        const output = await pi.exec(command, args);
        return { stdout: output.stdout, stderr: output.stderr, code: output.code };
    };
    const deps: SubagentDependencies = { configPath, profileConfigPath, env, exec, activeProfile: () => activeProfile };
    pi.on("before_agent_start", async event => {
        if (!activeProfile?.facet || activeProfile.error || !pi.getActiveTools().includes("subagent_start")) return;
        const profiles = await loadAgentProfileConfig(profileConfigPath, env);
        const entries = activeProfile.facet.allowedTargets.flatMap(name => {
            const profile = profiles.profiles[name];
            return profile ? [`- ${name}: ${profile.description}`] : [];
        });
        if (entries.length === 0) return;
        return { systemPrompt: `${event.systemPrompt}\n\nAvailable subagent routing profiles:\n${entries.join("\n")}` };
    });
    const managementComponents = new Set<SubagentPaletteComponent>();
    let managementOpening = false;
    const openManagement = async (ctx: ExtensionContext): Promise<void> => {
        if (managementOpening) return;
        if (ctx.mode !== "tui") { ctx.ui.notify("Subagent management requires TUI mode", "warning"); return; }
        managementOpening = true;
        let component: SubagentPaletteComponent | undefined;
        try {
            const config = await loadSubagentConfig(configPath);
            await openSubagentPalette(ctx, loadPaletteKeymap().keymap, {
                stateRoot: config.stateRoot, originSessionId: origin(ctx, env).originSessionId, exec, env,
                configPath, node: config.runner.node, viewer: config.runner.viewer, cwd: ctx.cwd,
            }, value => { component = value; managementComponents.add(value); });
        } catch (error) {
            ctx.ui.notify(`Could not open Subagents: ${error instanceof Error ? error.message : String(error)}`, "error");
        } finally {
            if (component) managementComponents.delete(component);
            managementOpening = false;
        }
    };
    const unregisterManagementContribution = provideCommandPaletteContribution(pi.events, {
        owner: "subagent", id: "runs", label: "/subagent  Manage subagent runs", description: "Inspect and manage runs from the current origin session.",
        keywords: ["runs", "agents", "replay"], run: openManagement,
    });
    pi.registerCommand("subagent", {
        description: "Inspect and manage subagent runs",
        handler: async (args, ctx) => {
            if (args.trim() !== "") { ctx.ui.notify("/subagent does not accept arguments", "warning"); return; }
            await openManagement(ctx);
        },
    });
    pi.on("session_start", async (_event, ctx) => {
        try { await reconcileSessionAccounting(await loadSubagentConfig(configPath), ctx); }
        catch (error) { ctx.ui.notify(`Could not reconcile subagent usage claims: ${error instanceof Error ? error.message : String(error)}`, "warning"); }
    });
    pi.on("session_shutdown", () => {
        unregisterManagementContribution();
        for (const component of managementComponents) component.close();
        managementComponents.clear();
    });
    pi.registerTool(createSubagentStartTool(deps));
    pi.registerTool(createSubagentGetTool(deps));
    pi.registerTool(createSubagentWaitTool(deps));
    pi.registerTool(createSubagentStopTool(deps));
    return true;
}

export default registerSubagent;
