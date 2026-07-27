import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { HarnessRunError, HarnessStoppedError, runPiHarness, type PiNormalizedInput } from "./utilities/subagent_pi.ts";
import {
    appendEvent,
    appendStderr,
    appendTerminalEvent,
    failRun,
    finishRun,
    finishStoppedRun,
    markRunRunning,
    readJson,
    readRunRequest,
    readSnapshot,
    readStatus,
    runPaths,
} from "./utilities/subagent_store.ts";
import type {
    NormalizedEvent,
    ResolvedRun,
    RunResult,
} from "./utilities/subagent_types.ts";

async function waitForTmuxReference(paths: ReturnType<typeof runPaths>): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((await readStatus(paths)).tmux) return;
        await delay(50);
    }
    throw new Error("Timed out waiting for tmux run metadata");
}

function displayEvent(event: PiNormalizedInput): void {
    if (event.type === "assistant_text") process.stdout.write(event.data.text);
    if (event.type === "tool_started") process.stdout.write(`\n→ ${event.data.tool} ${JSON.stringify(event.data.arguments)}\n`);
    if (event.type === "tool_finished") process.stdout.write(`← ${event.data.tool}${event.data.isError ? " failed" : " done"}\n`);
}

async function lastPersistedSequence(path: string): Promise<number> {
    const content = await readFile(path, "utf8").catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw error;
    });
    return content.split("\n").filter(Boolean).reduce((maximum, line) => {
        const event = JSON.parse(line) as Partial<NormalizedEvent>;
        return typeof event.sequence === "number" ? Math.max(maximum, event.sequence) : maximum;
    }, 0);
}

export async function runSubagent(runDirectory: string): Promise<void> {
    const runId = basename(runDirectory);
    const paths = runPaths(dirname(runDirectory), runId);
    let sequence = await lastPersistedSequence(paths.events);
    let startedAt: string | undefined;
    let terminalEventAttempted = false;
    const emit = async (type: NormalizedEvent["type"], data: Record<string, unknown>) => {
        const event: NormalizedEvent = {
            schemaVersion: 2,
            sequence: ++sequence,
            timestamp: new Date().toISOString(),
            type,
            data,
        };
        await appendEvent(paths, event);
    };
    const emitCommittedTerminal = async (): Promise<RunResult> => {
        const [status, result] = await Promise.all([readStatus(paths), readJson<RunResult>(paths.result)]);
        if (status.status !== result.outcome) throw new Error(`Run ${runId} status and result disagree`);
        if (!terminalEventAttempted) {
            terminalEventAttempted = true;
            const data: Record<string, unknown> = { outcome: result.outcome };
            if (result.outcome === "stopped") data.method = result.stopMethod;
            const event: NormalizedEvent = {
                schemaVersion: 2,
                sequence: ++sequence,
                timestamp: new Date().toISOString(),
                type: "run_finished",
                data,
            };
            await appendTerminalEvent(paths, event);
        }
        return result;
    };

    try {
        await waitForTmuxReference(paths);
        const integrityStatus = await readStatus(paths);
        if (integrityStatus.schemaVersion !== 3) {
            throw new HarnessRunError("protocol", `Live run ${runId} uses legacy status schema v2 and cannot be launched safely`);
        }
        await readSnapshot(dirname(runDirectory), runId);
        const request = await readRunRequest(paths);
        const resolved = await readJson<ResolvedRun>(paths.resolved);
        const canonicalProfile = resolved.targetProfile;

        startedAt = new Date().toISOString();
        const running = await markRunRunning(paths, startedAt, process.pid);
        if (running.status === "stopping") {
            await finishStoppedRun(paths, "cooperative");
            const committed = await emitCommittedTerminal();
            process.stdout.write(`\n[subagent ${runId}] ${committed.outcome}\n`);
            return;
        }
        if (running.status !== "running") return;
        await emit("run_started", { profile: canonicalProfile });
        process.stdout.write(`[subagent ${runId}] ${canonicalProfile} started\n`);

        const controller = new AbortController();
        let harnessFinished = false;
        const stopMonitor = (async () => {
            while (!harnessFinished) {
                if ((await readStatus(paths)).status === "stopping") { controller.abort(); return; }
                await delay(50);
            }
        })();
        let completed: Awaited<ReturnType<typeof runPiHarness>>;
        try {
            completed = await runPiHarness(resolved, request, {
                async onEvent(event) {
                    displayEvent(event);
                    await emit(event.type, event.data);
                },
                async onStderr(text) {
                    process.stderr.write(text);
                    await appendStderr(paths, text);
                },
            }, controller.signal);
        } finally {
            harnessFinished = true;
            await stopMonitor;
        }

        const finishedAt = new Date().toISOString();
        const result: RunResult = {
            schemaVersion: 3,
            runId,
            outcome: "succeeded",
            output: completed.output,
            error: null,
            usage: completed.usage,
            turns: completed.turns,
            startedAt,
            finishedAt,
        };
        const terminal = await finishRun(paths, result);
        if (terminal.status === "stopping") {
            await finishStoppedRun(paths, "cooperative", completed.usage, completed.turns, completed.output, startedAt);
        }
        const committed = await emitCommittedTerminal();
        process.stdout.write(`\n[subagent ${runId}] ${committed.outcome}\n`);
    } catch (error) {
        if (error instanceof HarnessStoppedError) {
            try {
                await finishStoppedRun(paths, error.method, error.usage, error.turns, error.output, startedAt);
                const committed = await emitCommittedTerminal();
                process.stdout.write(`\n[subagent ${runId}] ${committed.outcome}\n`);
                return;
            } catch (persistError) {
                process.stderr.write(`Could not persist stopped runner: ${persistError instanceof Error ? persistError.message : String(persistError)}\n`);
                process.exitCode = 1;
                return;
            }
        }
        const failure = error instanceof HarnessRunError
            ? { category: error.category, message: error.message, exitCode: error.exitCode }
            : { category: "protocol" as const, message: error instanceof Error ? error.message : String(error) };
        try {
            await appendStderr(paths, `${failure.message}\n`);
            await emit("diagnostic", { category: failure.category, message: failure.message });
            const terminal = await failRun(
                paths,
                failure,
                startedAt,
                error instanceof HarnessRunError ? error.usage : undefined,
                error instanceof HarnessRunError ? error.turns : 0,
            );
            if (terminal.status === "stopping") {
                await finishStoppedRun(
                    paths,
                    "cooperative",
                    error instanceof HarnessRunError ? error.usage : undefined,
                    error instanceof HarnessRunError ? error.turns : 0,
                    "",
                    startedAt,
                );
            }
            const committed = await emitCommittedTerminal();
            if (committed.outcome !== "failed") {
                process.stdout.write(`\n[subagent ${runId}] ${committed.outcome}\n`);
                return;
            }
        } catch (persistError) {
            process.stderr.write(`Could not persist runner failure: ${persistError instanceof Error ? persistError.message : String(persistError)}\n`);
        }
        process.stderr.write(`\n[subagent ${runId}] failed: ${failure.message}\n`);
        process.exitCode = 1;
    }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
    const runDirectory = process.argv[2];
    if (!runDirectory) {
        process.stderr.write("Usage: subagent_runner.ts <run-directory>\n");
        process.exitCode = 2;
    } else {
        await runSubagent(runDirectory);
    }
}
