import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    validateWebRetrievalRuntimeConfig,
    type WebRetrievalRuntimeConfig,
} from "./web_retrieval_types.ts";

export async function loadWebRetrievalRuntimeConfig(
    path: string,
    signal?: AbortSignal,
): Promise<WebRetrievalRuntimeConfig> {
    const raw = await readFile(path, { encoding: "utf8", signal });
    return validateWebRetrievalRuntimeConfig(JSON.parse(raw));
}

export async function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw signal.reason ?? new Error("aborted");
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(signal.reason ?? new Error("aborted"));
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            value => {
                signal.removeEventListener("abort", onAbort);
                resolve(value);
            },
            error => {
                signal.removeEventListener("abort", onAbort);
                reject(error);
            },
        );
    });
}

export function parseRetryWaitMs(headers: Headers, defaultWaitMs: number, nowMs = Date.now()): number {
    const retryAfter = headers.get("Retry-After")?.trim();
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
        const retryAt = Date.parse(retryAfter);
        if (Number.isFinite(retryAt)) return Math.max(0, retryAt - nowMs);
    }
    const reset = headers.get("X-RateLimit-Reset")?.split(",")[0]?.trim();
    if (reset) {
        const seconds = Number(reset);
        if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
    }
    return defaultWaitMs;
}

export async function writePrivateTempOutput(prefix: string, content: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    await chmod(directory, 0o700);
    const filePath = join(directory, "output.txt");
    await writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
    await chmod(filePath, 0o600);
    return filePath;
}

export async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason ?? new Error("aborted");
    await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(signal?.reason ?? new Error("aborted"));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
