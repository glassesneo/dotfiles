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
    catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

async function readOwner(lockDirectory: string): Promise<LockOwner | undefined> {
    try {
        const value = JSON.parse(await readFile(join(lockDirectory, "owner.json"), "utf8")) as Partial<LockOwner>;
        return Number.isInteger(value.pid) && typeof value.acquiredAt === "string" && typeof value.token === "string"
            ? value as LockOwner
            : undefined;
    } catch { return undefined; }
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

    const directoryIdentity = await stat(lockDirectory).catch(() => undefined);
    let removed = false;
    try {
        const current = await readOwner(lockDirectory);
        const ownerlessStale = current === undefined && directoryIdentity !== undefined
            && Date.now() - directoryIdentity.mtimeMs >= OWNER_WRITE_GRACE_MS;
        if ((current !== undefined && !processExists(current.pid)) || ownerlessStale) {
            const quarantine = `${lockDirectory}.stale.${process.pid}.${randomUUID()}`;
            await rename(lockDirectory, quarantine);
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

/** Serialize one run's cross-process lifecycle updates without external dependencies. */
export async function withRunLock<T>(runDirectory: string, operation: () => Promise<T>): Promise<T> {
    const lockDirectory = join(runDirectory, ".lock");
    const owner: LockOwner = { pid: process.pid, acquiredAt: new Date().toISOString(), token: randomUUID() };
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        try { await mkdir(lockDirectory, { mode: 0o700 }); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            if (await tryReclaim(lockDirectory)) continue;
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            continue;
        }
        let operationResult!: T;
        let operationError: unknown;
        let operationSucceeded = false;
        try {
            await writeFile(join(lockDirectory, "owner.json"), `${JSON.stringify(owner)}\n`, { encoding: "utf8", mode: 0o600 });
            operationResult = await operation();
            operationSucceeded = true;
        } catch (error) {
            operationError = error;
        }

        const current = await readOwner(lockDirectory);
        if (current?.token === owner.token || current === undefined) {
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
    throw new Error(`Timed out acquiring subagent run lock: ${runDirectory}`);
}
