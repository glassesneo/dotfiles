import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RETRY_DELAY_MS = 20;
const MAX_ATTEMPTS = 150;
const OWNER_WRITE_GRACE_MS = 1000;

interface LockOwner {
    pid: number;
    acquiredAt: string;
    token: string;
}

function processExists(pid: number): boolean {
    try { process.kill(pid, 0); return true; }
    catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

async function readOwner(lockDirectory: string): Promise<LockOwner | undefined> {
    try {
        const value = JSON.parse(await readFile(join(lockDirectory, "owner.json"), "utf8")) as Partial<LockOwner>;
        return Number.isInteger(value.pid) && value.pid! > 0 && typeof value.acquiredAt === "string" && typeof value.token === "string"
            ? value as LockOwner
            : undefined;
    } catch { return undefined; }
}

async function acquireLock(lockDirectory: string, owner: LockOwner): Promise<boolean> {
    const candidate = `${lockDirectory}.candidate.${process.pid}.${owner.token}`;
    await mkdir(candidate, { mode: 0o700 });
    try {
        await writeFile(join(candidate, "owner.json"), `${JSON.stringify(owner)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        if (await stat(lockDirectory).then(() => true).catch(error => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
            throw error;
        })) return false;
        try {
            await rename(candidate, lockDirectory);
            return true;
        } catch (error) {
            if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
            return false;
        }
    } finally { await rm(candidate, { recursive: true, force: true }); }
}

async function removeQuarantine(quarantine: string): Promise<void> {
    await rm(quarantine, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: RETRY_DELAY_MS,
    });
}

async function tryReclaim(lockDirectory: string): Promise<boolean> {
    const observedIdentity = await stat(lockDirectory).catch(() => undefined);
    if (!observedIdentity) return false;
    const observedOwner = await readOwner(lockDirectory);
    if (observedOwner ? processExists(observedOwner.pid) : Date.now() - observedIdentity.mtimeMs < OWNER_WRITE_GRACE_MS) return false;
    const claimPath = join(lockDirectory, "reclaim");
    const temporary = `${lockDirectory}.reclaim.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${process.pid}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    try { await link(temporary, claimPath); }
    catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Darwin may report EINVAL when another reclaimer renames the lock
        // directory between path resolution and link(2); it is equivalent to
        // losing this reclaim attempt and should be retried.
        if (code === "ENOENT" || code === "EINVAL") return false;
        if (code === "EEXIST") {
            const directoryIdentity = await stat(lockDirectory).catch(() => undefined);
            const claimant = await readFile(claimPath, "utf8").then(value => Number.parseInt(value, 10)).catch(() => undefined);
            if (directoryIdentity && Number.isInteger(claimant) && !processExists(claimant!)) {
                const currentIdentity = await stat(lockDirectory).catch(() => undefined);
                if (currentIdentity?.dev === directoryIdentity.dev && currentIdentity.ino === directoryIdentity.ino) {
                    await unlink(claimPath).catch(() => {});
                }
            }
            return false;
        }
        throw error;
    } finally { await unlink(temporary).catch(() => {}); }

    // Capture the directory identity only after installing the marker. This
    // binds the claim to whichever lock generation received the hard link.
    const directoryIdentity = await stat(lockDirectory).catch(() => undefined);
    if (!directoryIdentity) return false;
    let removed = false;
    try {
        const claimedIdentity = await stat(lockDirectory).catch(() => undefined);
        if (claimedIdentity?.dev !== directoryIdentity.dev || claimedIdentity.ino !== directoryIdentity.ino) return false;
        const current = await readOwner(lockDirectory);
        const ownerlessMtimeMs = observedIdentity?.dev === directoryIdentity.dev && observedIdentity.ino === directoryIdentity.ino
            ? observedIdentity.mtimeMs
            : directoryIdentity.mtimeMs;
        const ownerlessStale = current === undefined
            && Date.now() - ownerlessMtimeMs >= OWNER_WRITE_GRACE_MS;
        if ((current !== undefined && !processExists(current.pid)) || ownerlessStale) {
            const currentIdentity = await stat(lockDirectory).catch(() => undefined);
            if (currentIdentity?.dev !== directoryIdentity.dev || currentIdentity.ino !== directoryIdentity.ino) return false;
            const quarantine = `${lockDirectory}.stale.${process.pid}.${randomUUID()}`;
            try { await rename(lockDirectory, quarantine); }
            catch (error) {
                if (["ENOENT", "EINVAL"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
                throw error;
            }
            removed = true;
            await removeQuarantine(quarantine);
        }
        return removed;
    } finally {
        if (!removed && directoryIdentity) {
            const currentIdentity = await stat(lockDirectory).catch(() => undefined);
            if (currentIdentity?.dev === directoryIdentity.dev && currentIdentity.ino === directoryIdentity.ino) {
                await unlink(claimPath).catch(() => {});
            }
        }
    }
}

/** Low-level cross-process lock. Lifecycle code should use the mesh helpers below. */
async function withDirectoryLock<T>(runDirectory: string, operation: () => Promise<T>): Promise<T> {
    const lockDirectory = join(runDirectory, ".lock");
    const owner: LockOwner = { pid: process.pid, acquiredAt: new Date().toISOString(), token: randomUUID() };
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (!await acquireLock(lockDirectory, owner)) {
            if (await tryReclaim(lockDirectory)) continue;
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            continue;
        }
        let operationResult!: T;
        let operationError: unknown;
        let operationSucceeded = false;
        try {
            operationResult = await operation();
            operationSucceeded = true;
        } catch (error) {
            operationError = error;
        }

        const current = await readOwner(lockDirectory);
        if (current?.token === owner.token) {
            const quarantine = `${lockDirectory}.release.${process.pid}.${randomUUID()}`;
            try {
                await rename(lockDirectory, quarantine);
                await removeQuarantine(quarantine);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
        }
        if (!operationSucceeded) throw operationError;
        return operationResult;
    }
    throw new Error(`Timed out acquiring orchestration lock: ${runDirectory}`);
}

function assertUuid(id: string, label: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) throw new Error(`Invalid ${label}: ${id}`);
}

export function meshDirectory(stateRoot: string, meshId: string): string {
    assertUuid(meshId, "mesh ID");
    return join(stateRoot, "meshes", meshId);
}

/** Serialize all mesh-wide accounting and lifecycle mutations. */
export function withMeshLock<T>(stateRoot: string, meshId: string, operation: () => Promise<T>): Promise<T> {
    return withDirectoryLock(meshDirectory(stateRoot, meshId), operation);
}

/** Enforce the only valid nested lock order: mesh, then agent. */
export function withMeshAgentLock<T>(stateRoot: string, meshId: string, agentId: string, operation: () => Promise<T>): Promise<T> {
    assertUuid(agentId, "agent ID");
    return withMeshLock(stateRoot, meshId, () => withDirectoryLock(join(meshDirectory(stateRoot, meshId), "agents", agentId), operation));
}
