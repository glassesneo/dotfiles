import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { appendSequencedEvent, claimRunAndLaunchWorker, failRun, finishStoppedRun, readJson, readStatus, runPaths } from "./utilities/subagent_store.ts";
import { withRunLock } from "./utilities/subagent_lock.ts";
import { isTerminalState, validateSubagentRuntimeConfig, type SubagentRuntimeConfig, type SupervisorHeartbeat, type WorkerHeartbeat } from "./utilities/subagent_types.ts";

const STALE_MS = 5000; const SCAN_MS = 250; const STOP_GRACE_MS = 2500;
function live(pid: number): boolean { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch { return false; } }
function fresh(timestamp: string | undefined, now = Date.now()): boolean { return !!timestamp && Number.isFinite(Date.parse(timestamp)) && now - Date.parse(timestamp) <= STALE_MS; }
async function atomicPrivateJson(path: string, value: unknown): Promise<void> { const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 }); await rename(temporary, path); await chmod(path, 0o600); }
async function optionalJson<T>(path: string): Promise<T | undefined> { try { return await readJson<T>(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
async function assertPrivateControlFiles(paths: ReturnType<typeof runPaths>): Promise<void> {
    for (const path of [paths.directory, paths.request, paths.resolved, paths.status, paths.events]) {
        const metadata = await stat(path); if ((metadata.mode & 0o022) !== 0) throw new Error(`Refusing writable subagent control path: ${path}`);
    }
}

export class SubagentSupervisor {
    readonly config: SubagentRuntimeConfig; readonly instanceId = randomUUID(); readonly startedAt = new Date().toISOString();
    readonly heartbeatPath: string; readonly lockPath: string; #stopping = false; #children = new Map<string, ReturnType<typeof spawn>>();
    constructor(config: SubagentRuntimeConfig) { this.config = config; this.heartbeatPath = join(config.stateRoot, "supervisor-heartbeat.json"); this.lockPath = join(config.stateRoot, ".supervisor-lock"); }
    async acquire(): Promise<void> {
        await mkdir(this.config.stateRoot, { recursive: true, mode: 0o700 }); await chmod(this.config.stateRoot, 0o700);
        await withRunLock(this.config.stateRoot, async () => {
            const owner = await optionalJson<{ instanceId: string; pid: number }>(join(this.lockPath, "owner.json"));
            if (owner && live(owner.pid)) throw new Error(`Subagent supervisor already running as PID ${owner.pid}`);
            await rm(this.lockPath, { recursive: true, force: true }); await mkdir(this.lockPath, { mode: 0o700 });
            await atomicPrivateJson(join(this.lockPath, "owner.json"), { instanceId: this.instanceId, pid: process.pid, startedAt: this.startedAt });
        });
    }
    async heartbeat(): Promise<void> { const value: SupervisorHeartbeat = { schemaVersion: 4, instanceId: this.instanceId, pid: process.pid, startedAt: this.startedAt, updatedAt: new Date().toISOString() }; await atomicPrivateJson(this.heartbeatPath, value); }
    async launch(runId: string, relaunch = false): Promise<void> {
        const paths = runPaths(this.config.stateRoot, runId); const current = await readStatus(paths); if (current.schemaVersion !== 4 || (current.status !== "created" && current.status !== "starting")) return;
        const claimToken = randomUUID(); const workerToken = randomUUID(); const claimedAt = new Date().toISOString();
        try {
            const claimed = await claimRunAndLaunchWorker(
                paths,
                { instanceId: this.instanceId, token: claimToken, claimedAt },
                { token: workerToken, pid: 0, processGroupId: 0, startedAt: claimedAt },
                current.status === "starting" ? current.claim?.token : undefined,
                () => {
                    const child = spawn(this.config.runner.node, ["--experimental-strip-types", this.config.runner.script, paths.directory], { detached: true, stdio: "ignore", env: { ...process.env, PI_SUBAGENT_WORKER_TOKEN: workerToken } });
                    if (!child.pid) throw new Error("Supervisor could not obtain worker PID");
                    child.unref(); this.#children.set(runId, child); child.once("exit", () => this.#children.delete(runId));
                    return { token: workerToken, pid: child.pid, processGroupId: child.pid, startedAt: claimedAt };
                },
            );
            if (!claimed) return;
        } catch (error) {
            await failRun(paths, { category: "launch", message: error instanceof Error ? error.message : String(error) }); return;
        }
        if (relaunch) await appendSequencedEvent(paths, "diagnostic", { category: "supervisor", message: "Relaunched worker after stale starting claim" });
    }
    async inspect(runId: string): Promise<void> {
        const paths = runPaths(this.config.stateRoot, runId); let status;
        try {
            await assertPrivateControlFiles(paths);
            const persisted = await readJson<{ schemaVersion?: number }>(paths.status);
            // Legacy runs remain under their original tmux lifecycle owner.
            if (persisted.schemaVersion !== 4) return;
            status = await readStatus(paths);
        } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); return; }
        if (isTerminalState(status.status)) return;
        if (status.status === "created") { await this.launch(runId); return; }
        const heartbeat = await optionalJson<WorkerHeartbeat>(paths.workerHeartbeat);
        const matching = !!status.worker && !!heartbeat && heartbeat.runId === runId && heartbeat.workerToken === status.worker.token && heartbeat.pid === status.worker.pid;
        const workerLive = !!status.worker && live(status.worker.pid);
        const healthy = matching && fresh(heartbeat?.updatedAt) && workerLive;
        if (status.status === "starting") {
            if (healthy || (workerLive && fresh(status.worker?.startedAt))) return;
            if (!fresh(status.claim?.claimedAt)) await this.launch(runId, true);
            return;
        }
        if (status.status === "running") {
            if (!healthy) { await failRun(paths, { category: "runner_lost", message: "The supervisor could not verify the run worker heartbeat and process identity" }, status.startedAt); await appendSequencedEvent(paths, "diagnostic", { category: "runner_lost", message: "Worker heartbeat or identity was lost" }); await appendSequencedEvent(paths, "run_finished", { outcome: "failed" }, { uniqueTerminal: true }); }
            return;
        }
        if (status.status === "stopping") {
            if (!workerLive) { await finishStoppedRun(paths, "forced"); await appendSequencedEvent(paths, "run_finished", { outcome: "stopped", method: "forced" }, { uniqueTerminal: true }); return; }
            if (Date.now() - Date.parse(status.stopRequestedAt ?? status.createdAt) >= STOP_GRACE_MS && healthy) {
                try { process.kill(-(status.worker?.processGroupId ?? status.worker!.pid), "SIGKILL"); }
                catch (error) { await appendSequencedEvent(paths, "diagnostic", { category: "stop", message: `Forced stop signal failed: ${error instanceof Error ? error.message : String(error)}` }); }
                // Do not claim success until a later scan confirms the identified
                // worker has exited. An unverified/reused PID is never signalled.
            }
        }
    }
    async scan(): Promise<void> { for (const entry of await readdir(this.config.stateRoot).catch(() => [] as string[])) { if (/^[0-9a-f-]{36}$/i.test(entry)) await this.inspect(entry); } }
    async run(): Promise<void> { await this.acquire(); const stop = () => { this.#stopping = true; }; process.once("SIGTERM", stop); process.once("SIGINT", stop); try { while (!this.#stopping) { await this.heartbeat(); await this.scan(); await delay(SCAN_MS); } } finally {
        const heartbeat = await optionalJson<SupervisorHeartbeat>(this.heartbeatPath); if (heartbeat?.instanceId === this.instanceId) await rm(this.heartbeatPath, { force: true });
        const owner = await optionalJson<{ instanceId: string }>(join(this.lockPath, "owner.json")); if (owner?.instanceId === this.instanceId) await rm(this.lockPath, { recursive: true, force: true });
    } }
}
export async function loadSupervisorConfig(path: string): Promise<SubagentRuntimeConfig> { return validateSubagentRuntimeConfig(JSON.parse(await readFile(path, "utf8"))); }
const invokedPath = process.argv[1]; if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) { const configPath = process.argv[2]; if (!configPath) { process.stderr.write("Usage: subagent_supervisor.ts <config-path>\n"); process.exitCode = 2; } else await new SubagentSupervisor(await loadSupervisorConfig(configPath)).run(); }
