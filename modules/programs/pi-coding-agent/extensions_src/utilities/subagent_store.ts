import { randomUUID } from "node:crypto";
import { appendFile, chmod, link, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
    SUBAGENT_SCHEMA_VERSION,
    emptyUsage,
    isTerminalState,
    type NormalizedEvent,
    type ResolvedRun,
    type RunFailure,
    type RunLineage,
    type RunRequest,
    type RunResult,
    type RunSnapshot,
    type RunState,
    type RunStatus,
    type SubagentRuntimeConfig,
    type TmuxRunReference,
    type UsageClaim,
} from "./subagent_types.ts";

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANSITIONS: Record<RunState, readonly RunState[]> = {
    created: ["starting", "failed"], starting: ["running", "failed"], running: ["succeeded", "failed"], succeeded: [], failed: [],
};

export interface RunPaths {
    directory: string;
    request: string;
    resolved: string;
    status: string;
    events: string;
    stderr: string;
    result: string;
    usageClaim: string;
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
        request: join(directory, "request.json"), resolved: join(directory, "resolved.json"), status: join(directory, "status.json"),
        events: join(directory, "events.jsonl"), stderr: join(directory, "stderr.log"), result: join(directory, "result.json"),
        usageClaim: join(directory, "usage-claim.json"), launcher: join(directory, "launch.sh"),
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
    lineage: Omit<RunLineage, "targetProfile"> = {
        callerProfile: config.defaultProfile,
        depth: 1,
        originSessionId: process.env.PI_SESSION_ID ?? "standalone",
    },
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
    const fullLineage: RunLineage = { ...lineage, targetProfile: profile };
    const request: RunRequest = { schemaVersion: 2, runId, profile, prompt, cwd, createdAt, ...fullLineage };
    const resolved: ResolvedRun = {
        schemaVersion: 2, runId, profile, ...fullLineage,
        harness: "pi", model: profileConfig.model, thinkingLevel: profileConfig.thinkingLevel,
        allowAllTools: profileConfig.allowAllTools, tools: profileConfig.tools,
        allowedSubagents: profileConfig.allowedSubagents, instructions: profileConfig.instructions,
        command: config.harnesses.pi.command, extension: config.runner.extension,
    };
    const status: RunStatus = { schemaVersion: 2, runId, profile, status: "created", createdAt };
    const launcher = [
        "#!/bin/sh", "set -eu",
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
    if (status.schemaVersion !== 2 || !RUN_ID.test(status.runId)) throw new Error("Invalid run status file");
    return status;
}

export async function patchStatus(paths: RunPaths, patch: Partial<RunStatus>): Promise<RunStatus> {
    const current = await readStatus(paths);
    if (patch.runId !== undefined && patch.runId !== current.runId) throw new Error("Cannot change run ID");
    if (patch.status !== undefined && patch.status !== current.status && !TRANSITIONS[current.status].includes(patch.status)) {
        throw new Error(`Invalid run state transition: ${current.status} -> ${patch.status}`);
    }
    const next = { ...current, ...patch, schemaVersion: SUBAGENT_SCHEMA_VERSION, runId: current.runId, profile: current.profile };
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
    return patchStatus(paths, { status: result.outcome, finishedAt: result.finishedAt, error: result.error ?? undefined });
}

export async function failRun(paths: RunPaths, failure: RunFailure, startedAt?: string, usage = emptyUsage(), turns = 0): Promise<RunStatus> {
    const current = await readStatus(paths);
    if (isTerminalState(current.status)) return current;
    const finishedAt = new Date().toISOString();
    return finishRun(paths, {
        schemaVersion: 2, runId: current.runId, outcome: "failed", output: "", error: failure, usage, turns,
        startedAt: startedAt ?? current.startedAt ?? current.createdAt, finishedAt,
    });
}

async function readClaim(paths: RunPaths): Promise<UsageClaim | undefined> {
    try { return await readJson<UsageClaim>(paths.usageClaim); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

export async function assertRunOrigin(stateRoot: string, runId: string, originSessionId: string): Promise<RunRequest> {
    const paths = runPaths(stateRoot, runId);
    const request = await readJson<RunRequest>(paths.request);
    if (request.schemaVersion !== 2 || request.runId !== runId) throw new Error(`Invalid request metadata for run ${runId}`);
    if (request.originSessionId !== originSessionId) throw new Error(`Run ${runId} belongs to a different origin session`);
    return request;
}

export async function releaseRunUsageClaim(
    stateRoot: string,
    runId: string,
    originSessionId: string,
    toolCallId: string,
): Promise<boolean> {
    const path = runPaths(stateRoot, runId).usageClaim;
    let claim: UsageClaim;
    try { claim = await readJson<UsageClaim>(path); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
    if (claim.originSessionId !== originSessionId || claim.toolCallId !== toolCallId || claim.runId !== runId) return false;
    await unlink(path);
    return true;
}

export async function claimRunUsage(
    stateRoot: string,
    runId: string,
    originSessionId: string,
    toolCallId: string,
    toolName: UsageClaim["toolName"],
): Promise<{ claim: UsageClaim; created: boolean; result: RunResult }> {
    const paths = runPaths(stateRoot, runId);
    await assertRunOrigin(stateRoot, runId, originSessionId);
    const snapshot = await readSnapshot(stateRoot, runId);
    if (!snapshot.result || !isTerminalState(snapshot.status)) throw new Error(`Run ${runId} is not terminal`);
    const claim: UsageClaim = { schemaVersion: 1, originSessionId, toolCallId, toolName, runId, claimedAt: new Date().toISOString() };
    const temporaryClaim = `${paths.usageClaim}.${process.pid}.${randomUUID()}.tmp`;
    try {
        const handle = await open(temporaryClaim, "wx", 0o600);
        try {
            await handle.writeFile(`${JSON.stringify(claim, null, 2)}\n`, "utf8");
            await handle.sync();
        } finally { await handle.close(); }
        await link(temporaryClaim, paths.usageClaim);
        await unlink(temporaryClaim).catch(() => {});
        return { claim, created: true, result: snapshot.result };
    } catch (error) {
        await unlink(temporaryClaim).catch(() => {});
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        for (let attempt = 0; attempt < 20; attempt += 1) {
            try {
                const existing = await readClaim(paths);
                if (existing) return { claim: existing, created: false, result: snapshot.result };
            } catch (readError) {
                if (!(readError instanceof SyntaxError) || attempt === 19) throw readError;
            }
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        throw new Error(`Usage claim for ${runId} exists but cannot be read`);
    }
}

export async function readSnapshot(stateRoot: string, runId: string): Promise<RunSnapshot> {
    const paths = runPaths(stateRoot, runId);
    const status = await readStatus(paths);
    let result: RunResult | null = null;
    if (isTerminalState(status.status)) {
        result = await readJson<RunResult>(paths.result);
        if (result.schemaVersion !== 2 || result.runId !== runId || result.outcome !== status.status) {
            throw new Error(`Invalid terminal result for run ${runId}`);
        }
    }
    const claim = await readClaim(paths);
    return {
        schemaVersion: 2, runId, profile: status.profile, status: status.status,
        createdAt: status.createdAt, startedAt: status.startedAt, finishedAt: status.finishedAt, tmux: status.tmux,
        runDirectory: paths.directory, paths: { events: paths.events, stderr: paths.stderr, result: paths.result },
        accounting: { claimed: claim !== undefined, claim }, result,
    };
}
