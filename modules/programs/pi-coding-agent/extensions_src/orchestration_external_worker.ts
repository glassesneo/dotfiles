import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { launchEnvelopeDigest, validateLaunchEnvelope } from "./utilities/agent_types.ts";
import { externalContext, publishAgentActivity, type AgentActivityPhase } from "./utilities/orchestration_activity.ts";
import { bindAgentRuntime } from "./utilities/orchestration_runtime.ts";
import { agentPaths, applyAgentControl, claimPendingTask, confirmAgentInterrupt, failAgent, finishTask, markBridgeReady, readAgentExecution, readAgentSnapshot, readAgentStatus, readTaskCancellation, requestAgentStop } from "./utilities/orchestration_store.ts";
import { emptyUsage, isTerminalAgent } from "./utilities/orchestration_types.ts";
import { displayIdentityForSnapshot, formatCompactAgentIdentity, type AgentDisplayIdentity } from "./utilities/orchestration_identity_core.ts";
import { isConfirmedAcpCancellation, isUnconfirmedTermination, resolveExternalDriver, validateExternalWorkerConfig, type ExternalDriver, type ExternalWorkerConfig, type ExternalWorkerEvent } from "./utilities/orchestration_external_driver.ts";
import { createDirectoryWake, workerTaskInboxDirectory, type DirectoryWake, type DirectoryWakeDependencies } from "./utilities/orchestration_wake.ts";
import { classifyInvocationFailure } from "./utilities/orchestration_limit.ts";
import { isAcpJsonRpcError } from "./utilities/orchestration_acp.ts";
import { EXECUTION_RESUME_CONTENT } from "./utilities/orchestration_execution.ts";

interface WorkerDependencies { claimPendingTask?: typeof claimPendingTask; readAgentStatus?: typeof readAgentStatus; readAgentSnapshot?: typeof readAgentSnapshot; readTaskCancellation?: typeof readTaskCancellation; createDriver?: (config: ExternalWorkerConfig, event: (event: ExternalWorkerEvent) => void) => ExternalDriver; publishAgentActivity?: typeof publishAgentActivity; activityHeartbeatMs?: number; idleClaimIntervalMs?: number; idleStopProbeMs?: number; activeCancellationIntervalMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void>; wake?: DirectoryWakeDependencies }

function requireEnv(env: NodeJS.ProcessEnv, name: string): string { const value = env[name]; if (!value?.trim()) throw new Error(`${name} is required`); return value; }
function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function externalWorkerHeading(identity: AgentDisplayIdentity): string {
    return formatCompactAgentIdentity(identity);
}

export function externalTaskPrompt(roleInstructions: string, callerTask: string): string {
    return [roleInstructions.trim(), callerTask].filter(Boolean).join("\n\nDelegated task:\n");
}

class TerminalView {
    #heading: string | undefined;
    constructor(identity: AgentDisplayIdentity) {
        this.show(identity, true);
    }
    show(identity: AgentDisplayIdentity, clear = false): void {
        const heading = externalWorkerHeading(identity);
        if (!clear && heading === this.#heading) return;
        this.#heading = heading;
        process.stdout.write(clear ? `\u001b[2J\u001b[H${heading}\n\n` : `\n${heading}\n`);
    }
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
    const launch = envelope;
    const route = resolveExternalDriver(config, launch.self.execution);
    const wait = dependencies.sleep ?? sleep;
    await waitForAgent(stateRoot, meshId, agentId, wait);
    const initialSnapshot = await (dependencies.readAgentSnapshot ?? readAgentSnapshot)(stateRoot, meshId, agentId);
    if (config.adapter === "cursor-acp") {
        if (initialSnapshot.agent.cursorAcpModelId !== config.expectedAcpModelId) throw new Error("Cursor worker ACP model ID does not match the persisted agent record");
    }
    const view = new TerminalView(displayIdentityForSnapshot(initialSnapshot));
    const showUsualIdentity = async (clear = false) => {
        const snapshot = await (dependencies.readAgentSnapshot ?? readAgentSnapshot)(stateRoot, meshId, agentId);
        view.show(displayIdentityForSnapshot(snapshot), clear);
    };
    const event = (workerEvent: ExternalWorkerEvent) => view.event(workerEvent);
    const driver = dependencies.createDriver?.(config, event) ?? route.create(event);
    const runtimeId = randomUUID(); await bindAgentRuntime(stateRoot, meshId, agentId, { runtimeId, kind: "external" }); let activityPhase: AgentActivityPhase = "starting"; let phaseSince = new Date((dependencies.now ?? Date.now)()).toISOString(); let lastHeartbeat = Number.NEGATIVE_INFINITY;
    let stopping = false;
    // Stop closes publication admission synchronously, then drains prior writes before retiring the store record.
    let activityPublication: Promise<void> = Promise.resolve();
    const publishActivity = (phase = activityPhase, heartbeat = false): Promise<void> => {
        const publication = activityPublication.then(async () => {
            if (stopping && phase !== "confirming-stop" && phase !== "offline") return;
            const now = (dependencies.now ?? Date.now)();
            if (heartbeat && now - lastHeartbeat < (dependencies.activityHeartbeatMs ?? 2000)) return;
            const phaseChanged = phase !== activityPhase;
            if (phaseChanged) { activityPhase = phase; phaseSince = new Date(now).toISOString(); }
            lastHeartbeat = now;
            const observedAt = new Date(now).toISOString();
            await (dependencies.publishAgentActivity ?? publishAgentActivity)(stateRoot, meshId, agentId, { runtimeId, phase: activityPhase, acceptingTask: activityPhase === "idle", pendingMessages: false, phaseSince, observedAt, heartbeatAt: observedAt, context: externalContext() });
            if (phaseChanged && phase !== "starting") await showUsualIdentity();
        });
        activityPublication = publication.catch(() => {});
        return publication;
    };
    let confirmationCompleted = false;
    let retainUntilExit = false;
    let stopPromise: Promise<void> | undefined;
    let shutdownPromise: Promise<void> | undefined;
    let activeTaskId: string | undefined;
    let parentTerminalOutcome: "stopped" | "failed" | undefined;
    let taskWake: DirectoryWake | undefined; let wakePending = false; let wakeResolve: (() => void) | undefined; let wakePromise = new Promise<void>(resolveWake => { wakeResolve = resolveWake; });
    const signalWake = () => { wakePending = true; wakeResolve?.(); };
    const resetWake = () => { wakePromise = new Promise<void>(resolveWake => { wakeResolve = resolveWake; }); };
    const shutdownDriver = (): Promise<void> => shutdownPromise ??= driver.shutdown();
    const shutdown = (): Promise<void> => shutdownDriver().catch(() => {});
    const waitForObservedExit = async (): Promise<void> => {
        if (driver.exitObserved()) return;
        await driver.waitForClose();
    };
    const persistRecoveryStop = async (reason: string): Promise<void> => {
        await requestAgentStop(stateRoot, meshId, agentId, { source: "recovery", reason, terminalState: "failed", expectedRuntimeId: runtimeId });
    };
    const confirmUnconfirmedTermination = async (reason: string): Promise<void> => {
        stopPromise ??= (async () => {
            stopping = true;
            await activityPublication;
            await persistRecoveryStop(reason);
            await publishActivity("confirming-stop");
            await driver.cancel().catch(() => {});
            try {
                await shutdownDriver();
            } catch (error) {
                retainUntilExit = true;
                view.outcome("failed", `stop confirmation failed: ${errorText(error)}`);
                await waitForObservedExit();
                retainUntilExit = false;
            }
            await failAgent(stateRoot, meshId, agentId, reason, false, { expectedRuntimeId: runtimeId });
            confirmationCompleted = true;
            view.outcome("failed", reason);
        })();
        await stopPromise;
    };
    const stop = (reason: string, preserveTerminalOutcome?: "stopped" | "failed", rootManagedStopping = false): Promise<void> => {
        stopPromise ??= (async () => {
            stopping = true;
            await activityPublication;
            await taskWake?.close(); taskWake = undefined;
            parentTerminalOutcome = preserveTerminalOutcome;
            if (!rootManagedStopping && !preserveTerminalOutcome) {
                await requestAgentStop(stateRoot, meshId, agentId, { source: "shutdown", reason, terminalState: "failed", expectedRuntimeId: runtimeId });
            }
            await driver.cancel().catch(() => {});
            try {
                await shutdownDriver();
            } catch {
                retainUntilExit = true;
                await waitForObservedExit();
                retainUntilExit = false;
            }
            if (activeTaskId) await finishTask(stateRoot, meshId, activeTaskId, { outcome: preserveTerminalOutcome ?? "stopped", usage: emptyUsage(), turns: 1, error: reason }, runtimeId);
            if (!preserveTerminalOutcome && !rootManagedStopping) await failAgent(stateRoot, meshId, agentId, reason, false, { overrideTerminalReason: true, expectedRuntimeId: runtimeId });
        })();
        return stopPromise;
    };
    const signal = (name: string) => { void stop(`External worker received ${name}`).finally(() => { process.exitCode = 0; }); };
    const onTerm = () => signal("SIGTERM");
    const onInt = () => signal("SIGINT");
    const onHup = () => signal("SIGHUP");
    process.once("SIGTERM", onTerm);
    process.once("SIGINT", onInt);
    process.once("SIGHUP", onHup);
    try {
        await publishActivity("starting");
        await driver.start();
        if (stopping) { await stopPromise; return; }
        const driverClosed = driver.waitForClose().then(driverError => ({ driverError }));
        await markBridgeReady(stateRoot, meshId, agentId, launchEnvelopeDigest(envelope), runtimeId);
        if (stopping) { await stopPromise; return; }
        view.event({ type: "state", text: "ready" });
        await publishActivity("idle");
        taskWake = await createDirectoryWake({ directory: workerTaskInboxDirectory(stateRoot, meshId, agentId), run: signalWake, onError: error => view.event({ type: "state", text: `Task wake error: ${errorText(error)}` }), dependencies: dependencies.wake });
        let nextClaimAt = Number.NEGATIVE_INFINITY;
        let heldPrompt: string | undefined;
        let sessionReusable = true;
        while (!stopping) {
            await publishActivity(activityPhase, true).catch(() => {});
            const status = await (dependencies.readAgentStatus ?? readAgentStatus)(agentPaths(stateRoot, meshId, agentId), meshId);
            if (isTerminalAgent(status.state)) { await stop(status.exitReason ?? "Stopped by parent", status.state === "failed" ? "failed" : "stopped"); break; }
            if (status.state === "stopping") { await stop(status.exitReason ?? "Stopped by parent", undefined, true); break; }
            const fatalBeforeClaim = driver.fatalError();
            if (fatalBeforeClaim) throw fatalBeforeClaim;
            const now = (dependencies.now ?? Date.now)();
            const execution = await readAgentExecution(stateRoot, meshId, agentId).catch(() => undefined);
            if (!sessionReusable) {
                if (!execution?.unavailable) await applyAgentControl(stateRoot, meshId, agentId, { action: "pause", source: "system", issuer: "interrupt", expectedRuntimeId: runtimeId, expectedBindingId: runtimeId, unavailable: true }).catch(() => {});
                const closed = await Promise.race([wait(Math.min(dependencies.idleStopProbeMs ?? 100, 50)).then(() => undefined), driverClosed, wakePromise.then(() => "wake" as const)]);
                if (closed === "wake") { resetWake(); continue; }
                if (closed) throw closed.driverError;
                continue;
            }
            if (execution?.holds.length) {
                const closed = await Promise.race([wait(Math.min(dependencies.idleStopProbeMs ?? 100, 50)).then(() => undefined), driverClosed, wakePromise.then(() => "wake" as const)]);
                if (closed === "wake") { resetWake(); continue; }
                if (closed) throw closed.driverError;
                continue;
            }
            const shouldClaim = wakePending || now >= nextClaimAt; wakePending = false;
            const retryPrompt = activeTaskId && heldPrompt ? heldPrompt : undefined;
            if (retryPrompt && (driver.fatalError() || execution?.unavailable)) {
                await applyAgentControl(stateRoot, meshId, agentId, { action: "pause", source: "system", issuer: "interrupt", expectedRuntimeId: runtimeId, expectedBindingId: runtimeId, unavailable: true }).catch(() => {});
                heldPrompt = undefined;
                const closed = await Promise.race([wait(Math.min(dependencies.idleStopProbeMs ?? 100, 50)).then(() => undefined), driverClosed, wakePromise.then(() => "wake" as const)]);
                if (closed === "wake") { resetWake(); continue; }
                if (closed) throw closed.driverError;
                continue;
            }
            const task = retryPrompt ? undefined : shouldClaim ? await (dependencies.claimPendingTask ?? claimPendingTask)(stateRoot, meshId, agentId, runtimeId) : undefined;
            if (shouldClaim && !retryPrompt) nextClaimAt = now + (dependencies.idleClaimIntervalMs ?? 3000);
            if (stopping) { await stopPromise; break; }
            if (!task && !retryPrompt) {
                const closed = await Promise.race([wait(Math.min(dependencies.idleStopProbeMs ?? 100, Math.max(0, nextClaimAt - now))).then(() => undefined), driverClosed, wakePromise.then(() => "wake" as const)]);
                if (closed === "wake") { resetWake(); continue; }
                if (closed) throw closed.driverError;
                const fatal = driver.fatalError();
                if (fatal) throw fatal;
                continue;
            }
            const taskId = task?.request.taskId ?? activeTaskId!;
            const prompt = retryPrompt ?? externalTaskPrompt(launch.self.instructions, task!.request.prompt);
            heldPrompt = undefined;
            activeTaskId = taskId;
            await publishActivity("running");
            if (stopping) { await stopPromise; break; }
            let turnSettled = false;
            let taskCancelled = false;
            let driverFailed = false;
            let interruptCancelIssued = false;
            const monitorStop = async (): Promise<void> => {
                while (!turnSettled) {
                    await wait(dependencies.activeCancellationIntervalMs ?? 50);
                    if (turnSettled) return;
                    await publishActivity(activityPhase, true).catch(() => {});
                    if (turnSettled) return;
                    const status = (await (dependencies.readAgentSnapshot ?? readAgentSnapshot)(stateRoot, meshId, agentId)).status;
                    if (turnSettled) return;
                    if (isTerminalAgent(status.state)) {
                        await stop(status.exitReason ?? "Stopped by parent", status.state === "failed" ? "failed" : "stopped");
                        throw new Error(status.exitReason ?? "Stopped by parent");
                    }
                    if (status.state === "stopping") {
                        await stop(status.exitReason ?? "Stopped by parent", undefined, true);
                        throw new Error(status.exitReason ?? "Stopped by parent");
                    }
                    const cancellation = await (dependencies.readTaskCancellation ?? readTaskCancellation)(stateRoot, meshId, taskId);
                    const liveExecution = await readAgentExecution(stateRoot, meshId, agentId).catch(() => undefined);
                    if (turnSettled) return;
                    if (cancellation) {
                        taskCancelled = true;
                        await driver.cancel();
                        throw new Error("Task cancelled by parent");
                    }
                    if (liveExecution?.interrupting && !interruptCancelIssued) {
                        interruptCancelIssued = true;
                        await driver.cancel();
                    }
                    const fatal = driver.fatalError();
                    if (fatal && (driver.exitObserved() || !isUnconfirmedTermination(fatal))) { driverFailed = true; throw fatal; }
                }
            };
            const taskPromise = driver.runTask(prompt);
            void taskPromise.catch(() => undefined);
            try {
                const result = await Promise.race([taskPromise, monitorStop(), driverClosed]);
                turnSettled = true;
                if (stopping) continue;
                if (!result) throw new Error("External task monitor settled without a task result");
                if ("driverError" in result) { driverFailed = true; throw result.driverError; }
                const liveExecution = await readAgentExecution(stateRoot, meshId, agentId).catch(() => undefined);
                if (liveExecution?.interrupting) {
                    if (isConfirmedAcpCancellation(result)) {
                        await confirmAgentInterrupt(stateRoot, meshId, agentId, liveExecution.revision, runtimeId).catch(() => {});
                        heldPrompt = EXECUTION_RESUME_CONTENT;
                        view.event({ type: "state", text: "interrupted" });
                    } else {
                        sessionReusable = false;
                        await applyAgentControl(stateRoot, meshId, agentId, { action: "pause", source: "system", issuer: "interrupt", expectedRuntimeId: runtimeId, expectedBindingId: runtimeId, unavailable: true }).catch(() => {});
                        view.event({ type: "state", text: "unavailable" });
                    }
                    continue;
                }
                const fatalAfterTurn = driver.fatalError();
                if (fatalAfterTurn) stopping = true;
                await finishTask(stateRoot, meshId, taskId, { outcome: "succeeded", output: result.output, usage: emptyUsage(), turns: 1, ...(fatalAfterTurn ? { retireAgent: "failed" as const } : {}) }, runtimeId);
                view.outcome("succeeded", result.stopReason);
                if (fatalAfterTurn) {
                    activeTaskId = undefined;
                    await failAgent(stateRoot, meshId, agentId, errorText(fatalAfterTurn), false, { overrideTerminalReason: true, expectedRuntimeId: runtimeId });
                    await stop(errorText(fatalAfterTurn), "failed");
                    continue;
                }
            } catch (error) {
                turnSettled = true;
                if (stopPromise) await stopPromise;
                const message = errorText(error);
                let taskError: unknown;
                if (taskCancelled) try { await taskPromise; } catch (rejected) { taskError = rejected; }
                const liveExecution = await readAgentExecution(stateRoot, meshId, agentId).catch(() => undefined);
                const rpc = isAcpJsonRpcError(error) ? error : undefined;
                const classified = classifyInvocationFailure({ errorMessage: message, jsonRpcCode: rpc?.jsonRpcCode, jsonRpcData: rpc?.jsonRpcData });
                const unconfirmed = isUnconfirmedTermination(error) || isUnconfirmedTermination(taskError) || isUnconfirmedTermination(driver.fatalError());
                if (liveExecution?.interrupting) {
                    let settledError: unknown = error;
                    try { await taskPromise; } catch (rejected) { settledError = rejected; }
                    if (!isUnconfirmedTermination(settledError) && !isUnconfirmedTermination(driver.fatalError()) && isConfirmedAcpCancellation(settledError)) {
                        await confirmAgentInterrupt(stateRoot, meshId, agentId, liveExecution.revision, runtimeId).catch(() => {});
                        heldPrompt = EXECUTION_RESUME_CONTENT;
                        view.event({ type: "state", text: "interrupted" });
                    } else {
                        sessionReusable = false;
                        await applyAgentControl(stateRoot, meshId, agentId, { action: "pause", source: "system", issuer: "interrupt", expectedRuntimeId: runtimeId, expectedBindingId: runtimeId, unavailable: true }).catch(() => {});
                        view.event({ type: "state", text: "unavailable" });
                    }
                } else if (liveExecution?.holds.length) {
                    heldPrompt = EXECUTION_RESUME_CONTENT;
                    view.event({ type: "state", text: "held" });
                } else if (classified.class === "limit" && classified.resumeEligible && sessionReusable && driver.fatalError() === undefined) {
                    await applyAgentControl(stateRoot, meshId, agentId, { action: "pause", source: "system", issuer: "limit", expectedRuntimeId: runtimeId, expectedBindingId: runtimeId, limitHold: { holdId: randomUUID(), kind: "limit", requestId: randomUUID(), source: "system", targetRoot: agentId } }).catch(() => {});
                    heldPrompt = EXECUTION_RESUME_CONTENT;
                    view.event({ type: "state", text: "blocked-limit" });
                } else if (unconfirmed && !stopPromise && !parentTerminalOutcome) {
                    await confirmUnconfirmedTermination(isUnconfirmedTermination(error) ? message : errorText(taskError ?? driver.fatalError() ?? error));
                } else if (!stopPromise && !stopping && (driverFailed || driver.fatalError())) {
                    stopping = true;
                    await failAgent(stateRoot, meshId, agentId, message, false, { expectedRuntimeId: runtimeId });
                    view.outcome("failed", message);
                } else if (!stopPromise) {
                    const outcome = parentTerminalOutcome ?? (stopping || taskCancelled ? "stopped" : "failed");
                    const output = taskCancelled ? driver.partialOutput?.() ?? "" : "";
                    await finishTask(stateRoot, meshId, taskId, { outcome, output, usage: emptyUsage(), turns: 1, error: message }, runtimeId);
                    view.outcome(outcome, message);
                }
            } finally {
                turnSettled = true;
                const liveExecution = await readAgentExecution(stateRoot, meshId, agentId).catch(() => undefined);
                if (activeTaskId === taskId && !liveExecution?.holds.length && !heldPrompt) activeTaskId = undefined;
                if (!stopping) await publishActivity(liveExecution?.holds.length ? "running" : "idle").catch(() => {});
            }
        }
    } catch (error) {
        if (confirmationCompleted) return;
        if (stopping) throw error;
        const message = errorText(error);
        if (isUnconfirmedTermination(error)) {
            await confirmUnconfirmedTermination(message);
            return;
        }
        view.outcome("failed", message);
        await failAgent(stateRoot, meshId, agentId, message, false, { expectedRuntimeId: runtimeId });
        throw error;
    } finally {
        try { await stopPromise; }
        finally {
            process.removeListener("SIGTERM", onTerm);
            process.removeListener("SIGINT", onInt);
            process.removeListener("SIGHUP", onHup);
            await taskWake?.close(); taskWake = undefined;
            if (!retainUntilExit) await publishActivity("offline").catch(() => {});
            await shutdown();
        }
    }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    runExternalWorker().catch(error => { process.stderr.write(`${errorText(error)}\n`); process.exitCode = 1; });
}
