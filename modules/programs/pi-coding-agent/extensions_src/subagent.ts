import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { StringEnum, type Usage } from "@earendil-works/pi-ai";
import {
    defineTool,
    getAgentDir,
    type ExtensionAPI,
    type ExtensionContext,
    type Theme,
    type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { loadAgentProfileConfig } from "./profile.ts";
import { onActiveProfile } from "./utilities/profile_events.ts";
import { boundedHandoffJson, boundedModelJson, boundedStartJson, boundedSummaryJson, minimalRun, snapshotDetails } from "./utilities/subagent_json.ts";
import { withRunLock } from "./utilities/subagent_lock.ts";
import {
    assertRunOrigin,
    attachTmux,
    claimRunUsage,
    createRun,
    failRun,
    finishStoppedRun,
    immediateChildRequests,
    patchStatus,
    readSnapshot,
    readStatus,
    releaseRunUsageClaim,
    requestRunStop,
    runPaths,
} from "./utilities/subagent_store.ts";
import { isTmuxPaneAlive, killTmuxPane, launchTmuxWindow, probeTmux, type CommandExecutor } from "./utilities/subagent_tmux.ts";
import {
    addUsage,
    emptyUsage,
    fallbackRunPurpose,
    isTerminalState,
    parseSubagentFacet,
    PURPOSE_MAX_LENGTH,
    validateSubagentRuntimeConfig,
    type NormalizedRunRequest,
    type RunSnapshot,
    type SubagentFacet,
    type SubagentRuntimeConfig,
} from "./utilities/subagent_types.ts";

const DEFAULT_CONFIG_PATH = join(getAgentDir(), "subagent.json");
const DEFAULT_PROFILE_CONFIG_PATH = join(getAgentDir(), "agent-profiles.json");

const detailParameter = Type.Optional(Type.Boolean({
    default: false,
    description: "Include the full persisted snapshot metadata and file paths in model-visible content. Internal tool details are always retained.",
}));
const startParameters = Type.Object({
    profile: Type.String({ minLength: 1, description: "Semantic subagent profile name" }),
    purpose: Type.String({ minLength: 1, maxLength: PURPOSE_MAX_LENGTH, description: "Short display purpose for this delegated run" }),
    prompt: Type.String({ minLength: 1, description: "Task prompt delegated to the subagent" }),
    detail: detailParameter,
});
const getParameters = Type.Object({
    runId: Type.String({ description: "UUID returned by subagent_start" }),
    detail: detailParameter,
});
const waitParameters = Type.Object({
    runIds: Type.Array(Type.String({ description: "UUID returned by subagent_start" }), { minItems: 1, maxItems: 128, uniqueItems: true }),
    condition: StringEnum(["any", "all"] as const),
    timeoutSeconds: Type.Integer({ minimum: 1, maximum: 3600 }),
    detail: detailParameter,
});
const stopParameters = Type.Object({
    runId: Type.String({ description: "UUID of the single subagent run to stop" }),
    detail: detailParameter,
});

type WaitCondition = "any" | "all";
type WaitReason = "polling" | "condition_met" | "timeout";

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

export interface ActiveSubagentProfile {
    name: string;
    facet?: SubagentFacet;
    error?: string;
}

export interface SubagentDependencies {
    configPath: string;
    profileConfigPath?: string;
    env: NodeJS.ProcessEnv;
    exec: CommandExecutor;
    activeProfile?: () => ActiveSubagentProfile | undefined;
    monotonicNow?: () => number;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export async function loadSubagentConfig(path: string): Promise<SubagentRuntimeConfig> {
    let value: unknown;
    try { value = JSON.parse(await readFile(path, "utf8")); }
    catch (error) { throw new Error(`Cannot read subagent config ${path}: ${error instanceof Error ? error.message : String(error)}`); }
    return validateSubagentRuntimeConfig(value);
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    if (signal.reason instanceof Error) throw signal.reason;
    throw new Error("Subagent wait cancelled");
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, milliseconds);
        const onAbort = () => {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", onAbort);
            reject(signal?.reason instanceof Error ? signal.reason : new Error("Subagent wait cancelled"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

async function readReconciledSnapshot(deps: SubagentDependencies, stateRoot: string, runId: string): Promise<RunSnapshot> {
    const paths = runPaths(stateRoot, runId);
    let snapshot = await readSnapshot(stateRoot, runId);
    if (!isTerminalState(snapshot.status)) {
        const alive = snapshot.tmux ? await isTmuxPaneAlive(deps.exec, snapshot.tmux.paneId) : false;
        if (!alive) {
            if (snapshot.status === "stopping") await finishStoppedRun(paths, "forced");
            else await failRun(paths, { category: "runner_lost", message: "The tmux runner pane disappeared before the run reached a terminal state" });
            snapshot = await readSnapshot(stateRoot, runId);
        }
    }
    return snapshot;
}

function origin(ctx: ExtensionContext, env: NodeJS.ProcessEnv) {
    const depth = Number.parseInt(env.PI_SUBAGENT_DEPTH ?? "0", 10);
    return {
        depth: Number.isInteger(depth) && depth >= 0 ? depth : 0,
        parentRunId: env.PI_SUBAGENT_RUN_ID,
        originSessionId: env.PI_SUBAGENT_ORIGIN_SESSION_ID ?? ctx.sessionManager.getSessionId(),
        originSessionFile: env.PI_SUBAGENT_ORIGIN_SESSION_FILE ?? ctx.sessionManager.getSessionFile(),
    };
}

interface UsageClaimOperations {
    claim: typeof claimRunUsage;
    release: typeof releaseRunUsageClaim;
}

export async function claimUsageBatch(
    stateRoot: string,
    snapshots: RunSnapshot[],
    sessionId: string,
    toolCallId: string,
    toolName: "subagent_start" | "subagent_get" | "subagent_wait" | "subagent_stop",
    operations: UsageClaimOperations = { claim: claimRunUsage, release: releaseRunUsageClaim },
): Promise<{ usage?: Usage; claimedRunIds: string[] }> {
    const aggregate = emptyUsage();
    const claimedRunIds: string[] = [];
    try {
        for (const snapshot of snapshots) {
            if (!isTerminalState(snapshot.status) || !snapshot.result || snapshot.accounting.claimed) continue;
            try {
                const claimed = await operations.claim(stateRoot, snapshot.runId, sessionId, toolCallId, toolName);
                if (!claimed.created) continue;
                addUsage(aggregate, claimed.result.usage);
                claimedRunIds.push(snapshot.runId);
            } catch (error) {
                if (error instanceof Error && error.message.includes("different origin session")) continue;
                throw error;
            }
        }
    } catch (error) {
        const rollbacks = await Promise.allSettled(
            claimedRunIds.map(runId => operations.release(stateRoot, runId, sessionId, toolCallId)),
        );
        const rollbackErrors = rollbacks.flatMap(result => result.status === "rejected" ? [result.reason] : []);
        if (rollbackErrors.length > 0) throw new AggregateError([error, ...rollbackErrors], "Usage claim batch failed and could not be fully rolled back");
        throw error;
    }
    return { usage: claimedRunIds.length > 0 ? aggregate : undefined, claimedRunIds };
}

async function claimedUsage(
    config: SubagentRuntimeConfig,
    snapshots: RunSnapshot[],
    ctx: ExtensionContext,
    env: NodeJS.ProcessEnv,
    toolCallId: string,
    toolName: "subagent_start" | "subagent_get" | "subagent_wait" | "subagent_stop",
): Promise<{ usage?: Usage; claimedRunIds: string[] }> {
    return claimUsageBatch(config.stateRoot, snapshots, origin(ctx, env).originSessionId, toolCallId, toolName);
}

function runToolResult(
    snapshot: RunSnapshot,
    accounting: { usage?: Usage; claimedRunIds: string[] },
    detail: boolean,
    start = false,
) {
    const text = detail
        ? boundedModelJson(snapshot as unknown as Record<string, unknown>)
        : start ? boundedStartJson(snapshot) : boundedSummaryJson(minimalRun(snapshot));
    return {
        content: [{ type: "text" as const, text }],
        details: { ...snapshotDetails(snapshot), accounting: { ...snapshot.accounting, claimedRunIds: accounting.claimedRunIds } },
        usage: accounting.usage,
    };
}

function waitToolResult(value: SubagentWaitResult, accounting: { usage?: Usage; claimedRunIds: string[] }, detail: boolean) {
    const text = detail
        ? boundedModelJson(value as unknown as Record<string, unknown>)
        : boundedSummaryJson({ reason: value.reason, runs: value.runs.map(minimalRun) });
    return {
        content: [{ type: "text" as const, text }],
        details: { ...value, runs: value.runs.map(snapshotDetails), accounting: { claimedRunIds: accounting.claimedRunIds } },
        usage: accounting.usage,
    };
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

function previewText(value: string, maximumLines = 3, maximumCharacters = 512): { lines: string[]; truncated: boolean } {
    const lines = value.split("\n");
    const selected = lines.slice(0, maximumLines);
    const joined = selected.join("\n");
    const characters = Array.from(joined);
    const truncated = lines.length > maximumLines || characters.length > maximumCharacters;
    return { lines: Array.from(characters.slice(0, maximumCharacters).join("").split("\n")), truncated };
}

function errorFromContent(content: Record<string, unknown> | undefined): { category: string; message: string; exitCode?: number } | undefined {
    const direct = record(content?.error);
    const nested = record(record(content?.result)?.error);
    const error = direct ?? nested;
    if (!error || typeof error.category !== "string" || typeof error.message !== "string") return undefined;
    return { category: error.category, message: error.message, ...(typeof error.exitCode === "number" ? { exitCode: error.exitCode } : {}) };
}

function renderRunResult(result: RenderResultLike, expanded: boolean, theme: Theme): Text {
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

function renderWaitResult(result: RenderResultLike, expanded: boolean, theme: Theme): Text {
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
                return [
                    line,
                    ...preview.lines.map(part => `  ${part}`),
                    ...(preview.truncated ? [theme.fg("dim", "  … preview truncated")] : []),
                ].join("\n");
            }
            const additions = [
                line,
                `  run: ${run.runId}`,
                `  duration: ${durationDisplay(run)}`,
                `  created: ${run.createdAt}`,
                ...(run.startedAt ? [`  started: ${run.startedAt}`] : []),
                ...(run.finishedAt ? [`  finished: ${run.finishedAt}`] : []),
            ];
            if (output) additions.push(...output.split("\n").map(part => `  ${part}`));
            if (error) additions.push(`  ${error.category}: ${error.message}`);
            const usage = usageDisplay(run.result?.usage);
            if (usage) additions.push(`  ${usage}`);
            additions.push(`  result: ${run.paths.result}`);
            return additions.join("\n");
        });
        const heading = `${String(details.reason ?? "polling")} — ${details.completedRunIds.length} completed, ${details.pendingRunIds.length} pending`;
        return new Text(`${theme.fg("accent", heading)}\n${runs.join("\n")}`, 0, 0);
    } catch {
        return new Text(rawResultText(result), 0, 0);
    }
}

export function createSubagentStartTool(deps: SubagentDependencies): ToolDefinition<typeof startParameters, ReturnType<typeof snapshotDetails>> {
    return defineTool({
        name: "subagent_start", label: "Start subagent",
        description: "Start one profiled subagent in a detached tmux window without waiting for completion. Returns its run ID, purpose, profile, and status by default; set detail=true for the full persisted snapshot metadata and file paths.",
        promptSnippet: "Start an asynchronous profiled subagent and return its observable run summary",
        promptGuidelines: ["Use subagent_start with a semantic profile, a short purpose, and a complete task prompt; after it returns, continue useful independent main-agent work. Use subagent_wait only when the result is needed for the next work and no useful independent work remains."],
        parameters: startParameters,
        prepareArguments(args): Static<typeof startParameters> {
            if (args === null || typeof args !== "object" || Array.isArray(args)) return args as Static<typeof startParameters>;
            const input = args as { purpose?: unknown; prompt?: unknown };
            if (input.purpose !== undefined || typeof input.prompt !== "string") return args as Static<typeof startParameters>;
            return { ...input, purpose: fallbackRunPurpose(input.prompt) } as Static<typeof startParameters>;
        },
        executionMode: "sequential",
        renderCall(args, theme, context) {
            try {
                const purpose = typeof args.purpose === "string" ? args.purpose : fallbackRunPurpose(args.prompt);
                let text = `${theme.fg("toolTitle", theme.bold("subagent_start"))} ${theme.fg("muted", args.profile)} — ${theme.fg("accent", purpose)}`;
                if (context.expanded) {
                    text += `\n${args.prompt}`;
                } else {
                    const preview = previewText(args.prompt);
                    text += `\n${preview.lines.map(line => `  ${line}`).join("\n")}`;
                    if (preview.truncated) text += theme.fg("dim", "\n  … prompt preview truncated");
                }
                return new Text(text, 0, 0);
            } catch { return new Text("subagent_start", 0, 0); }
        },
        renderResult(result, options, theme) { return renderRunResult(result, options.expanded, theme); },
        async execute(toolCallId, params, _signal, _onUpdate, ctx) {
            const config = await loadSubagentConfig(deps.configPath);
            const profiles = await loadAgentProfileConfig(deps.profileConfigPath ?? DEFAULT_PROFILE_CONFIG_PATH, deps.env);
            const active = deps.activeProfile?.();
            if (!active) throw new Error("Subagent configuration unavailable: no active-profile event has been received");
            if (active.error) throw new Error(`Subagent configuration unavailable: ${active.error}`);
            const allowedTargets = active.facet?.allowedTargets ?? [];
            const targetProfile = profiles.profiles[params.profile];
            if (!targetProfile) throw new Error(`Unknown subagent profile: ${params.profile}`);
            if (!allowedTargets.includes(params.profile)) {
                throw new Error(`Profile ${active.name} is not allowed to start subagent profile ${params.profile}`);
            }
            const current = origin(ctx, deps.env);
            const childDepth = current.depth + 1;
            if (childDepth > config.maxDepth) throw new Error(`Subagent depth ${childDepth} exceeds maxDepth ${config.maxDepth}`);
            const tmuxContext = await probeTmux(deps.exec, deps.env);
            if (!tmuxContext) throw new Error("The current Pi process is no longer attached to a usable tmux session");

            const createAttachedRun = async () => {
                if (current.parentRunId) {
                    const parentStatus = await readStatus(runPaths(config.stateRoot, current.parentRunId));
                    if (parentStatus.status === "stopping" || isTerminalState(parentStatus.status)) {
                        throw new Error(`Parent subagent ${current.parentRunId} is no longer runnable`);
                    }
                }
                const run = await createRun(config, params.profile, targetProfile, params.purpose, params.prompt, ctx.cwd, {
                    callerProfile: active.name, depth: childDepth, parentRunId: current.parentRunId,
                    originSessionId: current.originSessionId, originSessionFile: current.originSessionFile,
                });
                await patchStatus(run.paths, { status: "starting" });
                try {
                    const tmux = await launchTmuxWindow(deps.exec, tmuxContext, { runId: run.request.runId, cwd: ctx.cwd, launcher: run.paths.launcher });
                    await attachTmux(run.paths, tmux);
                } catch (error) {
                    await failRun(run.paths, { category: "launch", message: error instanceof Error ? error.message : String(error) });
                }
                return run;
            };
            const run = current.parentRunId
                ? await withRunLock(runPaths(config.stateRoot, current.parentRunId).directory, createAttachedRun)
                : await createAttachedRun();
            const snapshot = await readSnapshot(config.stateRoot, run.request.runId);
            return runToolResult(snapshot, await claimedUsage(config, [snapshot], ctx, deps.env, toolCallId, "subagent_start"), params.detail === true, true);
        },
    });
}

interface ChildHandoff {
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

function childPromptPreview(prompt: string): string {
    const preview = previewText(prompt);
    return `${preview.lines.join("\n")}${preview.truncated ? "\n… prompt preview truncated" : ""}`;
}

async function childHandoffs(config: SubagentRuntimeConfig, parent: NormalizedRunRequest, detail: boolean): Promise<ChildHandoff[]> {
    const requests = await immediateChildRequests(config.stateRoot, parent);
    return Promise.all(requests.map(async request => {
        const paths = runPaths(config.stateRoot, request.runId);
        const status = await readStatus(paths).then(value => value.status).catch(() => "unknown");
        return {
            runId: request.runId, purpose: request.purpose, profile: request.profile, status,
            promptPreview: childPromptPreview(request.prompt), requestPath: paths.request,
            runDirectory: paths.directory, paths: { request: paths.request, result: paths.result },
            ...(detail ? { request } : {}),
        };
    }));
}

function renderStopResult(result: RenderResultLike, expanded: boolean, theme: Theme): Text {
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
    } catch { return new Text(rawResultText(result), 0, 0); }
}

export function createSubagentStopTool(deps: SubagentDependencies): ToolDefinition<typeof stopParameters, Record<string, unknown>> {
    return defineTool({
        name: "subagent_stop", label: "Stop subagent",
        description: "Stop exactly one subagent run from the same origin session. Immediate children are not stopped; the terminal result returns their run IDs, status, purpose, profile, and prompt preview for explicit handoff.",
        promptSnippet: "Stop one subagent run without recursively stopping its children",
        promptGuidelines: ["After subagent_stop, decide for every handed-off immediate child whether to continue with subagent_get or subagent_wait, take over its work, or stop that child individually with subagent_stop."],
        parameters: stopParameters, executionMode: "sequential",
        renderCall(args, theme, context) {
            try { return new Text(`${theme.fg("toolTitle", theme.bold("subagent_stop"))} ${theme.fg("muted", context.expanded ? args.runId : args.runId.slice(0, 8))}`, 0, 0); }
            catch { return new Text("subagent_stop", 0, 0); }
        },
        renderResult(result, options, theme) { return renderStopResult(result, options.expanded, theme); },
        async execute(toolCallId, params, signal, _onUpdate, ctx) {
            throwIfAborted(signal);
            const config = await loadSubagentConfig(deps.configPath);
            const originSessionId = origin(ctx, deps.env).originSessionId;
            const parent = await assertRunOrigin(config.stateRoot, params.runId, originSessionId);
            const paths = runPaths(config.stateRoot, params.runId);
            await requestRunStop(paths);

            const sleep = deps.sleep ?? abortableSleep;
            const deadline = (deps.monotonicNow?.() ?? performance.now()) + 2500;
            let snapshot = await readSnapshot(config.stateRoot, params.runId);
            while (!isTerminalState(snapshot.status) && (deps.monotonicNow?.() ?? performance.now()) < deadline) {
                throwIfAborted(signal);
                await sleep(50, signal);
                snapshot = await readSnapshot(config.stateRoot, params.runId);
            }
            if (!isTerminalState(snapshot.status)) {
                const status = await readStatus(paths);
                if (status.tmux && await isTmuxPaneAlive(deps.exec, status.tmux.paneId)) await killTmuxPane(deps.exec, status.tmux.paneId);
                await finishStoppedRun(paths, "forced");
                snapshot = await readSnapshot(config.stateRoot, params.runId);
            }
            if (!isTerminalState(snapshot.status)) throw new Error(`Run ${params.runId} could not be terminalized; current status is ${snapshot.status}`);

            const children = await childHandoffs(config, parent, true);
            const modelChildren = params.detail === true ? children : children.map(child => ({
                runId: child.runId,
                purpose: child.purpose,
                profile: child.profile,
                status: child.status,
                promptPreview: child.promptPreview,
            }));
            const accounting = await claimedUsage(config, [snapshot], ctx, deps.env, toolCallId, "subagent_stop");
            const payload = {
                run: params.detail === true ? snapshot : minimalRun(snapshot),
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
        },
    });
}

export function createSubagentGetTool(deps: SubagentDependencies): ToolDefinition<typeof getParameters, ReturnType<typeof snapshotDetails>> {
    return defineTool({
        name: "subagent_get", label: "Get subagent run",
        description: "Read one subagent run's current persisted state without waiting. Returns an actionable run summary by default; set detail=true for the full persisted snapshot metadata and file paths. Full logs remain in those files.",
        promptSnippet: "Read one subagent run's current state once without waiting",
        promptGuidelines: ["Use subagent_get for a one-time non-blocking status check or to retrieve an already completed result."],
        parameters: getParameters, executionMode: "sequential",
        renderCall(args, theme, context) {
            try { return new Text(`${theme.fg("toolTitle", theme.bold("subagent_get"))} ${theme.fg("muted", context.expanded ? args.runId : args.runId.slice(0, 8))}`, 0, 0); }
            catch { return new Text("subagent_get", 0, 0); }
        },
        renderResult(result, options, theme) { return renderRunResult(result, options.expanded, theme); },
        async execute(toolCallId, params, _signal, _onUpdate, ctx) {
            const config = await loadSubagentConfig(deps.configPath);
            await assertRunOrigin(config.stateRoot, params.runId, origin(ctx, deps.env).originSessionId);
            const snapshot = await readReconciledSnapshot(deps, config.stateRoot, params.runId);
            return runToolResult(snapshot, await claimedUsage(config, [snapshot], ctx, deps.env, toolCallId, "subagent_get"), params.detail === true);
        },
    });
}

export function createSubagentWaitTool(deps: SubagentDependencies): ToolDefinition<
    typeof waitParameters,
    Omit<SubagentWaitResult, "runs"> & { runs: ReturnType<typeof snapshotDetails>[]; accounting: { claimedRunIds: string[] } }
> {
    return defineTool({
        name: "subagent_wait", label: "Wait for subagents",
        description: "Wait until any or all specified subagent runs reach a terminal state, or until timeout. Returns the reason and actionable run summaries by default; set detail=true for full persisted snapshots and file paths. Timeout is a normal result.",
        promptSnippet: "Wait for any or all selected subagent runs to reach a terminal state",
        promptGuidelines: ["Use subagent_wait on its own only when no useful independent work remains and one or more delegated results are needed; use subagent_get instead for a one-time non-blocking status check."],
        parameters: waitParameters, executionMode: "sequential",
        renderCall(args, theme, context) {
            try {
                const ids = context.expanded ? `\n${args.runIds.join("\n")}` : "";
                return new Text(`${theme.fg("toolTitle", theme.bold("subagent_wait"))} ${theme.fg("muted", `${args.condition} · ${args.runIds.length} runs`)}${ids}`, 0, 0);
            } catch { return new Text("subagent_wait", 0, 0); }
        },
        renderResult(result, options, theme) { return renderWaitResult(result, options.expanded, theme); },
        async execute(toolCallId, params, signal, onUpdate, ctx) {
            throwIfAborted(signal);
            if (new Set(params.runIds).size !== params.runIds.length) throw new Error("subagent_wait runIds must not contain duplicates");
            const config = await loadSubagentConfig(deps.configPath);
            const originSessionId = origin(ctx, deps.env).originSessionId;
            for (const runId of params.runIds) {
                throwIfAborted(signal);
                await assertRunOrigin(config.stateRoot, runId, originSessionId);
                await readSnapshot(config.stateRoot, runId);
            }
            const monotonicNow = deps.monotonicNow ?? (() => performance.now());
            const sleep = deps.sleep ?? abortableSleep;
            const startedAt = new Date().toISOString();
            const deadline = monotonicNow() + params.timeoutSeconds * 1000;

            while (true) {
                throwIfAborted(signal);
                const runs: RunSnapshot[] = [];
                for (const runId of params.runIds) { throwIfAborted(signal); runs.push(await readReconciledSnapshot(deps, config.stateRoot, runId)); }
                const completedRunIds = runs.filter(snapshot => isTerminalState(snapshot.status)).map(snapshot => snapshot.runId);
                const completed = new Set(completedRunIds);
                const pendingRunIds = params.runIds.filter(runId => !completed.has(runId));
                const current: SubagentWaitResult = {
                    schemaVersion: 2, condition: params.condition, reason: "polling",
                    timeoutSeconds: params.timeoutSeconds, startedAt, finishedAt: new Date().toISOString(),
                    completedRunIds, pendingRunIds, runs,
                };
                onUpdate?.(waitToolResult(current, { claimedRunIds: [] }, params.detail === true));
                const conditionMet = params.condition === "any" ? completedRunIds.length > 0 : pendingRunIds.length === 0;
                const timedOut = monotonicNow() >= deadline;
                if (conditionMet || timedOut) {
                    const value: SubagentWaitResult = {
                        ...current, reason: conditionMet ? "condition_met" : "timeout", finishedAt: new Date().toISOString(),
                    };
                    const accounting = await claimedUsage(config, runs, ctx, deps.env, toolCallId, "subagent_wait");
                    return waitToolResult(value, accounting, params.detail === true);
                }
                await sleep(Math.min(1000, deadline - monotonicNow()), signal);
            }
        },
    });
}

async function reconcileSessionAccounting(config: SubagentRuntimeConfig, ctx: ExtensionContext): Promise<void> {
    const sessionId = ctx.sessionManager.getSessionId();
    for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type !== "message" || entry.message.role !== "toolResult" || !entry.message.usage) continue;
        const toolName = entry.message.toolName;
        if (toolName !== "subagent_start" && toolName !== "subagent_get" && toolName !== "subagent_wait" && toolName !== "subagent_stop") continue;
        const details = entry.message.details as { accounting?: { claimedRunIds?: unknown } } | undefined;
        const runIds = details?.accounting?.claimedRunIds;
        if (!Array.isArray(runIds)) continue;
        for (const runId of runIds) {
            if (typeof runId !== "string") continue;
            await claimRunUsage(config.stateRoot, runId, sessionId, entry.message.toolCallId, toolName);
        }
    }
}

export async function registerSubagent(
    pi: ExtensionAPI,
    options: Partial<Pick<SubagentDependencies, "configPath" | "profileConfigPath" | "env">> = {},
): Promise<boolean> {
    const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;
    const profileConfigPath = options.profileConfigPath ?? DEFAULT_PROFILE_CONFIG_PATH;
    const env = options.env ?? process.env;
    let activeProfile: ActiveSubagentProfile | undefined;
    onActiveProfile(
        pi,
        event => {
            const rawFacet = event.profile.extensions.subagent;
            if (rawFacet === undefined) {
                activeProfile = { name: event.name, facet: { allowedTargets: [] } };
                return;
            }
            try { activeProfile = { name: event.name, facet: parseSubagentFacet(rawFacet) }; }
            catch (error) { activeProfile = { name: event.name, error: error instanceof Error ? error.message : String(error) }; }
        },
        error => { activeProfile = { name: "unknown", error: error.message }; },
    );
    const exec: CommandExecutor = async (command, args) => {
        const output = await pi.exec(command, args);
        return { stdout: output.stdout, stderr: output.stderr, code: output.code };
    };
    const deps: SubagentDependencies = { configPath, profileConfigPath, env, exec, activeProfile: () => activeProfile };
    pi.on("before_agent_start", async event => {
        if (!activeProfile?.facet || activeProfile.error || !pi.getActiveTools().includes("subagent_start")) return;
        const profiles = await loadAgentProfileConfig(profileConfigPath, env);
        const entries = activeProfile.facet.allowedTargets.flatMap(name => {
            const profile = profiles.profiles[name];
            return profile ? [`- ${name}: ${profile.description}`] : [];
        });
        if (entries.length === 0) return;
        return { systemPrompt: `${event.systemPrompt}\n\nAvailable subagent routing profiles:\n${entries.join("\n")}` };
    });
    pi.on("session_start", async (_event, ctx) => {
        try { await reconcileSessionAccounting(await loadSubagentConfig(configPath), ctx); }
        catch (error) { ctx.ui.notify(`Could not reconcile subagent usage claims: ${error instanceof Error ? error.message : String(error)}`, "warning"); }
    });
    if (!await probeTmux(exec, deps.env)) return false;
    pi.registerTool(createSubagentStartTool(deps));
    pi.registerTool(createSubagentGetTool(deps));
    pi.registerTool(createSubagentWaitTool(deps));
    pi.registerTool(createSubagentStopTool(deps));
    return true;
}

export default registerSubagent;
