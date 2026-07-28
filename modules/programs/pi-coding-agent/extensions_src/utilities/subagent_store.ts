import { randomUUID } from "node:crypto";
import { appendFile, chmod, link, mkdir, open, readFile, readdir, rename, truncate, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentProfile } from "./profile_types.ts";
import { withRunLock } from "./subagent_lock.ts";
import { resolveHarnessAdapter } from "./subagent_harness.ts";
import {
    RESOLVED_RUN_SCHEMA_VERSION,
    RUN_REQUEST_SCHEMA_VERSION,
    emptyUsage,
    isTerminalState,
    normalizeRunRequest,
    validateRunPurpose,
    type NormalizedEvent,
    type NormalizedRunRequest,
    type ResolvedRun,
    type RunFailure,
    type RunLineage,
    type RunRequest,
    type RunResult,
    type RunSnapshot,
    type RunState,
    type RunStatus,
    type StopMethod,
    type SubagentRuntimeConfig,
    type TmuxRunReference,
    type UsageClaim,
} from "./subagent_types.ts";

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANSITIONS: Record<RunState, readonly RunState[]> = {
    created: ["starting", "stopping", "failed"],
    starting: ["running", "stopping", "failed"],
    running: ["stopping", "succeeded", "failed"],
    stopping: ["stopped"],
    succeeded: [], failed: [], stopped: [],
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
    workerHeartbeat: string;
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
        workerHeartbeat: join(directory, "worker-heartbeat.json"),
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
    profileConfig: AgentProfile,
    purpose: string,
    prompt: string,
    cwd: string,
    lineage: Omit<RunLineage, "targetProfile"> = {
        callerProfile: profile,
        depth: 1,
        originSessionId: process.env.PI_SESSION_ID ?? "standalone",
    },
): Promise<{ request: RunRequest; resolved: ResolvedRun; status: RunStatus; paths: RunPaths }> {
    if (prompt.trim() === "") throw new Error("Subagent prompt must not be empty");
    const normalizedPurpose = validateRunPurpose(purpose);
    const facet = profileConfig.extensions.subagent as { harness?: unknown } | undefined;
    const harness = typeof facet?.harness === "string" && facet.harness.trim() ? facet.harness : "pi";
    const adapter = resolveHarnessAdapter(harness);
    const harnessConfig = config.harnesses[harness];
    if (!harnessConfig) throw new Error(`Unknown or unconfigured subagent harness: ${harness}`);
    const runId = randomUUID();
    const paths = runPaths(config.stateRoot, runId);
    await mkdir(config.stateRoot, { recursive: true, mode: 0o700 });
    await mkdir(paths.directory, { mode: 0o700 });
    await chmod(paths.directory, 0o700);

    const createdAt = new Date().toISOString();
    const fullLineage: RunLineage = { ...lineage, targetProfile: profile };
    const request: RunRequest = { schemaVersion: RUN_REQUEST_SCHEMA_VERSION, runId, profile, purpose: normalizedPurpose, prompt, cwd, createdAt, harness, ...fullLineage };
    const resolved: ResolvedRun = {
        schemaVersion: RESOLVED_RUN_SCHEMA_VERSION, runId, profile, ...fullLineage,
        profileSnapshot: structuredClone(profileConfig), command: harnessConfig.command,
        extensionPaths: [...config.runner.extensions], harness,
        adapterProtocolVersion: adapter.protocolVersion, transcriptCapabilities: adapter.capabilities,
    };
    const status: RunStatus = { schemaVersion: 4, runId, profile, status: "created", createdAt, ...fullLineage };
    const launcher = [
        "#!/bin/sh", "set -eu",
        `exec ${shellQuote(config.runner.node)} --experimental-strip-types ${shellQuote(config.runner.script)} ${shellQuote(paths.directory)}`,
        "",
    ].join("\n");

    await atomicJson(paths.request, request);
    await atomicJson(paths.resolved, resolved);
    await writeFile(paths.events, "", { encoding: "utf8", mode: 0o600 });
    await appendSequencedEvent(paths, "parent_instruction", { prompt, callerProfile: fullLineage.callerProfile });
    await writeFile(paths.stderr, "", { encoding: "utf8", mode: 0o600 });
    await writeFile(paths.launcher, launcher, { encoding: "utf8", mode: 0o700 });
    await chmod(paths.launcher, 0o700);
    // status.json is the durable queue publication point; publish it only after
    // the canonical instruction and every immutable run input are complete.
    await atomicJson(paths.status, status);
    return { request, resolved, status, paths };
}

export async function readStatus(paths: RunPaths): Promise<RunStatus> {
    const status = await readJson<RunStatus>(paths.status);
    if ((status.schemaVersion !== 2 && status.schemaVersion !== 3 && status.schemaVersion !== 4) || !RUN_ID.test(status.runId)
        || !Object.hasOwn(TRANSITIONS, status.status)) throw new Error("Invalid run status file");
    const rawState: string = status.status;
    if (status.schemaVersion === 2 && (rawState === "stopping" || rawState === "stopped")) {
        throw new Error("Legacy run status cannot represent stopping or stopped");
    }
    return status;
}

async function patchStatusUnlocked(paths: RunPaths, patch: Partial<RunStatus>): Promise<RunStatus> {
    const current = await readStatus(paths);
    if (patch.runId !== undefined && patch.runId !== current.runId) throw new Error("Cannot change run ID");
    if (current.schemaVersion === 3 || current.schemaVersion === 4) {
        const immutable = ["callerProfile", "targetProfile", "depth", "parentRunId", "originSessionId", "originSessionFile"] as const;
        const patchRecord = patch as Record<string, unknown>;
        const changed = immutable.find(key => key in patchRecord && patchRecord[key] !== current[key]);
        if (changed) throw new Error(`Cannot change run lineage field ${changed}`);
    }
    if (patch.status !== undefined && patch.status !== current.status && !TRANSITIONS[current.status].includes(patch.status)) {
        throw new Error(`Invalid run state transition: ${current.status} -> ${patch.status}`);
    }
    const next = { ...current, ...patch, schemaVersion: current.schemaVersion, runId: current.runId, profile: current.profile } as RunStatus;
    await atomicJson(paths.status, next);
    return next;
}

export async function patchStatus(paths: RunPaths, patch: Partial<RunStatus>): Promise<RunStatus> {
    return withRunLock(paths.directory, () => patchStatusUnlocked(paths, patch));
}

export async function claimRunAndLaunchWorker(
    paths: RunPaths,
    claim: NonNullable<RunStatus["claim"]>,
    pendingWorker: NonNullable<RunStatus["worker"]>,
    expectedClaimToken: string | undefined,
    launch: () => NonNullable<RunStatus["worker"]>,
): Promise<RunStatus | null> {
    return withRunLock(paths.directory, async () => {
        const current = await readStatus(paths);
        if (current.schemaVersion !== 4 || isTerminalState(current.status) || current.status === "stopping") return null;
        if (current.status === "created") {
            if (expectedClaimToken !== undefined) return null;
            await patchStatusUnlocked(paths, { status: "starting", claim, worker: pendingWorker });
        } else {
            if (current.status !== "starting" || expectedClaimToken === undefined || current.claim?.token !== expectedClaimToken) return null;
            await patchStatusUnlocked(paths, { claim, worker: pendingWorker });
        }
        // Keep the run lock through spawn and PID publication. A concurrent
        // stop either wins before this claim or observes a fully launched worker.
        return patchStatusUnlocked(paths, { worker: launch() });
    });
}

export async function attachTmux(paths: RunPaths, tmux: TmuxRunReference): Promise<RunStatus> {
    return patchStatus(paths, { tmux });
}

export async function readEvents(paths: RunPaths): Promise<NormalizedEvent[]> {
    const content = await readFile(paths.events, "utf8").catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? "" : Promise.reject(error));
    const lines = content.split("\n");
    const events: NormalizedEvent[] = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;
        if (!line) continue;
        try { events.push(JSON.parse(line) as NormalizedEvent); }
        catch {
            if (index === lines.length - 1 && !content.endsWith("\n")) break;
            events.push({ schemaVersion: 4, sequence: events.reduce((n, e) => Math.max(n, e.sequence), 0) + 1, timestamp: new Date().toISOString(), type: "diagnostic", data: { category: "transcript", message: `Malformed persisted event at line ${index + 1}` } });
        }
    }
    return events;
}

async function repairEventTail(paths: RunPaths): Promise<NormalizedEvent[]> {
    const content = await readFile(paths.events, "utf8").catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? "" : Promise.reject(error));
    if (content && !content.endsWith("\n")) {
        const boundary = content.lastIndexOf("\n") + 1;
        await truncate(paths.events, boundary);
    }
    return readEvents(paths);
}

export async function appendSequencedEvent(paths: RunPaths, type: NormalizedEvent["type"], data: Record<string, unknown>, options: { uniqueTerminal?: boolean } = {}): Promise<NormalizedEvent | null> {
    return withRunLock(paths.directory, async () => {
        const events = await repairEventTail(paths);
        if (options.uniqueTerminal && events.some(event => event.type === "run_finished")) return null;
        const event: NormalizedEvent = { schemaVersion: 4, sequence: events.reduce((maximum, existing) => Math.max(maximum, existing.sequence), 0) + 1, timestamp: new Date().toISOString(), type, data };
        const handle = await open(paths.events, "a", 0o600);
        try { await handle.write(`${JSON.stringify(event)}\n`, undefined, "utf8"); await handle.sync(); } finally { await handle.close(); }
        await chmod(paths.events, 0o600);
        return event;
    });
}

export async function appendEvent(paths: RunPaths, event: NormalizedEvent): Promise<void> { await appendSequencedEvent(paths, event.type, event.data); }
export async function appendTerminalEvent(paths: RunPaths, event: NormalizedEvent): Promise<boolean> { return (await appendSequencedEvent(paths, event.type, event.data, { uniqueTerminal: true })) !== null; }

export async function appendStderr(paths: RunPaths, text: string): Promise<void> {
    await appendFile(paths.stderr, text, { encoding: "utf8", mode: 0o600 });
}

async function finishRunUnlocked(paths: RunPaths, result: RunResult): Promise<RunStatus> {
    const current = await readStatus(paths);
    if (isTerminalState(current.status)) return current;
    if (current.status === "stopping" && result.outcome !== "stopped") return current;
    if (!TRANSITIONS[current.status].includes(result.outcome)) throw new Error(`Invalid run state transition: ${current.status} -> ${result.outcome}`);
    await atomicJson(paths.result, result);
    return patchStatusUnlocked(paths, { status: result.outcome, finishedAt: result.finishedAt, error: result.error ?? undefined });
}

export async function finishRun(paths: RunPaths, result: RunResult): Promise<RunStatus> {
    if (!isTerminalState(result.outcome)) throw new Error("Result outcome must be terminal");
    return withRunLock(paths.directory, () => finishRunUnlocked(paths, result));
}

export async function failRun(paths: RunPaths, failure: RunFailure, startedAt?: string, usage = emptyUsage(), turns = 0): Promise<RunStatus> {
    return withRunLock(paths.directory, async () => {
        const current = await readStatus(paths);
        if (isTerminalState(current.status) || current.status === "stopping") return current;
        const finishedAt = new Date().toISOString();
        return finishRunUnlocked(paths, {
            schemaVersion: current.schemaVersion === 4 ? 4 : 3, runId: current.runId, outcome: "failed", output: "", error: failure, usage, turns,
            startedAt: startedAt ?? current.startedAt ?? current.createdAt, finishedAt,
        });
    });
}

export async function markRunRunning(paths: RunPaths, startedAt: string, runnerPid: number, workerToken?: string): Promise<RunStatus> {
    return withRunLock(paths.directory, async () => {
        const current = await readStatus(paths);
        if (current.status === "stopping" || isTerminalState(current.status)) return current;
        if (current.schemaVersion === 4 && (workerToken === undefined || current.worker?.token !== workerToken || current.worker.pid !== runnerPid)) {
            throw new Error(`Worker identity mismatch for run ${current.runId}`);
        }
        return patchStatusUnlocked(paths, { status: "running", startedAt, runnerPid });
    });
}

export async function requestRunStop(paths: RunPaths): Promise<RunStatus> {
    return withRunLock(paths.directory, async () => {
        const current = await readStatus(paths);
        if (isTerminalState(current.status) || current.status === "stopping") return current;
        if (current.schemaVersion === 2) throw new Error(`Run ${current.runId} uses legacy live status schema v2 and cannot be stopped safely`);
        return patchStatusUnlocked(paths, { status: "stopping", stopRequestedAt: new Date().toISOString() });
    });
}

export async function finishStoppedRun(
    paths: RunPaths,
    method: StopMethod,
    usage = emptyUsage(),
    turns = 0,
    output = "",
    startedAt?: string,
): Promise<RunStatus> {
    return withRunLock(paths.directory, async () => {
        const current = await readStatus(paths);
        if (isTerminalState(current.status)) return current;
        if (current.status !== "stopping") throw new Error(`Run ${current.runId} is not stopping`);
        const finishedAt = new Date().toISOString();
        return finishRunUnlocked(paths, {
            schemaVersion: current.schemaVersion === 4 ? 4 : 3, runId: current.runId, outcome: "stopped", output, error: null, usage, turns,
            startedAt: startedAt ?? current.startedAt ?? current.createdAt, finishedAt, stopMethod: method,
        });
    });
}

async function readClaim(paths: RunPaths): Promise<UsageClaim | undefined> {
    try { return await readJson<UsageClaim>(paths.usageClaim); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

export async function readRunRequest(paths: RunPaths): Promise<NormalizedRunRequest> {
    const request = normalizeRunRequest(await readJson<RunRequest>(paths.request));
    if (!RUN_ID.test(request.runId)) throw new Error("Invalid run request file");
    return request;
}

export async function assertRunOrigin(stateRoot: string, runId: string, originSessionId: string): Promise<NormalizedRunRequest> {
    const paths = runPaths(stateRoot, runId);
    const request = await readRunRequest(paths);
    if (request.runId !== runId) throw new Error(`Invalid request metadata for run ${runId}`);
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

function assertLineage(request: NormalizedRunRequest, resolved: ResolvedRun, status: RunStatus, runId: string): void {
    const pairs: Array<[string, unknown, unknown]> = [
        ["runId", request.runId, resolved.runId], ["profile", request.profile, resolved.profile],
        ["targetProfile", request.targetProfile, resolved.targetProfile], ["callerProfile", request.callerProfile, resolved.callerProfile],
        ["depth", request.depth, resolved.depth], ["parentRunId", request.parentRunId, resolved.parentRunId],
        ["originSessionId", request.originSessionId, resolved.originSessionId],
    ];
    const mismatch = pairs.find(([, left, right]) => left !== right);
    const statusMismatch = status.schemaVersion === 3 || status.schemaVersion === 4
        ? pairs.find(([key, requestValue]) => key !== "runId" && key !== "profile" && requestValue !== status[key as keyof RunStatus])
        : undefined;
    const canonicalMismatch = request.profile !== request.targetProfile || resolved.profile !== resolved.targetProfile
        || status.profile !== request.targetProfile;
    if (request.runId !== runId || status.runId !== runId || status.profile !== request.profile || mismatch || statusMismatch || canonicalMismatch) {
        const field = mismatch?.[0] ?? statusMismatch?.[0] ?? (canonicalMismatch ? "targetProfile" : undefined);
        throw new Error(`Request, resolved, and status metadata disagree for run ${runId}${field ? ` (${field})` : ""}`);
    }
}

export async function readSnapshot(stateRoot: string, runId: string): Promise<RunSnapshot> {
    const paths = runPaths(stateRoot, runId);
    const [status, request, resolved] = await Promise.all([
        readStatus(paths), readRunRequest(paths), readJson<ResolvedRun>(paths.resolved),
    ]);
    if (resolved.schemaVersion !== 3 && resolved.schemaVersion !== RESOLVED_RUN_SCHEMA_VERSION) throw new Error(`Invalid resolved metadata for run ${runId}`);
    assertLineage(request, resolved, status, runId);
    let result: RunResult | null = null;
    if (isTerminalState(status.status)) {
        result = await readJson<RunResult>(paths.result);
        const validSchema = result.schemaVersion === 2
            ? result.outcome === "succeeded" || result.outcome === "failed"
            : result.schemaVersion === 3 || result.schemaVersion === 4;
        if (!validSchema || result.runId !== runId || result.outcome !== status.status) {
            throw new Error(`Invalid terminal result for run ${runId}`);
        }
    }
    const claim = await readClaim(paths);
    return {
        schemaVersion: 4, runId, purpose: request.purpose, profile: status.profile, status: status.status,
        createdAt: status.createdAt, startedAt: status.startedAt, finishedAt: status.finishedAt, tmux: status.tmux,
        claim: status.claim, worker: status.worker,
        runDirectory: paths.directory, paths: { events: paths.events, stderr: paths.stderr, result: paths.result, workerHeartbeat: paths.workerHeartbeat },
        accounting: { claimed: claim !== undefined, claim }, result,
    };
}

export async function immediateChildRequests(stateRoot: string, parent: NormalizedRunRequest): Promise<NormalizedRunRequest[]> {
    let entries: string[];
    try { entries = await readdir(stateRoot); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }
    const children: NormalizedRunRequest[] = [];
    for (const runId of entries) {
        if (!RUN_ID.test(runId)) continue;
        try {
            const request = await readRunRequest(runPaths(stateRoot, runId));
            if (request.originSessionId === parent.originSessionId && request.parentRunId === parent.runId) children.push(request);
        } catch { /* Ignore unrelated incomplete or malformed run directories. */ }
    }
    return children.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.runId.localeCompare(right.runId));
}
