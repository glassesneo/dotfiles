import { dirname } from "node:path";
import type { RunSnapshot } from "./subagent_types.ts";

export const MODEL_JSON_MAX_BYTES = 50 * 1024;
const MODEL_JSON_MAX_LINES = 1500;

type JsonRecord = Record<string, unknown>;

function bytes(value: string): number {
    return Buffer.byteLength(value, "utf8");
}

function lineCap(value: string): { value: string; truncated: boolean } {
    const lines = value.split("\n");
    if (lines.length <= MODEL_JSON_MAX_LINES) return { value, truncated: false };
    return { value: lines.slice(0, MODEL_JSON_MAX_LINES).join("\n"), truncated: true };
}

function outputNote(path: string, omitted: boolean): string {
    return omitted
        ? `[Output omitted. Full result: ${path}]`
        : `\n\n[Output truncated. Full result: ${path}]`;
}

function withOutputs<T extends JsonRecord>(value: T, budgets: Map<string, number>): T {
    const clone = structuredClone(value);
    const runs = Array.isArray(clone.runs) ? clone.runs as RunSnapshot[] : [clone as unknown as RunSnapshot];
    for (const snapshot of runs) {
        if (!snapshot.result?.output) continue;
        const path = snapshot.paths.result;
        const capped = lineCap(snapshot.result.output);
        const characters = Array.from(capped.value);
        const budget = Math.max(0, budgets.get(snapshot.runId) ?? characters.length);
        const truncated = capped.truncated || budget < characters.length;
        if (!truncated) {
            snapshot.result.output = capped.value;
            continue;
        }
        const content = characters.slice(0, budget).join("");
        snapshot.result.output = budget === 0 ? outputNote(path, true) : `${content}${outputNote(path, false)}`;
    }
    return clone;
}

function compactEnvelope(value: JsonRecord): JsonRecord {
    const rawRuns = Array.isArray(value.runs) ? value.runs as RunSnapshot[] : [value as unknown as RunSnapshot];
    const runs = rawRuns.map(run => ({
        runId: run.runId,
        profile: run.profile,
        status: run.status,
        outputOmitted: Boolean(run.result?.output),
    }));
    const roots = [...new Set(rawRuns.map(run => dirname(run.runDirectory)))];
    const resultRunIds = rawRuns.filter(run => run.result).map(run => run.runId);
    const base: JsonRecord = {
        compact: true,
        runs,
        count: runs.length,
        omittedCount: runs.filter(run => run.outputOmitted).length,
        results: roots.length === 1 ? { resultRoot: roots[0], resultFile: "result.json", runIds: resultRunIds } : undefined,
    };
    for (const key of ["condition", "reason", "completedRunIds", "pendingRunIds"] as const) {
        if (value[key] !== undefined) base[key] = value[key];
    }
    return base;
}

/** Serialize a normal tool payload as valid JSON no larger than Pi's 50KB limit. */
export function boundedModelJson<T extends JsonRecord>(value: T): string {
    const rawRuns = Array.isArray(value.runs) ? value.runs as RunSnapshot[] : [value as unknown as RunSnapshot];
    const budgets = new Map(rawRuns.map(run => [run.runId, lineCap(run.result?.output ?? "").value.length]));
    let candidate = withOutputs(value, budgets);
    let text = JSON.stringify(candidate);
    if (bytes(text) <= MODEL_JSON_MAX_BYTES) return text;

    // Measure the final escaped JSON on every iteration; raw output length is never treated as a byte estimate.
    let low = 0;
    let high = Math.max(0, ...budgets.values());
    let best: string | undefined;
    while (low <= high) {
        const perRun = Math.floor((low + high) / 2);
        const trialBudgets = new Map([...budgets].map(([runId, maximum]) => [runId, Math.min(maximum, perRun)]));
        candidate = withOutputs(value, trialBudgets);
        text = JSON.stringify(candidate);
        if (bytes(text) <= MODEL_JSON_MAX_BYTES) {
            best = text;
            low = perRun + 1;
        } else {
            high = perRun - 1;
        }
    }
    if (best !== undefined) return best;

    text = JSON.stringify(compactEnvelope(value));
    if (bytes(text) <= MODEL_JSON_MAX_BYTES) return text;

    const resultRoot = rawRuns.length > 0 && rawRuns.every(run => dirname(run.runDirectory) === dirname(rawRuns[0]!.runDirectory))
        ? dirname(rawRuns[0]!.runDirectory)
        : undefined;
    const minimal = {
        compact: true,
        metadataOmitted: true,
        count: rawRuns.length,
        runIds: rawRuns.map(run => run.runId),
        results: resultRoot ? { resultRoot, resultFile: "result.json", runIds: rawRuns.filter(run => run.result).map(run => run.runId) } : undefined,
    };
    text = JSON.stringify(minimal);
    if (bytes(text) <= MODEL_JSON_MAX_BYTES) return text;

    // Invalid, unbounded metadata cannot defeat Pi's hard output contract.
    return JSON.stringify({ compact: true, metadataOmitted: true, count: rawRuns.length, runIds: rawRuns.slice(0, 16).map(run => run.runId) });
}

export function snapshotDetails(snapshot: RunSnapshot) {
    return {
        schemaVersion: snapshot.schemaVersion,
        runId: snapshot.runId,
        profile: snapshot.profile,
        status: snapshot.status,
        createdAt: snapshot.createdAt,
        startedAt: snapshot.startedAt,
        finishedAt: snapshot.finishedAt,
        runDirectory: snapshot.runDirectory,
        paths: snapshot.paths,
        accounting: { ...snapshot.accounting, claimedRunIds: [] as string[] },
    };
}
