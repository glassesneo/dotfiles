import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

export interface SubagentDependencies {
    configPath: string;
    env: NodeJS.ProcessEnv;
    exec: CommandExecutor;
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

export function createSubagentStartTool(deps: SubagentDependencies): ToolDefinition<typeof startParameters, RunSnapshot> {
    return defineTool({
        name: "subagent_start",
        label: "Start subagent",
        description: "Start one profiled subagent in a detached tmux window without waiting for completion. Returns a run ID for subagent_get.",
        promptSnippet: "Start an asynchronous profiled subagent and return its run ID",
        promptGuidelines: [
            "Use subagent_start with only a semantic profile and a complete task prompt; continue other work after it returns instead of waiting in the tool call.",
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
        description: "Get a subagent run's persisted state and normalized final result. Full logs stay in the returned file paths.",
        promptSnippet: "Read persisted status and final result for a subagent run ID",
        parameters: getParameters,
        executionMode: "sequential",
        async execute(_toolCallId, params) {
            const config = await loadConfig(deps.configPath);
            const paths = runPaths(config.stateRoot, params.runId);
            let snapshot = await readSnapshot(config.stateRoot, params.runId);
            if (!isTerminalState(snapshot.status)) {
                const alive = snapshot.tmux ? await isTmuxPaneAlive(deps.exec, snapshot.tmux.paneId) : false;
                if (!alive) {
                    await failRun(paths, {
                        category: "runner_lost",
                        message: "The tmux runner pane disappeared before the run reached a terminal state",
                    });
                    snapshot = await readSnapshot(config.stateRoot, params.runId);
                }
            }
            return result(snapshot);
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
    return true;
}

export default registerSubagent;
