import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SupervisorHeartbeat } from "./subagent_types.ts";

export const SUPERVISOR_STALE_MS = 5000;
export async function readHealthySupervisor(stateRoot: string, now = Date.now()): Promise<SupervisorHeartbeat> {
    let heartbeat: SupervisorHeartbeat;
    const path = join(stateRoot, "supervisor-heartbeat.json");
    try {
        const metadata = await stat(path); if ((metadata.mode & 0o022) !== 0) throw new Error("heartbeat is group/world writable");
        heartbeat = JSON.parse(await readFile(path, "utf8")) as SupervisorHeartbeat;
    }
    catch (error) { throw new Error(`Subagent supervisor is unavailable: ${error instanceof Error ? error.message : String(error)}`); }
    if (heartbeat.schemaVersion !== 4 || typeof heartbeat.instanceId !== "string" || !Number.isInteger(heartbeat.pid)
        || !Number.isFinite(Date.parse(heartbeat.updatedAt)) || now - Date.parse(heartbeat.updatedAt) > SUPERVISOR_STALE_MS) {
        throw new Error("Subagent supervisor heartbeat is stale or invalid");
    }
    try { process.kill(heartbeat.pid, 0); } catch { throw new Error("Subagent supervisor process is not alive"); }
    return heartbeat;
}
