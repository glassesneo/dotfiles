import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RETRY_DELAY_MS = 10;
const MAX_ATTEMPTS = 500;

interface LockOwner {
    pid: number;
    token: string;
}

function processExists(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}

async function readOwner(lockDirectory: string): Promise<LockOwner | undefined> {
    try {
        const value = JSON.parse(await readFile(join(lockDirectory, "owner.json"), "utf8")) as Partial<LockOwner>;
        return Number.isInteger(value.pid) && typeof value.token === "string" ? value as LockOwner : undefined;
    } catch {
        return undefined;
    }
}

async function acquireLock(lockDirectory: string, owner: LockOwner): Promise<boolean> {
    const candidate = `${lockDirectory}.candidate.${process.pid}.${owner.token}`;
    await mkdir(candidate, { mode: 0o700 });
    try {
        await writeFile(join(candidate, "owner.json"), `${JSON.stringify(owner)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        try {
            await rename(candidate, lockDirectory);
            return true;
        } catch (error) {
            if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
            return false;
        }
    } finally {
        await rm(candidate, { recursive: true, force: true });
    }
}

async function reclaimStaleLock(lockDirectory: string): Promise<boolean> {
    const identity = await stat(lockDirectory).catch(() => undefined);
    if (identity === undefined) return true;
    const owner = await readOwner(lockDirectory);
    if (owner !== undefined && processExists(owner.pid)) return false;

    const current = await stat(lockDirectory).catch(() => undefined);
    if (current?.dev !== identity.dev || current.ino !== identity.ino) return false;
    const quarantine = `${lockDirectory}.stale.${process.pid}.${randomUUID()}`;
    try {
        await rename(lockDirectory, quarantine);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
        return false;
    }
    await rm(quarantine, { recursive: true, force: true });
    return true;
}

/** Serialize approval of one pending artifact across processes. */
export async function withPendingArtifactLock<T>(pendingDirectory: string, pendingId: string, operation: () => Promise<T>): Promise<T> {
    const lockDirectory = join(pendingDirectory, `${pendingId}.approval-lock`);
    const owner: LockOwner = { pid: process.pid, token: randomUUID() };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (!await acquireLock(lockDirectory, owner)) {
            if (await reclaimStaleLock(lockDirectory)) continue;
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
                await rm(quarantine, { recursive: true, force: true });
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
        }
        if (!operationSucceeded) throw operationError;
        return operationResult;
    }
    throw new Error(`Timed out acquiring pending artifact approval lock: ${pendingId}`);
}
