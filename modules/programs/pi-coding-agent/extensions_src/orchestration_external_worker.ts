import { access, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { launchEnvelopeDigest, validateLaunchEnvelope } from "./utilities/agent_types.ts";
import { agentPaths, claimPendingTask, failAgent, finishTask, markBridgeReady, readAgentSnapshot, readTaskCancellation } from "./utilities/orchestration_store.ts";
import { emptyUsage, isTerminalAgent } from "./utilities/orchestration_types.ts";
import { resolveExternalDriver, validateExternalWorkerConfig, type ExternalDriver, type ExternalWorkerConfig, type ExternalWorkerEvent } from "./utilities/orchestration_external_driver.ts";

interface WorkerDependencies { createDriver?: (config: ExternalWorkerConfig, event: (event: ExternalWorkerEvent) => void) => ExternalDriver; sleep?: (ms: number) => Promise<void> }

function requireEnv(env: NodeJS.ProcessEnv, name: string): string { const value = env[name]; if (!value?.trim()) throw new Error(`${name} is required`); return value; }
function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

class TerminalView {
    constructor(agentId: string, agent: string, harness: string) {
        process.stdout.write(`\u001b[2J\u001b[HExternal mesh agent\nagent ID: ${agentId}\nrole: ${agent}\nharness: ${harness}\n\n`);
    }
    task(summary: string): void { process.stdout.write(`\n━━ task: ${summary} ━━\nstate: running\n`); }
    event(event: ExternalWorkerEvent): void {
        if (event.type === "text") process.stdout.write(event.text);
        else process.stdout.write(`\n[${event.type}] ${event.text}\n`);
    }
    outcome(outcome: string, detail = ""): void { process.stdout.write(`\nstate: ${outcome}${detail ? ` — ${detail}` : ""}\n`); }
}

function stateRootFromLaunchPaths(meshId: string, agentId: string, agentDirectory: string, taskPath: string): string {
    const directory = resolve(agentDirectory);
    const agentsDirectory = dirname(directory);
    const meshDirectory = dirname(agentsDirectory);
    const meshesDirectory = dirname(meshDirectory);
    if (basename(directory) !== agentId || basename(agentsDirectory) !== "agents" || basename(meshDirectory) !== meshId || basename(meshesDirectory) !== "meshes") throw new Error("PI_MESH_AGENT_DIR does not match mesh launch identity");
    const resolvedTask = resolve(taskPath);
    if (dirname(dirname(resolvedTask)) !== meshDirectory || basename(dirname(resolvedTask)) !== "tasks") throw new Error("PI_MESH_TASK_PATH is not mesh-global for this mesh");
    return dirname(meshesDirectory);
}

async function waitForAgent(stateRoot: string, meshId: string, agentId: string, wait: (ms: number) => Promise<void>): Promise<void> {
    const path = agentPaths(stateRoot, meshId, agentId).agent;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        if (await access(path).then(() => true).catch(() => false)) return;
        await wait(25);
    }
    throw new Error("Parent did not publish the external agent record");
}

export async function runExternalWorker(env: NodeJS.ProcessEnv = process.env, dependencies: WorkerDependencies = {}): Promise<void> {
    const meshId = requireEnv(env, "PI_MESH_ID");
    const agentId = requireEnv(env, "PI_MESH_AGENT_ID");
    const agentDirectory = requireEnv(env, "PI_MESH_AGENT_DIR");
    const epochId = requireEnv(env, "PI_MESH_EPOCH_ID");
    const taskPath = requireEnv(env, "PI_MESH_TASK_PATH");
    const stateRoot = stateRootFromLaunchPaths(meshId, agentId, agentDirectory, taskPath);
    const config = validateExternalWorkerConfig(JSON.parse(requireEnv(env, "PI_MESH_EXTERNAL_CONFIG")));
    const envelope = validateLaunchEnvelope(JSON.parse(await readFile(requireEnv(env, "PI_AGENT_RESOLVED_AGENT"), "utf8")));
    if (envelope.meshId !== meshId || envelope.agentId !== agentId || envelope.epochId !== epochId) throw new Error("External worker metadata does not match the immutable epoch snapshot");
    const agent = envelope.identity.slice(6); const definition = envelope.self;
    const route = resolveExternalDriver(config, definition);
    const wait = dependencies.sleep ?? sleep;
    await waitForAgent(stateRoot, meshId, agentId, wait);
    const view = new TerminalView(agentId, agent, route.display);
    const event = (workerEvent: ExternalWorkerEvent) => view.event(workerEvent);
    const driver = dependencies.createDriver?.(config, event) ?? route.create(event);
    let stopping = false;
    let stopPromise: Promise<void> | undefined;
    let shutdownPromise: Promise<void> | undefined;
    let activeTaskId: string | undefined;
    let parentTerminalOutcome: "stopped" | "failed" | undefined;
    const shutdown = (): Promise<void> => shutdownPromise ??= driver.shutdown().catch(() => {});
    const stop = (reason: string, preserveTerminalOutcome?: "stopped" | "failed"): Promise<void> => {
        stopPromise ??= (async () => {
            stopping = true;
            parentTerminalOutcome = preserveTerminalOutcome;
            await driver.cancel().catch(() => {});
            if (activeTaskId) await finishTask(stateRoot, meshId, activeTaskId, { outcome: preserveTerminalOutcome ?? "stopped", usage: emptyUsage(), turns: 1, error: reason }).catch(() => {});
            if (!preserveTerminalOutcome) await failAgent(stateRoot, meshId, agentId, reason, true, { overrideTerminalReason: true }).catch(() => {});
            await shutdown();
        })();
        return stopPromise;
    };
    const signal = (name: string) => { void stop(`External worker received ${name}`).finally(() => { process.exitCode = 0; }); };
    process.once("SIGTERM", () => signal("SIGTERM"));
    process.once("SIGINT", () => signal("SIGINT"));
    process.once("SIGHUP", () => signal("SIGHUP"));
    try {
        await driver.start();
        const driverClosed = driver.waitForClose().then(driverError => ({ driverError }));
        await markBridgeReady(stateRoot, meshId, agentId, launchEnvelopeDigest(envelope));
        view.event({ type: "state", text: "ready" });
        while (!stopping) {
            const snapshot = await readAgentSnapshot(stateRoot, meshId, agentId);
            if (isTerminalAgent(snapshot.status.state)) { await stop(snapshot.status.exitReason ?? "Stopped by parent", snapshot.status.state === "failed" ? "failed" : "stopped"); break; }
            if (snapshot.status.state === "stopping") { await stop(snapshot.status.exitReason ?? "Stopped by parent"); break; }
            const task = await claimPendingTask(stateRoot, meshId, agentId);
            if (!task) {
                const closed = await Promise.race([wait(100).then(() => undefined), driverClosed]);
                if (closed) throw closed.driverError;
                const fatal = driver.fatalError();
                if (fatal) throw fatal;
                continue;
            }
            activeTaskId = task.request.taskId;
            view.task(task.request.prompt.split(/\r?\n/u).find(Boolean) ?? "Task");
            const prompt = [definition.instructions.trim(), task.request.prompt].filter(Boolean).join("\n\nDelegated task:\n");
            let turnSettled = false;
            let taskCancelled = false;
            let driverFailed = false;
            const monitorStop = async (): Promise<void> => {
                while (!turnSettled) {
                    await wait(50);
                    const status = (await readAgentSnapshot(stateRoot, meshId, agentId)).status;
                    if (isTerminalAgent(status.state)) {
                        await stop(status.exitReason ?? "Stopped by parent", status.state === "failed" ? "failed" : "stopped");
                        throw new Error(status.exitReason ?? "Stopped by parent");
                    }
                    if (status.state === "stopping") {
                        await stop(status.exitReason ?? "Stopped by parent");
                        throw new Error(status.exitReason ?? "Stopped by parent");
                    }
                    if (await readTaskCancellation(stateRoot, meshId, activeTaskId!)) {
                        taskCancelled = true;
                        await driver.cancel();
                        throw new Error("Task cancelled by parent");
                    }
                    const fatal = driver.fatalError();
                    if (fatal) { driverFailed = true; throw fatal; }
                }
                return;
            };
            const taskPromise = driver.runTask(prompt);
            void taskPromise.catch(() => undefined);
            try {
                const result = await Promise.race([taskPromise, monitorStop(), driverClosed]);
                if (stopping) continue;
                if (!result) throw new Error("External task monitor settled without a task result");
                if ("driverError" in result) { driverFailed = true; throw result.driverError; }
                await finishTask(stateRoot, meshId, activeTaskId, { outcome: "succeeded", output: result.output, usage: emptyUsage(), turns: 1 });
                view.outcome("succeeded", result.stopReason);
            } catch (error) {
                if (stopPromise) await stopPromise;
                const message = errorText(error);
                if (taskCancelled) await taskPromise.catch(() => undefined);
                const outcome = parentTerminalOutcome ?? (stopping || taskCancelled ? "stopped" : "failed");
                const output = taskCancelled ? driver.partialOutput?.() ?? "" : "";
                await finishTask(stateRoot, meshId, activeTaskId, { outcome, output, usage: emptyUsage(), turns: 1, error: message });
                view.outcome(outcome, message);
                if (!stopping && (driverFailed || driver.fatalError())) {
                    await failAgent(stateRoot, meshId, agentId, message, false);
                    stopping = true;
                }
            } finally { turnSettled = true; activeTaskId = undefined; }
        }
    } catch (error) {
        if (stopping) return;
        const message = errorText(error);
        view.outcome("failed", message);
        await failAgent(stateRoot, meshId, agentId, message, false);
        throw error;
    } finally {
        await shutdown();
    }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    runExternalWorker().catch(error => { process.stderr.write(`${errorText(error)}\n`); process.exitCode = 1; });
}
