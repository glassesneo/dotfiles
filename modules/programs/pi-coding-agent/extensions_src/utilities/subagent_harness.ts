import type { ResolvedRun, TranscriptCapabilities } from "./subagent_types.ts";
import { runPiHarness, type PiRunCallbacks } from "./subagent_pi.ts";

export interface HarnessAdapter {
    id: string;
    protocolVersion: number;
    capabilities: TranscriptCapabilities;
    run(resolved: ResolvedRun, request: { prompt: string; cwd: string }, callbacks: PiRunCallbacks, signal?: AbortSignal): ReturnType<typeof runPiHarness>;
}

const pi: HarnessAdapter = {
    id: "pi",
    protocolVersion: 1,
    capabilities: { assistantText: true, toolCalls: true, toolResults: true, usage: true },
    run: runPiHarness,
};

export const harnessAdapters: Readonly<Record<string, HarnessAdapter>> = Object.freeze({ pi });
export function resolveHarnessAdapter(id: string): HarnessAdapter {
    const adapter = harnessAdapters[id];
    if (!adapter) throw new Error(`Unknown or unconfigured subagent harness: ${id}`);
    return adapter;
}
