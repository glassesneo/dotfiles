import { dirname } from "node:path";
import type { FailureCategory, RunSnapshot, RunState } from "./subagent_types.ts";

export const MODEL_JSON_MAX_BYTES = 50 * 1024;
const MODEL_JSON_MAX_LINES = 1500;

type JsonRecord = Record<string, unknown>;

interface MinimalRunBase {
    runId: string;
    purpose: string;
    profile: string;
}

export type MinimalRun =
    | (MinimalRunBase & { status: Exclude<RunState, "succeeded" | "failed"> })
    | (MinimalRunBase & { status: "succeeded"; output: string })
    | (MinimalRunBase & {
        status: "failed";
        error: { category: FailureCategory; message: string; exitCode?: number };
    });

export interface MinimalWait {
    reason: "polling" | "condition_met" | "timeout";
    runs: MinimalRun[];
}

const OUTPUT_TRUNCATED_NOTICE = "[Output truncated. Call subagent_get with detail=true for full result metadata.]";
const ERROR_TRUNCATED_NOTICE = "[Error message truncated. Call subagent_get with detail=true for full result metadata.]";

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
        purpose: run.purpose,
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

export function minimalRun(snapshot: RunSnapshot): MinimalRun {
    if (snapshot.status === "succeeded") {
        return { runId: snapshot.runId, purpose: snapshot.purpose, profile: snapshot.profile, status: snapshot.status, output: snapshot.result?.output ?? "" };
    }
    if (snapshot.status === "failed") {
        const error = snapshot.result?.error ?? {
            category: "protocol" as const,
            message: "Subagent failed without error metadata",
        };
        return {
            runId: snapshot.runId,
            purpose: snapshot.purpose,
            profile: snapshot.profile,
            status: snapshot.status,
            error: {
                category: error.category,
                message: error.message,
                ...(error.exitCode === undefined ? {} : { exitCode: error.exitCode }),
            },
        };
    }
    return { runId: snapshot.runId, purpose: snapshot.purpose, profile: snapshot.profile, status: snapshot.status };
}

function summaryRuns(value: MinimalRun | MinimalWait): MinimalRun[] {
    return "runs" in value ? value.runs : [value];
}

function summaryText(run: MinimalRun): string | undefined {
    if (run.status === "succeeded") return run.output;
    if (run.status === "failed") return run.error.message;
    return undefined;
}

function withSummaryBudgets<T extends MinimalRun | MinimalWait>(value: T, budgets: number[]): T {
    const clone = structuredClone(value);
    for (const [index, run] of summaryRuns(clone).entries()) {
        const original = summaryText(run);
        if (original === undefined) continue;
        const capped = lineCap(original);
        const characters = Array.from(capped.value);
        const budget = Math.max(0, budgets[index] ?? characters.length);
        const truncated = capped.truncated || budget < characters.length;
        if (!truncated) continue;
        const prefix = characters.slice(0, budget).join("");
        const notice = run.status === "succeeded" ? OUTPUT_TRUNCATED_NOTICE : ERROR_TRUNCATED_NOTICE;
        const text = prefix.length === 0 ? notice : `${prefix}\n\n${notice}`;
        if (run.status === "succeeded") run.output = text;
        else if (run.status === "failed") run.error.message = text;
    }
    return clone;
}

function compactSummary(value: MinimalRun | MinimalWait): MinimalRun | MinimalWait {
    const compactField = (field: string): string => {
        const characters = Array.from(field);
        return characters.length <= 24 ? field : `${characters.slice(0, 24).join("")}…`;
    };
    const compactRun = (run: MinimalRun): MinimalRun => {
        const base = { runId: run.runId, purpose: compactField(run.purpose), profile: compactField(run.profile) };
        if (run.status === "succeeded") return { ...base, status: run.status, output: OUTPUT_TRUNCATED_NOTICE };
        if (run.status === "failed") return {
            ...base,
            status: run.status,
            error: { ...run.error, message: ERROR_TRUNCATED_NOTICE },
        };
        return { ...base, status: run.status };
    };
    return "runs" in value
        ? { reason: value.reason, runs: value.runs.map(compactRun) }
        : compactRun(value);
}

export function boundedStartJson(snapshot: RunSnapshot): string {
    const value = { runId: snapshot.runId, purpose: snapshot.purpose, profile: snapshot.profile, status: snapshot.status };
    let text = JSON.stringify(value);
    if (bytes(text) <= MODEL_JSON_MAX_BYTES) return text;
    const profile = `${Array.from(snapshot.profile).slice(0, 32).join("")}…`;
    text = JSON.stringify({ ...value, profile });
    if (bytes(text) <= MODEL_JSON_MAX_BYTES) return text;
    return JSON.stringify({ compact: true, metadataOmitted: true, runId: snapshot.runId, status: snapshot.status });
}

/** Serialize a minimal run or wait summary as valid JSON no larger than Pi's 50KB limit. */
export function boundedSummaryJson<T extends MinimalRun | MinimalWait>(value: T): string {
    const maximums = summaryRuns(value).map(run => Array.from(lineCap(summaryText(run) ?? "").value).length);
    let text = JSON.stringify(withSummaryBudgets(value, maximums));
    if (bytes(text) <= MODEL_JSON_MAX_BYTES) return text;

    let low = 0;
    let high = Math.max(0, ...maximums);
    let best: string | undefined;
    while (low <= high) {
        const perRun = Math.floor((low + high) / 2);
        const budgets = maximums.map(maximum => Math.min(maximum, perRun));
        text = JSON.stringify(withSummaryBudgets(value, budgets));
        if (bytes(text) <= MODEL_JSON_MAX_BYTES) {
            best = text;
            low = perRun + 1;
        } else {
            high = perRun - 1;
        }
    }
    if (best !== undefined) return best;

    text = JSON.stringify(compactSummary(value));
    if (bytes(text) <= MODEL_JSON_MAX_BYTES) return text;
    return JSON.stringify({ compact: true, metadataOmitted: true, count: summaryRuns(value).length });
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

function rendererError(snapshot: RunSnapshot) {
    const error = snapshot.result?.error;
    if (!error) return undefined;
    const lines = error.message.split("\n");
    const lineBounded = lines.slice(0, 20).join("\n");
    const characters = Array.from(lineBounded);
    const truncated = lines.length > 20 || characters.length > 2048;
    const message = characters.slice(0, 2048).join("");
    return {
        category: error.category,
        message: truncated ? `${message}\n[Error preview truncated. Full metadata: ${snapshot.paths.result}]` : message,
        ...(error.exitCode === undefined ? {} : { exitCode: error.exitCode }),
    };
}

export function snapshotDetails(snapshot: RunSnapshot) {
    return {
        schemaVersion: snapshot.schemaVersion,
        runId: snapshot.runId,
        purpose: snapshot.purpose,
        profile: snapshot.profile,
        status: snapshot.status,
        createdAt: snapshot.createdAt,
        startedAt: snapshot.startedAt,
        finishedAt: snapshot.finishedAt,
        runDirectory: snapshot.runDirectory,
        paths: snapshot.paths,
        accounting: { ...snapshot.accounting, claimedRunIds: [] as string[] },
        result: snapshot.result === null ? null : {
            outcome: snapshot.result.outcome,
            error: rendererError(snapshot),
            usage: snapshot.result.usage,
            turns: snapshot.result.turns,
            startedAt: snapshot.result.startedAt,
            finishedAt: snapshot.result.finishedAt,
        },
    };
}
