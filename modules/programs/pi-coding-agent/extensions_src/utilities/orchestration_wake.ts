import { watch as nodeWatch, type FSWatcher, type WatchOptions } from "node:fs";
import { mkdir } from "node:fs/promises";
export { endpointBindingInboxDirectory, rootCompletionQueueDirectory, workerTaskInboxDirectory } from "./orchestration_index.ts";

export interface DirectoryWatcher {
    close(): void;
    on(event: "error", listener: (error: Error) => void): this;
    unref?(): void;
}
export type WatchDirectory = (path: string, options: WatchOptions, listener: (eventType: string, filename: string | Buffer | null) => void) => DirectoryWatcher;
export interface DirectoryWakeDependencies {
    watch?: WatchDirectory;
    setTimeout?: (callback: () => void | Promise<void>, delayMs: number) => unknown;
    clearTimeout?: (timer: unknown) => void;
}
export interface DirectoryWake {
    close(): Promise<void>;
}

export async function createDirectoryWake(input: {
    directory: string;
    run: () => void | Promise<void>;
    onError: (error: unknown) => void;
    debounceMs?: number;
    rearmMs?: number;
    recursive?: boolean;
    dependencies?: DirectoryWakeDependencies;
}): Promise<DirectoryWake> {
    const dependencies = input.dependencies ?? {};
    const watch = dependencies.watch ?? ((path, options, listener) => nodeWatch(path, options, listener) as FSWatcher);
    const schedule = dependencies.setTimeout ?? ((callback, delayMs) => globalThis.setTimeout(() => { void callback(); }, delayMs));
    const cancel = dependencies.clearTimeout ?? (timer => globalThis.clearTimeout(timer as NodeJS.Timeout));
    const debounceMs = input.debounceMs ?? 10;
    const rearmMs = input.rearmMs ?? 100;
    let watcher: DirectoryWatcher | undefined;
    let debounceTimer: unknown;
    let rearmTimer: unknown;
    let running: Promise<void> | undefined;
    let pending = false;
    let closed = false;
    let generation = 0;
    let armAttempted = false;
    let arming = false;
    const report = (error: unknown) => { try { input.onError(error); } catch {} };

    const requestRun = () => {
        if (closed) return;
        pending = true;
        if (running || debounceTimer !== undefined) return;
        debounceTimer = schedule(async () => {
            debounceTimer = undefined;
            if (closed || !pending) return;
            pending = false;
            const pass = Promise.resolve().then(input.run);
            running = pass;
            try { await pass; } catch (error) { if (!closed) report(error); }
            finally {
                if (running === pass) running = undefined;
                if (pending && !closed) requestRun();
            }
        }, debounceMs);
    };
    const arm = async (): Promise<void> => {
        if (closed || arming) return;
        const scanAfterArm = armAttempted;
        armAttempted = true;
        arming = true;
        try {
            await mkdir(input.directory, { recursive: true, mode: 0o700 });
            if (closed) return;
            const nextGeneration = generation + 1;
            const next = watch(input.directory, { persistent: false, recursive: input.recursive ?? false }, (eventType, filename) => {
                if (closed || nextGeneration !== generation) return;
                requestRun();
                if (eventType === "rename" && filename === null) scheduleRearm();
            });
            next.unref?.();
            next.on("error", error => {
                if (closed || nextGeneration !== generation) return;
                report(error);
                next.close();
                if (watcher === next) watcher = undefined;
                scheduleRearm();
            });
            if (closed) { next.close(); return; }
            const previous = watcher;
            watcher = next;
            generation = nextGeneration;
            previous?.close();
            if (scanAfterArm) requestRun();
        } catch (error) {
            if (!closed) { report(error); scheduleRearm(); }
        } finally { arming = false; }
    };
    const scheduleRearm = () => {
        if (closed || rearmTimer !== undefined) return;
        rearmTimer = schedule(() => { rearmTimer = undefined; return arm(); }, rearmMs);
    };

    await arm();
    return {
        async close() {
            if (closed) return;
            closed = true; generation += 1;
            watcher?.close(); watcher = undefined;
            if (debounceTimer !== undefined) { cancel(debounceTimer); debounceTimer = undefined; }
            if (rearmTimer !== undefined) { cancel(rearmTimer); rearmTimer = undefined; }
            pending = false;
            await running?.catch(() => {});
        },
    };
}
