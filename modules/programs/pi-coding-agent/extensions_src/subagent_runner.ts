import { basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { HarnessRunError, runPiHarness, type PiNormalizedInput } from "./utilities/subagent_pi.ts";
import {
    appendEvent,
    appendStderr,
    failRun,
    finishRun,
    patchStatus,
    readJson,
    readStatus,
    runPaths,
} from "./utilities/subagent_store.ts";
import type {
    NormalizedEvent,
    ResolvedRun,
    RunRequest,
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

export async function runSubagent(runDirectory: string): Promise<void> {
    const runId = basename(runDirectory);
    const paths = runPaths(dirname(runDirectory), runId);
    let sequence = 0;
    let startedAt: string | undefined;
    const emit = async (type: NormalizedEvent["type"], data: Record<string, unknown>) => {
        const event: NormalizedEvent = {
            schemaVersion: 1,
            sequence: ++sequence,
            timestamp: new Date().toISOString(),
            type,
            data,
        };
        await appendEvent(paths, event);
    };

    try {
        await waitForTmuxReference(paths);
        const request = await readJson<RunRequest>(paths.request);
        const resolved = await readJson<ResolvedRun>(paths.resolved);
        if (request.schemaVersion !== 1 || resolved.schemaVersion !== 1 || request.runId !== runId || resolved.runId !== runId) {
            throw new HarnessRunError("protocol", "Run request or resolved metadata is invalid");
        }

        startedAt = new Date().toISOString();
        await patchStatus(paths, { status: "running", startedAt, runnerPid: process.pid });
        await emit("run_started", { profile: request.profile });
        process.stdout.write(`[subagent ${runId}] ${request.profile} started\n`);

        const completed = await runPiHarness(resolved, request, {
            async onEvent(event) {
                displayEvent(event);
                await emit(event.type, event.data);
            },
            async onStderr(text) {
                process.stderr.write(text);
                await appendStderr(paths, text);
            },
        });

        const finishedAt = new Date().toISOString();
        const result: RunResult = {
            schemaVersion: 1,
            runId,
            outcome: "succeeded",
            output: completed.output,
            error: null,
            usage: completed.usage,
            startedAt,
            finishedAt,
        };
        await emit("run_finished", { outcome: "succeeded" });
        await finishRun(paths, result);
        process.stdout.write(`\n[subagent ${runId}] succeeded\n`);
    } catch (error) {
        const failure = error instanceof HarnessRunError
            ? { category: error.category, message: error.message, exitCode: error.exitCode }
            : { category: "protocol" as const, message: error instanceof Error ? error.message : String(error) };
        try {
            await appendStderr(paths, `${failure.message}\n`);
            await emit("diagnostic", { category: failure.category, message: failure.message });
            await emit("run_finished", { outcome: "failed" });
            await failRun(paths, failure, startedAt);
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
