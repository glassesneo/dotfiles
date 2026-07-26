import { randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
    SUBAGENT_SCHEMA_VERSION,
    isTerminalState,
    type NormalizedEvent,
    type ResolvedRun,
    type RunFailure,
    type RunRequest,
    type RunResult,
    type RunSnapshot,
    type RunState,
    type RunStatus,
    type SubagentRuntimeConfig,
    type TmuxRunReference,
} from "./subagent_types.ts";

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANSITIONS: Record<RunState, readonly RunState[]> = {
    created: ["starting", "failed"],
    starting: ["running", "failed"],
    running: ["succeeded", "failed"],
    succeeded: [],
    failed: [],
};

export interface RunPaths {
    directory: string;
    request: string;
    resolved: string;
    status: string;
    events: string;
    stderr: string;
    result: string;
    launcher: string;
}

export function assertRunId(runId: string): void {
    if (!RUN_ID.test(runId)) throw new Error(`Invalid subagent run ID: ${runId}`);
}

export function runPaths(stateRoot: string, runId: string): RunPaths {
    assertRunId(runId);
    const directory = join(stateRoot, runId);
    return {
        directory,
        request: join(directory, "request.json"),
        resolved: join(directory, "resolved.json"),
        status: join(directory, "status.json"),
        events: join(directory, "events.jsonl"),
        stderr: join(directory, "stderr.log"),
        result: join(directory, "result.json"),
        launcher: join(directory, "launch.sh"),
    };
}

async function atomicJson(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
    await chmod(path, 0o600);
}

export async function readJson<T>(path: string): Promise<T> {
    return JSON.parse(await readFile(path, "utf8")) as T;
}

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export async function createRun(
    config: SubagentRuntimeConfig,
    profile: string,
    prompt: string,
    cwd: string,
): Promise<{ request: RunRequest; resolved: ResolvedRun; status: RunStatus; paths: RunPaths }> {
    if (prompt.trim() === "") throw new Error("Subagent prompt must not be empty");
    const profileConfig = config.profiles[profile];
    if (!profileConfig) throw new Error(`Unknown subagent profile: ${profile}`);
    const runId = randomUUID();
    const paths = runPaths(config.stateRoot, runId);
    await mkdir(config.stateRoot, { recursive: true, mode: 0o700 });
    await mkdir(paths.directory, { mode: 0o700 });
    await chmod(paths.directory, 0o700);

    const createdAt = new Date().toISOString();
    const request: RunRequest = { schemaVersion: SUBAGENT_SCHEMA_VERSION, runId, profile, prompt, cwd, createdAt };
    const resolved: ResolvedRun = {
        schemaVersion: 1,
        runId,
        profile,
        harness: "pi",
        model: profileConfig.model,
        thinkingLevel: profileConfig.thinkingLevel,
        tools: profileConfig.tools,
        command: config.harnesses.pi.command,
    };
    const status: RunStatus = { schemaVersion: 1, runId, profile, status: "created", createdAt };
    const launcher = [
        "#!/bin/sh",
        "set -eu",
        `exec ${shellQuote(config.runner.node)} --experimental-strip-types ${shellQuote(config.runner.script)} ${shellQuote(paths.directory)}`,
        "",
    ].join("\n");

    await atomicJson(paths.request, request);
    await atomicJson(paths.resolved, resolved);
    await atomicJson(paths.status, status);
    await writeFile(paths.events, "", { encoding: "utf8", mode: 0o600 });
    await writeFile(paths.stderr, "", { encoding: "utf8", mode: 0o600 });
    await writeFile(paths.launcher, launcher, { encoding: "utf8", mode: 0o700 });
    await chmod(paths.launcher, 0o700);
    return { request, resolved, status, paths };
}

export async function readStatus(paths: RunPaths): Promise<RunStatus> {
    const status = await readJson<RunStatus>(paths.status);
    if (status.schemaVersion !== 1 || !RUN_ID.test(status.runId)) throw new Error("Invalid run status file");
    return status;
}

export async function patchStatus(paths: RunPaths, patch: Partial<RunStatus>): Promise<RunStatus> {
    const current = await readStatus(paths);
    if (patch.runId !== undefined && patch.runId !== current.runId) throw new Error("Cannot change run ID");
    if (patch.status !== undefined && patch.status !== current.status) {
        if (!TRANSITIONS[current.status].includes(patch.status)) {
            throw new Error(`Invalid run state transition: ${current.status} -> ${patch.status}`);
        }
    }
    const next = { ...current, ...patch, schemaVersion: 1 as const, runId: current.runId, profile: current.profile };
    await atomicJson(paths.status, next);
    return next;
}

export async function attachTmux(paths: RunPaths, tmux: TmuxRunReference): Promise<RunStatus> {
    return patchStatus(paths, { tmux });
}

export async function appendEvent(paths: RunPaths, event: NormalizedEvent): Promise<void> {
    await appendFile(paths.events, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function appendStderr(paths: RunPaths, text: string): Promise<void> {
    await appendFile(paths.stderr, text, { encoding: "utf8", mode: 0o600 });
}

export async function finishRun(paths: RunPaths, result: RunResult): Promise<RunStatus> {
    if (!isTerminalState(result.outcome)) throw new Error("Result outcome must be terminal");
    await atomicJson(paths.result, result);
    return patchStatus(paths, {
        status: result.outcome,
        finishedAt: result.finishedAt,
        error: result.error ?? undefined,
    });
}

export async function failRun(
    paths: RunPaths,
    failure: RunFailure,
    startedAt?: string,
): Promise<RunStatus> {
    const current = await readStatus(paths);
    if (isTerminalState(current.status)) return current;
    const finishedAt = new Date().toISOString();
    const result: RunResult = {
        schemaVersion: 1,
        runId: current.runId,
        outcome: "failed",
        output: "",
        error: failure,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, turns: 0 },
        startedAt: startedAt ?? current.startedAt ?? current.createdAt,
        finishedAt,
    };
    return finishRun(paths, result);
}

export async function readSnapshot(stateRoot: string, runId: string): Promise<RunSnapshot> {
    const paths = runPaths(stateRoot, runId);
    const status = await readStatus(paths);
    let result: RunResult | null = null;
    if (isTerminalState(status.status)) result = await readJson<RunResult>(paths.result);
    return {
        schemaVersion: 1,
        runId,
        profile: status.profile,
        status: status.status,
        createdAt: status.createdAt,
        startedAt: status.startedAt,
        finishedAt: status.finishedAt,
        tmux: status.tmux,
        runDirectory: paths.directory,
        paths: { events: paths.events, stderr: paths.stderr },
        result,
    };
}
