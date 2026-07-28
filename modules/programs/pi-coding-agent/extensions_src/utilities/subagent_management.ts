import { readdir } from "node:fs/promises";
import {
    assertRunOrigin, failRun, finishStoppedRun, immediateChildRequests, readJson, readRunRequest, readSnapshot,
    readStatus, requestRunStop, runPaths,
} from "./subagent_store.ts";
import { isTmuxPaneAlive, killTmuxPane, type CommandExecutor } from "./subagent_tmux.ts";
import { isTerminalState, type NormalizedRunRequest, type RunSnapshot } from "./subagent_types.ts";

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ManagedSubagentRun {
    request: NormalizedRunRequest;
    snapshot: RunSnapshot;
}

export interface ManagedRunRefresh {
    runs: ManagedSubagentRun[];
    malformedCount: number;
}

export async function readReconciledRunSnapshot(exec: CommandExecutor, stateRoot: string, runId: string): Promise<RunSnapshot> {
    const paths = runPaths(stateRoot, runId);
    let snapshot = await readSnapshot(stateRoot, runId);
    if (!isTerminalState(snapshot.status) && snapshot.tmux && (await readStatus(paths)).schemaVersion !== 4) {
        const alive = await isTmuxPaneAlive(exec, snapshot.tmux.paneId);
        if (!alive) {
            if (snapshot.status === "stopping") await finishStoppedRun(paths, "forced");
            else await failRun(paths, { category: "runner_lost", message: "The tmux runner pane disappeared before the run reached a terminal state" });
            snapshot = await readSnapshot(stateRoot, runId);
        }
    }
    return snapshot;
}

export function sortManagedRuns(runs: readonly ManagedSubagentRun[]): ManagedSubagentRun[] {
    return [...runs].sort((left, right) => {
        const leftTerminal = isTerminalState(left.snapshot.status); const rightTerminal = isTerminalState(right.snapshot.status);
        if (leftTerminal !== rightTerminal) return leftTerminal ? 1 : -1;
        const created = right.snapshot.createdAt.localeCompare(left.snapshot.createdAt);
        return created || left.snapshot.runId.localeCompare(right.snapshot.runId);
    });
}

export class OriginRunDiscovery {
    readonly #stateRoot: string;
    readonly #originSessionId: string;
    readonly #exec: CommandExecutor;
    readonly #matching = new Map<string, NormalizedRunRequest>();
    readonly #ignored = new Set<string>();

    constructor(options: { stateRoot: string; originSessionId: string; exec: CommandExecutor }) {
        this.#stateRoot = options.stateRoot; this.#originSessionId = options.originSessionId; this.#exec = options.exec;
    }

    async refresh(): Promise<ManagedRunRefresh> {
        let entries: string[];
        try { entries = await readdir(this.#stateRoot); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return { runs: [], malformedCount: 0 };
            throw error;
        }
        let malformedCount = 0;
        for (const runId of entries) {
            if (!RUN_ID.test(runId) || this.#matching.has(runId) || this.#ignored.has(runId)) continue;
            try {
                const request = await readRunRequest(runPaths(this.#stateRoot, runId));
                if (request.runId !== runId) throw new Error("run ID mismatch");
                if (request.originSessionId === this.#originSessionId) this.#matching.set(runId, request);
                else this.#ignored.add(runId);
            } catch {
                try {
                    const raw = await readJson<Record<string, unknown>>(runPaths(this.#stateRoot, runId).request);
                    if (raw.originSessionId === this.#originSessionId) malformedCount += 1;
                } catch { /* Incomplete or unattributable directories are retried without warning this session. */ }
            }
        }
        const runs: ManagedSubagentRun[] = [];
        for (const [runId, request] of this.#matching) {
            try { runs.push({ request, snapshot: await readReconciledRunSnapshot(this.#exec, this.#stateRoot, runId) }); }
            catch { malformedCount += 1; }
        }
        return { runs: sortManagedRuns(runs), malformedCount };
    }
}

export interface StopSubagentResult {
    run: ManagedSubagentRun;
    children: NormalizedRunRequest[];
    continuingChildCount: number;
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    if (signal.reason instanceof Error) throw signal.reason;
    throw new Error("Subagent stop cancelled");
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, milliseconds);
        const abort = () => { clearTimeout(timer); reject(signal?.reason instanceof Error ? signal.reason : new Error("Subagent stop cancelled")); };
        signal?.addEventListener("abort", abort, { once: true });
    });
}

export async function stopSubagentRun(options: {
    stateRoot: string;
    runId: string;
    originSessionId: string;
    exec: CommandExecutor;
    signal?: AbortSignal;
    monotonicNow?: () => number;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}): Promise<StopSubagentResult> {
    throwIfAborted(options.signal);
    const parent = await assertRunOrigin(options.stateRoot, options.runId, options.originSessionId);
    const paths = runPaths(options.stateRoot, options.runId);
    await requestRunStop(paths);
    const now = options.monotonicNow ?? (() => performance.now());
    const wait = options.sleep ?? sleep;
    const statusAtRequest = await readStatus(paths);
    const deadline = now() + (statusAtRequest.schemaVersion === 4 ? 5000 : 2500);
    let snapshot = await readSnapshot(options.stateRoot, options.runId);
    while (!isTerminalState(snapshot.status) && now() < deadline) {
        throwIfAborted(options.signal);
        await wait(50, options.signal);
        snapshot = await readSnapshot(options.stateRoot, options.runId);
    }
    if (!isTerminalState(snapshot.status)) {
        const status = await readStatus(paths);
        if (status.schemaVersion === 4) {
            throw new Error(`Run ${options.runId} stop request is durable but timed out; daemon/worker state: status=${status.status}, claim=${status.claim?.instanceId ?? "none"}, worker=${status.worker?.pid ?? "none"}`);
        }
        if (status.tmux && await isTmuxPaneAlive(options.exec, status.tmux.paneId)) await killTmuxPane(options.exec, status.tmux.paneId);
        await finishStoppedRun(paths, "forced"); snapshot = await readSnapshot(options.stateRoot, options.runId);
    }
    if (!isTerminalState(snapshot.status)) throw new Error(`Run ${options.runId} could not be terminalized; current status is ${snapshot.status}`);
    const children = await immediateChildRequests(options.stateRoot, parent);
    const childStates = await Promise.all(children.map(child => readStatus(runPaths(options.stateRoot, child.runId)).then(value => value.status).catch(() => undefined)));
    return { run: { request: parent, snapshot }, children, continuingChildCount: childStates.filter(state => state !== undefined && !isTerminalState(state)).length };
}
