import { chmod, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { resolveHarnessAdapter } from "./utilities/subagent_harness.ts";
import { HarnessRunError, HarnessStoppedError, type PiNormalizedInput } from "./utilities/subagent_pi.ts";
import { appendSequencedEvent, appendStderr, appendTerminalEvent, failRun, finishRun, finishStoppedRun, markRunRunning, readJson, readRunRequest, readStatus, runPaths } from "./utilities/subagent_store.ts";
import type { ResolvedRun, RunResult, WorkerHeartbeat } from "./utilities/subagent_types.ts";

async function atomicHeartbeat(path: string, value: WorkerHeartbeat): Promise<void> {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    await rename(temporary, path); await chmod(path, 0o600);
}
function displayEvent(event: PiNormalizedInput): void {
    if (event.type === "assistant_text") process.stdout.write(event.data.text);
    if (event.type === "tool_started") process.stdout.write(`\n→ ${event.data.name} ${JSON.stringify(event.data.arguments)}\n`);
    if (event.type === "tool_finished") process.stdout.write(`← ${event.data.name}${event.data.isError ? " failed" : " done"}\n`);
}

export async function runSubagent(runDirectory: string): Promise<void> {
    const runId = basename(runDirectory); const paths = runPaths(dirname(runDirectory), runId);
    const workerToken = process.env.PI_SUBAGENT_WORKER_TOKEN;
    let startedAt: string | undefined; let heartbeatDone = false;
    try {
        const integrity = await readStatus(paths);
        if (integrity.schemaVersion !== 4 || !workerToken || integrity.worker?.token !== workerToken) throw new HarnessRunError("protocol", `Worker token mismatch for run ${runId}`);
        const request = await readRunRequest(paths); const resolved = await readJson<ResolvedRun>(paths.resolved);
        if (resolved.schemaVersion !== 4) throw new HarnessRunError("protocol", `Supervisor cannot launch legacy run ${runId}`);
        const adapter = resolveHarnessAdapter(resolved.harness);
        startedAt = new Date().toISOString();
        await atomicHeartbeat(paths.workerHeartbeat, { schemaVersion: 4, runId, workerToken, pid: process.pid, updatedAt: startedAt });
        const running = await markRunRunning(paths, startedAt, process.pid, workerToken);
        if (running.status === "stopping") { await finishStoppedRun(paths, "cooperative"); return; }
        if (running.status !== "running") return;
        const heartbeat = (async () => {
            while (!heartbeatDone) {
                await delay(1000);
                if (!heartbeatDone) await atomicHeartbeat(paths.workerHeartbeat, { schemaVersion: 4, runId, workerToken, pid: process.pid, updatedAt: new Date().toISOString() });
            }
        })();
        await appendSequencedEvent(paths, "run_started", { profile: resolved.targetProfile, harness: resolved.harness });
        const controller = new AbortController(); let harnessFinished = false;
        const stopMonitor = (async () => { while (!harnessFinished) { if ((await readStatus(paths)).status === "stopping") { controller.abort(); return; } await delay(50); } })();
        let completed: Awaited<ReturnType<typeof adapter.run>>;
        try {
            completed = await adapter.run(resolved, request, {
                async onEvent(event) { displayEvent(event); await appendSequencedEvent(paths, event.type, event.data); },
                async onStderr(text) { process.stderr.write(text); await appendStderr(paths, text); },
            }, controller.signal);
        } finally { harnessFinished = true; await stopMonitor; }
        const finishedAt = new Date().toISOString();
        const result: RunResult = { schemaVersion: 4, runId, outcome: "succeeded", output: completed.output, error: null, usage: completed.usage, turns: completed.turns, startedAt, finishedAt };
        const terminal = await finishRun(paths, result);
        if (terminal.status === "stopping") await finishStoppedRun(paths, "cooperative", completed.usage, completed.turns, completed.output, startedAt);
        const committed = await readJson<RunResult>(paths.result);
        await appendTerminalEvent(paths, { schemaVersion: 4, sequence: 0, timestamp: finishedAt, type: "run_finished", data: { outcome: committed.outcome, ...(committed.outcome === "stopped" ? { method: committed.stopMethod } : {}) } });
        heartbeatDone = true; await heartbeat;
    } catch (error) {
        heartbeatDone = true;
        if (error instanceof HarnessStoppedError) {
            await finishStoppedRun(paths, error.method, error.usage, error.turns, error.output, startedAt);
        } else {
            const failure = error instanceof HarnessRunError ? { category: error.category, message: error.message, exitCode: error.exitCode } : { category: "protocol" as const, message: error instanceof Error ? error.message : String(error) };
            await appendStderr(paths, `${failure.message}\n`).catch(() => {});
            await appendSequencedEvent(paths, "diagnostic", { category: failure.category, message: failure.message }).catch(() => {});
            const terminal = await failRun(paths, failure, startedAt, error instanceof HarnessRunError ? error.usage : undefined, error instanceof HarnessRunError ? error.turns : 0);
            if (terminal.status === "stopping") await finishStoppedRun(paths, "cooperative", error instanceof HarnessRunError ? error.usage : undefined, error instanceof HarnessRunError ? error.turns : 0, "", startedAt);
        }
        try { const result = await readJson<RunResult>(paths.result); await appendTerminalEvent(paths, { schemaVersion: 4, sequence: 0, timestamp: new Date().toISOString(), type: "run_finished", data: { outcome: result.outcome, ...(result.outcome === "stopped" ? { method: result.stopMethod } : {}) } }); } catch {}
        if (!(error instanceof HarnessStoppedError)) process.exitCode = 1;
    }
}
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) { const directory = process.argv[2]; if (!directory) { process.stderr.write("Usage: subagent_runner.ts <run-directory>\n"); process.exitCode = 2; } else await runSubagent(directory); }
