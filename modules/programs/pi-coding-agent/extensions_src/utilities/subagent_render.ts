import type { Usage } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { boundedHandoffJson, boundedModelJson, boundedStartJson, boundedSummaryJson, minimalRun, snapshotDetails } from "./subagent_json.ts";
import { fallbackRunPurpose, type NormalizedRunRequest, type RunSnapshot } from "./subagent_types.ts";

export type WaitCondition = "any" | "all";
export type WaitReason = "polling" | "condition_met" | "timeout";

export interface SubagentWaitResult {
    schemaVersion: 2;
    condition: WaitCondition;
    reason: WaitReason;
    timeoutSeconds: number;
    startedAt: string;
    finishedAt: string;
    completedRunIds: string[];
    pendingRunIds: string[];
    runs: RunSnapshot[];
}

export interface ResultAccounting {
    usage?: Usage;
    claimedRunIds: string[];
}

export interface ChildHandoff {
    runId: string;
    purpose: string;
    profile: string;
    status: string;
    promptPreview: string;
    requestPath: string;
    runDirectory: string;
    paths: { request: string; result: string };
    request?: NormalizedRunRequest;
}

interface RenderResultLike {
    content?: Array<{ type?: string; text?: string }>;
    details?: unknown;
}

interface RunRenderDetails {
    runId: string;
    purpose: string;
    profile: string;
    status: string;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    paths: { result: string };
    result?: {
        error?: { category: string; message: string; exitCode?: number };
        usage?: Usage;
        turns?: number;
    } | null;
}

export function runToolResult(snapshot: RunSnapshot, accounting: ResultAccounting, detail: boolean, start = false) {
    const text = detail
        ? boundedModelJson(snapshot as unknown as Record<string, unknown>)
        : start ? boundedStartJson(snapshot) : boundedSummaryJson(minimalRun(snapshot));
    return {
        content: [{ type: "text" as const, text }],
        details: { ...snapshotDetails(snapshot), accounting: { ...snapshot.accounting, claimedRunIds: accounting.claimedRunIds } },
        usage: accounting.usage,
    };
}

export function waitToolResult(value: SubagentWaitResult, accounting: ResultAccounting, detail: boolean) {
    const text = detail
        ? boundedModelJson(value as unknown as Record<string, unknown>)
        : boundedSummaryJson({ reason: value.reason, runs: value.runs.map(minimalRun) });
    return {
        content: [{ type: "text" as const, text }],
        details: { ...value, runs: value.runs.map(snapshotDetails), accounting: { claimedRunIds: accounting.claimedRunIds } },
        usage: accounting.usage,
    };
}

export function stopToolResult(snapshot: RunSnapshot, children: ChildHandoff[], accounting: ResultAccounting, detail: boolean) {
    const modelChildren = detail ? children : children.map(child => ({
        runId: child.runId,
        purpose: child.purpose,
        profile: child.profile,
        status: child.status,
        promptPreview: child.promptPreview,
    }));
    const payload = {
        run: detail ? snapshot : minimalRun(snapshot),
        children: modelChildren,
        guidance: "Immediate children continue independently; choose get/wait, take over, or stop each child explicitly.",
    };
    return {
        content: [{ type: "text" as const, text: boundedHandoffJson(payload) }],
        details: {
            schemaVersion: 1, run: snapshotDetails(snapshot), children,
            accounting: { ...snapshot.accounting, claimedRunIds: accounting.claimedRunIds },
        },
        usage: accounting.usage,
    };
}

export function previewText(value: string, maximumLines = 3, maximumCharacters = 512): { lines: string[]; truncated: boolean } {
    const lines = value.split("\n");
    const selected = lines.slice(0, maximumLines);
    const characters = Array.from(selected.join("\n"));
    const truncated = lines.length > maximumLines || characters.length > maximumCharacters;
    return { lines: Array.from(characters.slice(0, maximumCharacters).join("").split("\n")), truncated };
}

export function childPromptPreview(prompt: string): string {
    const preview = previewText(prompt);
    return `${preview.lines.join("\n")}${preview.truncated ? "\n… prompt preview truncated" : ""}`;
}

function rawResultText(result: RenderResultLike): string {
    return result.content?.filter(part => part.type === "text" && typeof part.text === "string").map(part => part.text).join("\n") ?? "";
}

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function runDetails(value: unknown): RunRenderDetails | undefined {
    const item = record(value);
    const paths = record(item?.paths);
    if (!item || (item.schemaVersion !== 2 && item.schemaVersion !== 3) || typeof item.runId !== "string" || typeof item.purpose !== "string" || typeof item.profile !== "string"
        || typeof item.status !== "string" || typeof item.createdAt !== "string" || typeof paths?.result !== "string") return undefined;
    return item as unknown as RunRenderDetails;
}

function parsedContent(result: RenderResultLike): Record<string, unknown> | undefined {
    try { return record(JSON.parse(rawResultText(result))); }
    catch { return undefined; }
}

function statusDisplay(status: string, theme: Theme): string {
    if (status === "succeeded") return theme.fg("success", "✓ succeeded");
    if (status === "failed") return theme.fg("error", "✗ failed");
    if (status === "stopped") return theme.fg("warning", "■ stopped");
    return theme.fg("warning", `● ${status}`);
}

function durationDisplay(details: RunRenderDetails): string {
    const start = Date.parse(details.startedAt ?? details.createdAt);
    const end = details.finishedAt === undefined ? Date.now() : Date.parse(details.finishedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return "unknown duration";
    const milliseconds = Math.max(0, end - start);
    if (milliseconds < 1000) return `${milliseconds}ms`;
    if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`;
    return `${(milliseconds / 60_000).toFixed(1)}m`;
}

function usageDisplay(usage: Usage | undefined): string | undefined {
    if (!usage) return undefined;
    const tokens = usage.totalTokens ?? usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    return `usage: ${tokens} tokens, $${usage.cost.total.toFixed(4)}`;
}

function outputFromContent(content: Record<string, unknown> | undefined): string | undefined {
    const direct = typeof content?.output === "string" ? content.output : undefined;
    if (direct !== undefined) return direct;
    const result = record(content?.result);
    return typeof result?.output === "string" ? result.output : undefined;
}

function errorFromContent(content: Record<string, unknown> | undefined): { category: string; message: string; exitCode?: number } | undefined {
    const direct = record(content?.error);
    const nested = record(record(content?.result)?.error);
    const error = direct ?? nested;
    if (!error || typeof error.category !== "string" || typeof error.message !== "string") return undefined;
    return { category: error.category, message: error.message, ...(typeof error.exitCode === "number" ? { exitCode: error.exitCode } : {}) };
}

export function renderRunResult(result: RenderResultLike, expanded: boolean, theme: Theme): Text {
    try {
        const details = runDetails(result.details);
        const content = parsedContent(result);
        if (!details || !content) return new Text(rawResultText(result), 0, 0);
        const lines = [
            `${theme.fg("accent", details.purpose)} — ${statusDisplay(details.status, theme)}`,
            `${theme.fg("muted", details.profile)} · ${durationDisplay(details)}`,
        ];
        if (details.status === "succeeded" || details.status === "stopped") {
            const output = outputFromContent(content) ?? "";
            const preview = expanded ? { lines: output.split("\n"), truncated: false } : previewText(output);
            if (preview.lines.length > 0 && preview.lines.some(line => line.length > 0)) lines.push(...preview.lines.map(line => `  ${line}`));
            if (preview.truncated) lines.push(theme.fg("dim", "  … preview truncated"));
        } else if (details.status === "failed") {
            const error = errorFromContent(content) ?? details.result?.error;
            if (error) {
                const message = `${error.category}: ${error.message}${error.exitCode === undefined ? "" : ` (exit ${error.exitCode})`}`;
                const preview = expanded ? { lines: message.split("\n"), truncated: false } : previewText(message);
                lines.push(...preview.lines.map(line => theme.fg("error", line)));
                if (preview.truncated) lines.push(theme.fg("dim", "… error preview truncated"));
            }
            if (!expanded) lines.push(theme.fg("dim", "Call subagent_get with detail=true for full metadata."));
        }
        const usage = usageDisplay(details.result?.usage);
        if (usage) lines.push(theme.fg("dim", usage));
        if (expanded) {
            lines.push(theme.fg("dim", `run: ${details.runId}`));
            lines.push(theme.fg("dim", `created: ${details.createdAt}`));
            if (details.startedAt) lines.push(theme.fg("dim", `started: ${details.startedAt}`));
            if (details.finishedAt) lines.push(theme.fg("dim", `finished: ${details.finishedAt}`));
            lines.push(theme.fg("dim", `result: ${details.paths.result}`));
        }
        return new Text(lines.join("\n"), 0, 0);
    } catch {
        return new Text(rawResultText(result), 0, 0);
    }
}

export function renderWaitResult(result: RenderResultLike, expanded: boolean, theme: Theme): Text {
    try {
        const details = record(result.details);
        if (!details || details.schemaVersion !== 2 || !Array.isArray(details.runs) || !Array.isArray(details.completedRunIds) || !Array.isArray(details.pendingRunIds)) {
            return new Text(rawResultText(result), 0, 0);
        }
        const content = parsedContent(result);
        if (!content) return new Text(rawResultText(result), 0, 0);
        const contentRuns = Array.isArray(content.runs) ? content.runs.map(record) : [];
        const runs = details.runs.map((value, index) => {
            const run = runDetails(value);
            if (!run) throw new Error("Malformed wait run details");
            const modelRun = contentRuns.find(item => item?.runId === run.runId) ?? contentRuns[index];
            const line = `${statusDisplay(run.status, theme)} ${theme.fg("accent", run.purpose)} ${theme.fg("muted", `(${run.profile}, ${durationDisplay(run)})`)}`;
            const output = outputFromContent(modelRun);
            const error = errorFromContent(modelRun) ?? run.result?.error;
            if (!expanded) {
                const previewSource = output ?? (error ? `${error.category}: ${error.message}` : undefined);
                if (!previewSource) return line;
                const preview = previewText(previewSource);
                return [line, ...preview.lines.map(part => `  ${part}`), ...(preview.truncated ? [theme.fg("dim", "  … preview truncated")] : [])].join("\n");
            }
            const additions = [
                line, `  run: ${run.runId}`, `  duration: ${durationDisplay(run)}`, `  created: ${run.createdAt}`,
                ...(run.startedAt ? [`  started: ${run.startedAt}`] : []), ...(run.finishedAt ? [`  finished: ${run.finishedAt}`] : []),
            ];
            if (output) additions.push(...output.split("\n").map(part => `  ${part}`));
            if (error) additions.push(`  ${error.category}: ${error.message}`);
            const usage = usageDisplay(run.result?.usage);
            if (usage) additions.push(`  ${usage}`);
            additions.push(`  result: ${run.paths.result}`);
            return additions.join("\n");
        });
        const reason = String((details.reason ?? "polling") as string | number | boolean | bigint | symbol);
        const heading = `${reason} — ${details.completedRunIds.length} completed, ${details.pendingRunIds.length} pending`;
        return new Text(`${theme.fg("accent", heading)}\n${runs.join("\n")}`, 0, 0);
    } catch {
        return new Text(rawResultText(result), 0, 0);
    }
}

export function renderStopResult(result: RenderResultLike, expanded: boolean, theme: Theme): Text {
    try {
        const details = record(result.details);
        const run = runDetails(details?.run);
        const children = Array.isArray(details?.children) ? details.children.map(record) : [];
        if (!run || children.some(child => !child)) return new Text(rawResultText(result), 0, 0);
        const lines = [
            `${theme.fg("accent", run.purpose)} — ${statusDisplay(run.status, theme)}`,
            `${theme.fg("muted", run.profile)} · ${durationDisplay(run)}`,
            theme.fg("muted", `${children.length} immediate child${children.length === 1 ? "" : "ren"} handed off`),
        ];
        for (const child of children) {
            lines.push(`  ${statusDisplay(String(child!.status), theme)} ${theme.fg("accent", String(child!.purpose))} ${theme.fg("muted", `(${String(child!.profile)}, ${String(child!.runId).slice(0, expanded ? undefined : 8)})`)}`);
            const preview = typeof child!.promptPreview === "string" ? child!.promptPreview : "";
            if (preview) lines.push(...preview.split("\n").map(part => `    ${part}`));
            if (expanded && typeof child!.requestPath === "string") lines.push(theme.fg("dim", `    request: ${String(child!.requestPath)}`));
        }
        return new Text(lines.join("\n"), 0, 0);
    } catch {
        return new Text(rawResultText(result), 0, 0);
    }
}

export function renderStartCall(args: { profile: string; purpose?: string; prompt: string }, expanded: boolean, theme: Theme): Text {
    try {
        const purpose = typeof args.purpose === "string" ? args.purpose : fallbackRunPurpose(args.prompt);
        let text = `${theme.fg("toolTitle", theme.bold("subagent_start"))} ${theme.fg("muted", args.profile)} — ${theme.fg("accent", purpose)}`;
        if (expanded) text += `\n${args.prompt}`;
        else {
            const preview = previewText(args.prompt);
            text += `\n${preview.lines.map(line => `  ${line}`).join("\n")}`;
            if (preview.truncated) text += theme.fg("dim", "\n  … prompt preview truncated");
        }
        return new Text(text, 0, 0);
    } catch {
        return new Text("subagent_start", 0, 0);
    }
}

export function renderRunIdCall(toolName: "subagent_get" | "subagent_stop", runId: string, expanded: boolean, theme: Theme): Text {
    try {
        return new Text(`${theme.fg("toolTitle", theme.bold(toolName))} ${theme.fg("muted", expanded ? runId : runId.slice(0, 8))}`, 0, 0);
    } catch {
        return new Text(toolName, 0, 0);
    }
}

export function renderWaitCall(args: { runIds: string[]; condition: string }, expanded: boolean, theme: Theme): Text {
    try {
        const ids = expanded ? `\n${args.runIds.join("\n")}` : "";
        return new Text(`${theme.fg("toolTitle", theme.bold("subagent_wait"))} ${theme.fg("muted", `${args.condition} · ${args.runIds.length} runs`)}${ids}`, 0, 0);
    } catch {
        return new Text("subagent_wait", 0, 0);
    }
}
