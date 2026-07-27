import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
    defineTool,
    getAgentDir,
    truncateHead,
    type ExtensionAPI,
    type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
    attachTmux,
    createRun,
    failRun,
    patchStatus,
    readSnapshot,
    runPaths,
} from "./utilities/subagent_store.ts";
import {
    isTmuxPaneAlive,
    launchTmuxWindow,
    probeTmux,
    type CommandExecutor,
} from "./utilities/subagent_tmux.ts";
import {
    isTerminalState,
    validateRuntimeConfig,
    type RunSnapshot,
    type SubagentRuntimeConfig,
} from "./utilities/subagent_types.ts";

const DEFAULT_CONFIG_PATH = join(getAgentDir(), "subagent-profiles.json");

const startParameters = Type.Object({
    profile: Type.String({ minLength: 1, description: "Semantic subagent profile name" }),
    prompt: Type.String({ minLength: 1, description: "Task prompt delegated to the subagent" }),
});

const getParameters = Type.Object({
    runId: Type.String({ description: "UUID returned by subagent_start" }),
});

const waitParameters = Type.Object({
    runIds: Type.Array(
        Type.String({ description: "UUID returned by subagent_start" }),
        { minItems: 1, uniqueItems: true },
    ),
    condition: StringEnum(["any", "all"] as const),
    timeoutSeconds: Type.Integer({ minimum: 1, maximum: 3600 }),
});

type WaitCondition = "any" | "all";
type WaitReason = "condition_met" | "timeout";

export interface SubagentWaitResult {
    schemaVersion: 1;
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
    monotonicNow?: () => number;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

async function loadConfig(path: string): Promise<SubagentRuntimeConfig> {
    let value: unknown;
    try {
        value = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
        throw new Error(`Cannot read subagent profile config ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return validateRuntimeConfig(value);
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    if (signal.reason instanceof Error) throw signal.reason;
    throw new Error("Subagent wait cancelled");
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, milliseconds);
        const onAbort = () => {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", onAbort);
            reject(signal?.reason instanceof Error ? signal.reason : new Error("Subagent wait cancelled"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

async function readReconciledSnapshot(
    deps: SubagentDependencies,
    stateRoot: string,
    runId: string,
): Promise<RunSnapshot> {
    const paths = runPaths(stateRoot, runId);
    let snapshot = await readSnapshot(stateRoot, runId);
    if (!isTerminalState(snapshot.status)) {
        const alive = snapshot.tmux ? await isTmuxPaneAlive(deps.exec, snapshot.tmux.paneId) : false;
        if (!alive) {
            await failRun(paths, {
                category: "runner_lost",
                message: "The tmux runner pane disappeared before the run reached a terminal state",
            });
            snapshot = await readSnapshot(stateRoot, runId);
        }
    }
    return snapshot;
}

function result(snapshot: RunSnapshot) {
    let modelSnapshot = snapshot;
    if (snapshot.result) {
        const output = truncateHead(snapshot.result.output, { maxBytes: 40 * 1024, maxLines: 1500 });
        if (output.truncated) {
            modelSnapshot = {
                ...snapshot,
                result: {
                    ...snapshot.result,
                    output: `${output.content}\n\n[Output truncated for model context. Full result: ${join(snapshot.runDirectory, "result.json")}]`,
                },
            };
        }
    }
    return {
        content: [{ type: "text" as const, text: JSON.stringify(modelSnapshot) }],
        details: snapshot,
    };
}

function waitResult(value: SubagentWaitResult) {
    const outputRuns = value.runs.filter(snapshot => snapshot.result?.output);
    const outputBudget = outputRuns.length === 0 ? 0 : Math.floor((40 * 1024) / outputRuns.length);
    let modelValue: SubagentWaitResult = {
        ...value,
        runs: value.runs.map(snapshot => {
            if (!snapshot.result?.output) return snapshot;
            const output = truncateHead(snapshot.result.output, {
                maxBytes: Math.max(256, outputBudget),
                maxLines: 1500,
            });
            if (!output.truncated) return snapshot;
            return {
                ...snapshot,
                result: {
                    ...snapshot.result,
                    output: `${output.content}\n\n[Output truncated for model context. Full result: ${join(snapshot.runDirectory, "result.json")}]`,
                },
            };
        }),
    };

    let text = JSON.stringify(modelValue);
    if (Buffer.byteLength(text, "utf8") > 50 * 1024) {
        modelValue = {
            ...value,
            runs: value.runs.map(snapshot => snapshot.result?.output
                ? {
                    ...snapshot,
                    result: {
                        ...snapshot.result,
                        output: `[Output omitted to keep the aggregate response within 50KB. Full result: ${join(snapshot.runDirectory, "result.json")}]`,
                    },
                }
                : snapshot),
        };
        text = JSON.stringify(modelValue);
    }
    if (Buffer.byteLength(text, "utf8") > 50 * 1024) {
        throw new Error("Subagent wait response metadata exceeds the 50KB tool output limit");
    }
    return {
        content: [{ type: "text" as const, text }],
        details: value,
    };
}

export function createSubagentStartTool(deps: SubagentDependencies): ToolDefinition<typeof startParameters, RunSnapshot> {
    return defineTool({
        name: "subagent_start",
        label: "Start subagent",
        description: "Start one profiled subagent in a detached tmux window without waiting for completion. Returns a run ID for subagent_get or subagent_wait.",
        promptSnippet: "Start an asynchronous profiled subagent and return its run ID",
        promptGuidelines: [
            "Use subagent_start with only a semantic profile and a complete task prompt; continue useful independent work after it returns, then use subagent_wait when the delegated result is needed.",
        ],
        parameters: startParameters,
        executionMode: "sequential",
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const config = await loadConfig(deps.configPath);
            if (!config.profiles[params.profile]) throw new Error(`Unknown subagent profile: ${params.profile}`);
            const tmuxContext = await probeTmux(deps.exec, deps.env);
            if (!tmuxContext) throw new Error("The current Pi process is no longer attached to a usable tmux session");

            const run = await createRun(config, params.profile, params.prompt, ctx.cwd);
            await patchStatus(run.paths, { status: "starting" });
            try {
                const tmux = await launchTmuxWindow(deps.exec, tmuxContext, {
                    runId: run.request.runId,
                    cwd: ctx.cwd,
                    launcher: run.paths.launcher,
                });
                await attachTmux(run.paths, tmux);
            } catch (error) {
                await failRun(run.paths, {
                    category: "launch",
                    message: error instanceof Error ? error.message : String(error),
                });
            }
            return result(await readSnapshot(config.stateRoot, run.request.runId));
        },
    });
}

export function createSubagentGetTool(deps: SubagentDependencies): ToolDefinition<typeof getParameters, RunSnapshot> {
    return defineTool({
        name: "subagent_get",
        label: "Get subagent run",
        description: "Read one subagent run's current persisted state without waiting. Use it for a non-blocking status check or to retrieve an already completed result. Full logs stay in the returned file paths.",
        promptSnippet: "Read one subagent run's current state once without waiting",
        promptGuidelines: [
            "Use subagent_get for a one-time non-blocking status check or to retrieve an already completed result.",
        ],
        parameters: getParameters,
        executionMode: "sequential",
        async execute(_toolCallId, params) {
            const config = await loadConfig(deps.configPath);
            return result(await readReconciledSnapshot(deps, config.stateRoot, params.runId));
        },
    });
}

export function createSubagentWaitTool(
    deps: SubagentDependencies,
): ToolDefinition<typeof waitParameters, SubagentWaitResult> {
    return defineTool({
        name: "subagent_wait",
        label: "Wait for subagents",
        description: "Wait until any or all specified subagent runs reach a terminal state (succeeded or failed), or until the timeout expires. Timeout is a normal result and includes every run's latest persisted state.",
        promptSnippet: "Wait for any or all selected subagent runs to reach a terminal state",
        promptGuidelines: [
            "Use subagent_wait on its own only when no useful independent work remains and one or more delegated results are needed; use subagent_get instead for a one-time non-blocking status check.",
        ],
        parameters: waitParameters,
        executionMode: "sequential",
        async execute(_toolCallId, params, signal) {
            throwIfAborted(signal);
            if (new Set(params.runIds).size !== params.runIds.length) {
                throw new Error("subagent_wait runIds must not contain duplicates");
            }

            const config = await loadConfig(deps.configPath);
            for (const runId of params.runIds) {
                throwIfAborted(signal);
                await readSnapshot(config.stateRoot, runId);
            }

            const monotonicNow = deps.monotonicNow ?? (() => performance.now());
            const sleep = deps.sleep ?? abortableSleep;
            const startedAt = new Date().toISOString();
            const deadline = monotonicNow() + params.timeoutSeconds * 1000;

            while (true) {
                throwIfAborted(signal);
                const runs: RunSnapshot[] = [];
                for (const runId of params.runIds) {
                    throwIfAborted(signal);
                    runs.push(await readReconciledSnapshot(deps, config.stateRoot, runId));
                }
                throwIfAborted(signal);
                const completedRunIds = runs
                    .filter(snapshot => isTerminalState(snapshot.status))
                    .map(snapshot => snapshot.runId);
                const completed = new Set(completedRunIds);
                const pendingRunIds = params.runIds.filter(runId => !completed.has(runId));
                const conditionMet = params.condition === "any"
                    ? completedRunIds.length > 0
                    : pendingRunIds.length === 0;
                const timedOut = monotonicNow() >= deadline;

                if (conditionMet || timedOut) {
                    return waitResult({
                        schemaVersion: 1,
                        condition: params.condition,
                        reason: conditionMet ? "condition_met" : "timeout",
                        timeoutSeconds: params.timeoutSeconds,
                        startedAt,
                        finishedAt: new Date().toISOString(),
                        completedRunIds,
                        pendingRunIds,
                        runs,
                    });
                }

                await sleep(Math.min(1000, deadline - monotonicNow()), signal);
            }
        },
    });
}

export async function registerSubagent(
    pi: ExtensionAPI,
    options: Partial<Pick<SubagentDependencies, "configPath" | "env">> = {},
): Promise<boolean> {
    const exec: CommandExecutor = async (command, args) => {
        const output = await pi.exec(command, args);
        return { stdout: output.stdout, stderr: output.stderr, code: output.code };
    };
    const deps: SubagentDependencies = {
        configPath: options.configPath ?? DEFAULT_CONFIG_PATH,
        env: options.env ?? process.env,
        exec,
    };
    if (!await probeTmux(exec, deps.env)) return false;
    pi.registerTool(createSubagentStartTool(deps));
    pi.registerTool(createSubagentGetTool(deps));
    pi.registerTool(createSubagentWaitTool(deps));
    return true;
}

export default registerSubagent;
