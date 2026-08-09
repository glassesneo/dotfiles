import { readFile } from "node:fs/promises";
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
