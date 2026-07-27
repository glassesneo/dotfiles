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
import { Type } from "typebox";
import { boundedModelJson, snapshotDetails } from "./utilities/subagent_json.ts";
import {
    assertRunOrigin,
    attachTmux,
    claimRunUsage,
    createRun,
    failRun,
    patchStatus,
    readSnapshot,
    releaseRunUsageClaim,
    runPaths,
} from "./utilities/subagent_store.ts";
import { isTmuxPaneAlive, launchTmuxWindow, probeTmux, type CommandExecutor } from "./utilities/subagent_tmux.ts";
import {
    addUsage,
    emptyUsage,
    isTerminalState,
    validateRuntimeConfig,
    type AgentProfile,
    type RunSnapshot,
    type SubagentRuntimeConfig,
} from "./utilities/subagent_types.ts";

const DEFAULT_CONFIG_PATH = join(getAgentDir(), "agent-profiles.json");
const PROFILE_STATE = "agent-profile-state";

const startParameters = Type.Object({
    profile: Type.String({ minLength: 1, description: "Semantic subagent profile name" }),
    prompt: Type.String({ minLength: 1, description: "Task prompt delegated to the subagent" }),
});
const getParameters = Type.Object({ runId: Type.String({ description: "UUID returned by subagent_start" }) });
const waitParameters = Type.Object({
    runIds: Type.Array(Type.String({ description: "UUID returned by subagent_start" }), { minItems: 1, maxItems: 128, uniqueItems: true }),
    condition: StringEnum(["any", "all"] as const),
    timeoutSeconds: Type.Integer({ minimum: 1, maximum: 3600 }),
});

type WaitCondition = "any" | "all";
type WaitReason = "condition_met" | "timeout";

export interface SubagentWaitResult {
    schemaVersion: 2;
    condition: WaitCondition;
    reason: WaitReason;
    timeoutSeconds: number;
    startedAt: string;
    finishedAt: string;
    completedRunIds: string[];
    pendingRunIds: string[];
    runs: RunSnapshot[];
}

export interface SubagentDependencies {
    configPath: string;
    env: NodeJS.ProcessEnv;
    exec: CommandExecutor;
    activeProfile?: () => string | undefined;
    monotonicNow?: () => number;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export async function loadAgentProfileConfig(path: string, env: NodeJS.ProcessEnv = {}): Promise<SubagentRuntimeConfig> {
    let value: unknown;
    try { value = JSON.parse(await readFile(path, "utf8")); }
    catch (error) { throw new Error(`Cannot read agent profile config ${path}: ${error instanceof Error ? error.message : String(error)}`); }
    const config = validateRuntimeConfig(value);
    if (!env.PI_SUBAGENT_RESOLVED_PROFILE) return config;
    let override: { name?: unknown; profile?: unknown };
    try { override = JSON.parse(env.PI_SUBAGENT_RESOLVED_PROFILE) as { name?: unknown; profile?: unknown }; }
    catch { throw new Error("PI_SUBAGENT_RESOLVED_PROFILE is not valid JSON"); }
    if (typeof override.name !== "string" || !override.profile) throw new Error("PI_SUBAGENT_RESOLVED_PROFILE is invalid");
    return validateRuntimeConfig({ ...config, profiles: { ...config.profiles, [override.name]: override.profile } });
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

async function readReconciledSnapshot(deps: SubagentDependencies, stateRoot: string, runId: string): Promise<RunSnapshot> {
    const paths = runPaths(stateRoot, runId);
    let snapshot = await readSnapshot(stateRoot, runId);
    if (!isTerminalState(snapshot.status)) {
        const alive = snapshot.tmux ? await isTmuxPaneAlive(deps.exec, snapshot.tmux.paneId) : false;
        if (!alive) {
            await failRun(paths, { category: "runner_lost", message: "The tmux runner pane disappeared before the run reached a terminal state" });
            snapshot = await readSnapshot(stateRoot, runId);
        }
    }
    return snapshot;
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
    toolName: "subagent_start" | "subagent_get" | "subagent_wait",
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
    toolName: "subagent_start" | "subagent_get" | "subagent_wait",
): Promise<{ usage?: Usage; claimedRunIds: string[] }> {
    return claimUsageBatch(config.stateRoot, snapshots, origin(ctx, env).originSessionId, toolCallId, toolName);
}

function toolResult(snapshot: RunSnapshot, accounting: { usage?: Usage; claimedRunIds: string[] }) {
    return {
        content: [{ type: "text" as const, text: boundedModelJson(snapshot as unknown as Record<string, unknown>) }],
        details: { ...snapshotDetails(snapshot), accounting: { ...snapshot.accounting, claimedRunIds: accounting.claimedRunIds } },
        usage: accounting.usage,
    };
}

function waitToolResult(value: SubagentWaitResult, accounting: { usage?: Usage; claimedRunIds: string[] }) {
    return {
        content: [{ type: "text" as const, text: boundedModelJson(value as unknown as Record<string, unknown>) }],
        details: { ...value, runs: value.runs.map(snapshotDetails), accounting: { claimedRunIds: accounting.claimedRunIds } },
        usage: accounting.usage,
    };
}

export function createSubagentStartTool(deps: SubagentDependencies): ToolDefinition<typeof startParameters, ReturnType<typeof snapshotDetails>> {
    return defineTool({
        name: "subagent_start", label: "Start subagent",
        description: "Start one profiled subagent in a detached tmux window without waiting for completion. Returns a run ID for subagent_get or subagent_wait.",
        promptSnippet: "Start an asynchronous profiled subagent and return its run ID",
        promptGuidelines: ["Use subagent_start with only a semantic profile and a complete task prompt; continue useful independent work after it returns, then use subagent_wait when the delegated result is needed."],
        parameters: startParameters, executionMode: "sequential",
        async execute(toolCallId, params, _signal, _onUpdate, ctx) {
            const config = await loadAgentProfileConfig(deps.configPath, deps.env);
            const callerProfile = deps.activeProfile?.() ?? config.defaultProfile;
            const caller = config.profiles[callerProfile];
            if (!caller) throw new Error(`Unknown caller profile: ${callerProfile}`);
            if (!config.profiles[params.profile]) throw new Error(`Unknown subagent profile: ${params.profile}`);
            if (!caller.allowedSubagents.includes(params.profile)) {
                throw new Error(`Profile ${callerProfile} is not allowed to start subagent profile ${params.profile}`);
            }
            const current = origin(ctx, deps.env);
            const childDepth = current.depth + 1;
            if (childDepth > config.maxDepth) throw new Error(`Subagent depth ${childDepth} exceeds maxDepth ${config.maxDepth}`);
            const tmuxContext = await probeTmux(deps.exec, deps.env);
            if (!tmuxContext) throw new Error("The current Pi process is no longer attached to a usable tmux session");

            const run = await createRun(config, params.profile, params.prompt, ctx.cwd, {
                callerProfile, depth: childDepth, parentRunId: current.parentRunId,
                originSessionId: current.originSessionId, originSessionFile: current.originSessionFile,
            });
            await patchStatus(run.paths, { status: "starting" });
            try {
                const tmux = await launchTmuxWindow(deps.exec, tmuxContext, { runId: run.request.runId, cwd: ctx.cwd, launcher: run.paths.launcher });
                await attachTmux(run.paths, tmux);
            } catch (error) {
                await failRun(run.paths, { category: "launch", message: error instanceof Error ? error.message : String(error) });
            }
            const snapshot = await readSnapshot(config.stateRoot, run.request.runId);
            return toolResult(snapshot, await claimedUsage(config, [snapshot], ctx, deps.env, toolCallId, "subagent_start"));
        },
    });
}

export function createSubagentGetTool(deps: SubagentDependencies): ToolDefinition<typeof getParameters, ReturnType<typeof snapshotDetails>> {
    return defineTool({
        name: "subagent_get", label: "Get subagent run",
        description: "Read one subagent run's current persisted state without waiting. Use it for a non-blocking status check or to retrieve an already completed result. Full logs stay in the returned file paths.",
        promptSnippet: "Read one subagent run's current state once without waiting",
        promptGuidelines: ["Use subagent_get for a one-time non-blocking status check or to retrieve an already completed result."],
        parameters: getParameters, executionMode: "sequential",
        async execute(toolCallId, params, _signal, _onUpdate, ctx) {
            const config = await loadAgentProfileConfig(deps.configPath, deps.env);
            await assertRunOrigin(config.stateRoot, params.runId, origin(ctx, deps.env).originSessionId);
            const snapshot = await readReconciledSnapshot(deps, config.stateRoot, params.runId);
            return toolResult(snapshot, await claimedUsage(config, [snapshot], ctx, deps.env, toolCallId, "subagent_get"));
        },
    });
}

export function createSubagentWaitTool(deps: SubagentDependencies): ToolDefinition<typeof waitParameters, Omit<SubagentWaitResult, "runs"> & { runs: ReturnType<typeof snapshotDetails>[] }> {
    return defineTool({
        name: "subagent_wait", label: "Wait for subagents",
        description: "Wait until any or all specified subagent runs reach a terminal state (succeeded or failed), or until the timeout expires. Timeout is a normal result and includes every run's latest persisted state.",
        promptSnippet: "Wait for any or all selected subagent runs to reach a terminal state",
        promptGuidelines: ["Use subagent_wait on its own only when no useful independent work remains and one or more delegated results are needed; use subagent_get instead for a one-time non-blocking status check."],
        parameters: waitParameters, executionMode: "sequential",
        async execute(toolCallId, params, signal, _onUpdate, ctx) {
            throwIfAborted(signal);
            if (new Set(params.runIds).size !== params.runIds.length) throw new Error("subagent_wait runIds must not contain duplicates");
            const config = await loadAgentProfileConfig(deps.configPath, deps.env);
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
                for (const runId of params.runIds) { throwIfAborted(signal); runs.push(await readReconciledSnapshot(deps, config.stateRoot, runId)); }
                const completedRunIds = runs.filter(snapshot => isTerminalState(snapshot.status)).map(snapshot => snapshot.runId);
                const completed = new Set(completedRunIds);
                const pendingRunIds = params.runIds.filter(runId => !completed.has(runId));
                const conditionMet = params.condition === "any" ? completedRunIds.length > 0 : pendingRunIds.length === 0;
                const timedOut = monotonicNow() >= deadline;
                if (conditionMet || timedOut) {
                    const value: SubagentWaitResult = {
                        schemaVersion: 2, condition: params.condition, reason: conditionMet ? "condition_met" : "timeout",
                        timeoutSeconds: params.timeoutSeconds, startedAt, finishedAt: new Date().toISOString(),
                        completedRunIds, pendingRunIds, runs,
                    };
                    const accounting = await claimedUsage(config, runs, ctx, deps.env, toolCallId, "subagent_wait");
                    return waitToolResult(value, accounting);
                }
                await sleep(Math.min(1000, deadline - monotonicNow()), signal);
            }
        },
    });
}

function splitModelId(model: string): [string, string] {
    const separator = model.indexOf("/");
    if (separator <= 0 || separator === model.length - 1) throw new Error(`Profile model must include provider: ${model}`);
    return [model.slice(0, separator), model.slice(separator + 1)];
}

function latestProfile(ctx: ExtensionContext): string | undefined {
    const entry = [...ctx.sessionManager.getBranch()].reverse().find(item => item.type === "custom" && item.customType === PROFILE_STATE) as { data?: { name?: unknown } } | undefined;
    return typeof entry?.data?.name === "string" ? entry.data.name : undefined;
}

async function reconcileSessionAccounting(config: SubagentRuntimeConfig, ctx: ExtensionContext): Promise<void> {
    const sessionId = ctx.sessionManager.getSessionId();
    for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type !== "message" || entry.message.role !== "toolResult" || !entry.message.usage) continue;
        const toolName = entry.message.toolName;
        if (toolName !== "subagent_start" && toolName !== "subagent_get" && toolName !== "subagent_wait") continue;
        const details = entry.message.details as { accounting?: { claimedRunIds?: unknown } } | undefined;
        const runIds = details?.accounting?.claimedRunIds;
        if (!Array.isArray(runIds)) continue;
        for (const runId of runIds) {
            if (typeof runId !== "string") continue;
            await claimRunUsage(config.stateRoot, runId, sessionId, entry.message.toolCallId, toolName);
        }
    }
}

export function registerProfileController(
    pi: ExtensionAPI,
    configPath = DEFAULT_CONFIG_PATH,
    env: NodeJS.ProcessEnv = process.env,
): { activeProfile: () => string | undefined } {
    let config: SubagentRuntimeConfig | undefined;
    let activeName: string | undefined;
    let activeProfile: AgentProfile | undefined;

    const syncActiveTools = (profile: AgentProfile | undefined = activeProfile) => {
        if (!profile) return;
        const allTools = pi.getAllTools().map(tool => tool.name);
        pi.setActiveTools(profile.allowAllTools
            ? allTools
            : profile.tools.filter(tool => allTools.includes(tool)));
    };

    pi.registerFlag("profile", { description: "Agent capability profile", type: "string" });

    const apply = async (name: string, ctx: ExtensionContext, persist: boolean): Promise<boolean> => {
        if (!ctx.isIdle()) { ctx.ui.notify("Profile can only be changed while the agent is idle", "warning"); return false; }
        config ??= await loadAgentProfileConfig(configPath, env);
        const profile = config.profiles[name];
        if (!profile) { ctx.ui.notify(`Unknown profile ${name}. Available: ${Object.keys(config.profiles).join(", ")}`, "error"); return false; }
        const [provider, modelId] = splitModelId(profile.model);
        const model = ctx.modelRegistry.find(provider, modelId);
        if (!model) { ctx.ui.notify(`Profile ${name}: model ${profile.model} not found`, "error"); return false; }
        if (!await pi.setModel(model)) { ctx.ui.notify(`Profile ${name}: no authentication for ${profile.model}`, "error"); return false; }

        pi.setThinkingLevel(profile.thinkingLevel ?? "off");
        syncActiveTools(profile);
        activeName = name;
        activeProfile = profile;
        ctx.ui.setStatus("agent-profile", `profile:${name}`);
        if (persist) pi.appendEntry(PROFILE_STATE, { name });
        return true;
    };

    const choose = async (ctx: ExtensionContext) => {
        config ??= await loadAgentProfileConfig(configPath, env);
        if (!ctx.hasUI) { ctx.ui.notify(`Active profile: ${activeName ?? config.defaultProfile}`, "info"); return; }
        const selected = await ctx.ui.select("Agent profile", Object.keys(config.profiles));
        if (selected) await apply(selected, ctx, true);
    };

    pi.registerCommand("profile", {
        description: "Show or switch the active agent profile",
        getArgumentCompletions(prefix) {
            if (!config) return null;
            const items = Object.keys(config.profiles).filter(name => name.startsWith(prefix)).map(name => ({ value: name, label: name }));
            return items.length ? items : null;
        },
        async handler(args, ctx) {
            const name = args.trim();
            if (name) await apply(name, ctx, true); else await choose(ctx);
        },
    });

    pi.registerShortcut("shift+tab", {
        description: "Cycle agent profiles",
        async handler(ctx) {
            config ??= await loadAgentProfileConfig(configPath, env);
            const current = config.profileCycle.indexOf(activeName ?? config.defaultProfile);
            const next = config.profileCycle[(current + 1 + config.profileCycle.length) % config.profileCycle.length];
            if (next) await apply(next, ctx, true);
        },
    });

    pi.on("session_start", async (_event, ctx) => {
        config = await loadAgentProfileConfig(configPath, env);
        const flag = pi.getFlag("profile");
        const requested = typeof flag === "string" && flag.trim() ? flag.trim() : latestProfile(ctx) ?? config.defaultProfile;
        if (!await apply(requested, ctx, true) && requested !== config.defaultProfile) await apply(config.defaultProfile, ctx, true);
        try { await reconcileSessionAccounting(config, ctx); }
        catch (error) {
            ctx.ui.notify(`Could not reconcile subagent usage claims: ${error instanceof Error ? error.message : String(error)}`, "warning");
        }
    });
    pi.on("session_tree", async (_event, ctx) => {
        config ??= await loadAgentProfileConfig(configPath, env);
        await apply(latestProfile(ctx) ?? config.defaultProfile, ctx, false);
    });
    pi.on("input", async () => {
        syncActiveTools();
    });
    pi.on("before_agent_start", async event => {
        if (!activeProfile) return;
        syncActiveTools();
        if (activeProfile.instructions) return { systemPrompt: `${event.systemPrompt}\n\n${activeProfile.instructions}` };
    });
    pi.on("tool_call", event => {
        if (activeProfile && !activeProfile.allowAllTools && !activeProfile.tools.includes(event.toolName)) {
            return { block: true, reason: `Tool ${event.toolName} is not allowed by profile ${activeName}` };
        }
    });
    return { activeProfile: () => activeName };
}

export async function registerSubagent(
    pi: ExtensionAPI,
    options: Partial<Pick<SubagentDependencies, "configPath" | "env">> = {},
): Promise<boolean> {
    const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;
    const env = options.env ?? process.env;
    const controller = registerProfileController(pi, configPath, env);
    const exec: CommandExecutor = async (command, args) => {
        const output = await pi.exec(command, args);
        return { stdout: output.stdout, stderr: output.stderr, code: output.code };
    };
    const deps: SubagentDependencies = { configPath, env, exec, activeProfile: controller.activeProfile };
    if (!await probeTmux(exec, deps.env)) return false;
    pi.registerTool(createSubagentStartTool(deps));
    pi.registerTool(createSubagentGetTool(deps));
    pi.registerTool(createSubagentWaitTool(deps));
    return true;
}

export default registerSubagent;
