import { access } from "node:fs/promises";
import { agentPaths, claimPendingTask, failAgent, finishTask, markBridgeReady, readAgentSnapshot, readTaskCancellation } from "./utilities/subagent_store.ts";
import { emptyUsage, isTerminalAgent } from "./utilities/subagent_types.ts";
import { CursorAcpDriver, type ExternalDriver, type ExternalWorkerEvent } from "./utilities/subagent_cursor_acp.ts";

interface WorkerConfig { adapter: "cursor-acp"; command: string; cwd: string; model: string; profile: string; instructions: string; permissionPolicy: string }
interface WorkerDependencies { createDriver?: (config: WorkerConfig, event: (event: ExternalWorkerEvent) => void) => ExternalDriver; sleep?: (ms: number) => Promise<void> }

function requireEnv(env: NodeJS.ProcessEnv, name: string): string { const value = env[name]; if (!value?.trim()) throw new Error(`${name} is required`); return value; }
function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

class TerminalView {
    constructor(agentId: string, profile: string) {
        process.stdout.write(`\u001b[2J\u001b[HExternal subagent\nagent: ${agentId}\nprofile: ${profile}\nharness: cursor-agent\n\n`);
    }
    task(purpose: string): void { process.stdout.write(`\n━━ task: ${purpose} ━━\nstate: running\n`); }
    event(event: ExternalWorkerEvent): void {
        if (event.type === "text") process.stdout.write(event.text);
        else process.stdout.write(`\n[${event.type}] ${event.text}\n`);
    }
    outcome(outcome: string, detail = ""): void { process.stdout.write(`\nstate: ${outcome}${detail ? ` — ${detail}` : ""}\n`); }
}

async function waitForAgent(stateRoot: string, agentId: string, wait: (ms: number) => Promise<void>): Promise<void> {
    const path = agentPaths(stateRoot, agentId).agent;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        if (await access(path).then(() => true).catch(() => false)) return;
        await wait(25);
    }
    throw new Error("Parent did not publish the external agent record");
}

export async function runExternalWorker(env: NodeJS.ProcessEnv = process.env, dependencies: WorkerDependencies = {}): Promise<void> {
    const agentId = requireEnv(env, "PI_SUBAGENT_AGENT_ID");
    const stateRoot = requireEnv(env, "PI_SUBAGENT_STATE_ROOT");
    const rawConfig = JSON.parse(requireEnv(env, "PI_SUBAGENT_EXTERNAL_CONFIG")) as WorkerConfig;
    if (rawConfig.adapter !== "cursor-acp") throw new Error(`Unsupported external worker adapter: ${String(rawConfig.adapter)}`);
    const wait = dependencies.sleep ?? sleep;
    await waitForAgent(stateRoot, agentId, wait);
    const view = new TerminalView(agentId, rawConfig.profile);
    const driver = dependencies.createDriver?.(rawConfig, event => view.event(event)) ?? new CursorAcpDriver({
        command: rawConfig.command,
        cwd: rawConfig.cwd,
        model: rawConfig.model,
        permissionPolicy: rawConfig.permissionPolicy,
        event: event => view.event(event),
    });
    let stopping = false;
    let agentStopPromise: Promise<void> | undefined;
    let activeTaskId: string | undefined;
    const stop = async (reason: string): Promise<void> => {
        if (stopping) return;
        stopping = true;
        await driver.cancel().catch(() => {});
        if (activeTaskId) await finishTask(stateRoot, agentId, activeTaskId, { outcome: "stopped", usage: emptyUsage(), turns: 1, error: reason }).catch(() => {});
        await failAgent(stateRoot, agentId, reason, true, { overrideTerminalReason: true }).catch(() => {});
        await driver.shutdown().catch(() => {});
    };
    const signal = (name: string) => { void stop(`External worker received ${name}`).finally(() => { process.exitCode = 0; }); };
    process.once("SIGTERM", () => signal("SIGTERM"));
    process.once("SIGINT", () => signal("SIGINT"));
    process.once("SIGHUP", () => signal("SIGHUP"));
    try {
        await driver.start();
        await markBridgeReady(agentPaths(stateRoot, agentId));
        view.event({ type: "state", text: "ready" });
        while (!stopping) {
            const snapshot = await readAgentSnapshot(stateRoot, agentId);
            if (isTerminalAgent(snapshot.status.state) || snapshot.status.state === "stopping") { await stop(snapshot.status.exitReason ?? "Stopped by parent"); break; }
            const task = await claimPendingTask(stateRoot, agentId);
            if (!task) {
                await wait(100);
                const fatal = driver.fatalError();
                if (fatal) throw fatal;
                continue;
            }
            activeTaskId = task.request.taskId;
            view.task(task.request.purpose);
            const prompt = [rawConfig.instructions.trim(), task.request.prompt].filter(Boolean).join("\n\nDelegated task:\n");
            let turnSettled = false;
            let taskCancelled = false;
            const monitorStop = async (): Promise<void> => {
                while (!turnSettled) {
                    await wait(50);
                    const status = (await readAgentSnapshot(stateRoot, agentId)).status;
                    if (status.state === "stopping") {
                        agentStopPromise ??= stop("Stopped by parent");
                        await agentStopPromise;
                        throw new Error("Stopped by parent");
                    }
                    if (await readTaskCancellation(stateRoot, agentId, activeTaskId!)) {
                        taskCancelled = true;
                        await driver.cancel();
                        throw new Error("Task cancelled by parent");
                    }
                }
                return;
            };
            const taskPromise = driver.runTask(prompt);
            try {
                const result = await Promise.race([taskPromise, monitorStop()]);
                if (stopping) continue;
                if (!result) throw new Error("External task monitor settled without a task result");
                await finishTask(stateRoot, agentId, activeTaskId, { outcome: "succeeded", output: result.output, usage: emptyUsage(), turns: 1 });
                view.outcome("succeeded", result.stopReason);
            } catch (error) {
                if (agentStopPromise) await agentStopPromise;
                const message = errorText(error);
                if (taskCancelled) await taskPromise.catch(() => undefined);
                const outcome = stopping || taskCancelled ? "stopped" : "failed";
                const output = taskCancelled ? driver.partialOutput?.() ?? "" : "";
                await finishTask(stateRoot, agentId, activeTaskId, { outcome, output, usage: emptyUsage(), turns: 1, error: message });
                view.outcome(outcome, message);
                if (!stopping && driver.fatalError()) {
                    await failAgent(stateRoot, agentId, message, false);
                    stopping = true;
                }
            } finally { turnSettled = true; activeTaskId = undefined; }
        }
    } catch (error) {
        if (stopping) return;
        const message = errorText(error);
        view.outcome("failed", message);
        await failAgent(stateRoot, agentId, message, false);
        throw error;
    } finally {
        await driver.shutdown().catch(() => {});
    }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    runExternalWorker().catch(error => { process.stderr.write(`${errorText(error)}\n`); process.exitCode = 1; });
}
