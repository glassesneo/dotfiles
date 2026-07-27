import { spawn } from "node:child_process";
import type { Usage } from "@earendil-works/pi-ai";
import { addUsage, emptyUsage, type ResolvedRun } from "./subagent_types.ts";

export type PiNormalizedInput =
    | { type: "assistant_text"; data: { text: string } }
    | { type: "tool_started"; data: { tool: string; arguments: Record<string, unknown> } }
    | { type: "tool_finished"; data: { tool: string; isError: boolean } };

export class HarnessRunError extends Error {
    readonly category: "harness" | "protocol";
    readonly exitCode?: number;
    readonly usage: Usage;
    readonly turns: number;

    constructor(category: "harness" | "protocol", message: string, exitCode?: number, usage = emptyUsage(), turns = 0) {
        super(message);
        this.category = category;
        this.exitCode = exitCode;
        this.usage = structuredClone(usage);
        this.turns = turns;
    }
}

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function messageText(message: Record<string, unknown>): string {
    if (!Array.isArray(message.content)) return "";
    return message.content.map(part => {
        const item = record(part);
        return item.type === "text" && typeof item.text === "string" ? item.text : "";
    }).join("");
}

function normalizedUsage(value: unknown): Usage {
    const usage = record(value);
    const cost = record(usage.cost);
    return {
        input: typeof usage.input === "number" ? usage.input : 0,
        output: typeof usage.output === "number" ? usage.output : 0,
        cacheRead: typeof usage.cacheRead === "number" ? usage.cacheRead : 0,
        cacheWrite: typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0,
        ...(typeof usage.cacheWrite1h === "number" ? { cacheWrite1h: usage.cacheWrite1h } : {}),
        ...(typeof usage.reasoning === "number" ? { reasoning: usage.reasoning } : {}),
        totalTokens: typeof usage.totalTokens === "number"
            ? usage.totalTokens
            : [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].reduce<number>((sum, item) => sum + (typeof item === "number" ? item : 0), 0),
        cost: {
            input: typeof cost.input === "number" ? cost.input : 0,
            output: typeof cost.output === "number" ? cost.output : 0,
            cacheRead: typeof cost.cacheRead === "number" ? cost.cacheRead : 0,
            cacheWrite: typeof cost.cacheWrite === "number" ? cost.cacheWrite : 0,
            total: typeof cost.total === "number" ? cost.total : 0,
        },
    };
}

export class PiEventNormalizer {
    readonly usage: Usage = emptyUsage();
    turns = 0;
    private readonly accountedToolCalls = new Set<string>();
    finalOutput = "";
    stopReason: string | undefined;
    errorMessage: string | undefined;
    malformedLine: string | undefined;

    consume(line: string): PiNormalizedInput[] {
        if (line.trim() === "") return [];
        let event: Record<string, unknown>;
        try { event = record(JSON.parse(line)); }
        catch { this.malformedLine ??= line; return []; }

        if (event.type === "message_update") {
            const update = record(event.assistantMessageEvent);
            if (update.type === "text_delta" && typeof update.delta === "string") return [{ type: "assistant_text", data: { text: update.delta } }];
        }
        if (event.type === "tool_execution_start") {
            return [{ type: "tool_started", data: { tool: typeof event.toolName === "string" ? event.toolName : "unknown", arguments: record(event.args) } }];
        }
        if (event.type === "tool_execution_end") {
            const result = record(event.result);
            const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
            if (!toolCallId || !this.accountedToolCalls.has(toolCallId)) {
                addUsage(this.usage, normalizedUsage(result.usage));
                if (toolCallId) this.accountedToolCalls.add(toolCallId);
            }
            return [{ type: "tool_finished", data: { tool: typeof event.toolName === "string" ? event.toolName : "unknown", isError: event.isError === true } }];
        }
        if (event.type === "message_end") {
            const message = record(event.message);
            if (message.role === "toolResult") {
                const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
                if (!toolCallId || !this.accountedToolCalls.has(toolCallId)) {
                    addUsage(this.usage, normalizedUsage(message.usage));
                    if (toolCallId) this.accountedToolCalls.add(toolCallId);
                }
                return [];
            }
            if (message.role !== "assistant") return [];
            addUsage(this.usage, normalizedUsage(message.usage));
            this.turns += 1;
            this.finalOutput = messageText(message);
            if (typeof message.stopReason === "string") this.stopReason = message.stopReason;
            if (typeof message.errorMessage === "string") this.errorMessage = message.errorMessage;
        }
        return [];
    }
}

export interface PiRunCallbacks {
    onEvent(event: PiNormalizedInput): Promise<void> | void;
    onStderr(text: string): Promise<void> | void;
}

export async function runPiHarness(
    resolved: ResolvedRun,
    request: { prompt: string; cwd: string },
    callbacks: PiRunCallbacks,
): Promise<{ output: string; usage: Usage; turns: number }> {
    const args = ["--mode", "json", "-p", "--no-session", "--no-extensions", "-e", resolved.extension, "--profile", resolved.profile, "--model", resolved.model];
    if (resolved.thinkingLevel) args.push("--thinking", resolved.thinkingLevel);
    if (!resolved.allowAllTools) {
        if (resolved.tools.length === 0) args.push("--no-tools");
        else args.push("--tools", resolved.tools.join(","));
    }

    const normalizer = new PiEventNormalizer();
    const child = spawn(resolved.command, args, {
        cwd: request.cwd,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
            ...process.env,
            PI_SUBAGENT_DEPTH: String(resolved.depth),
            PI_SUBAGENT_RUN_ID: resolved.runId,
            PI_SUBAGENT_ORIGIN_SESSION_ID: resolved.originSessionId,
            PI_SUBAGENT_RESOLVED_PROFILE: JSON.stringify({
                name: resolved.profile,
                profile: {
                    harness: resolved.harness,
                    model: resolved.model,
                    thinkingLevel: resolved.thinkingLevel,
                    allowAllTools: resolved.allowAllTools,
                    tools: resolved.tools,
                    allowedSubagents: resolved.allowedSubagents,
                    instructions: resolved.instructions,
                },
            }),
            ...(resolved.originSessionFile ? { PI_SUBAGENT_ORIGIN_SESSION_FILE: resolved.originSessionFile } : {}),
        },
    });
    let stdoutBuffer = "";
    let pending = Promise.resolve();
    const enqueue = (work: () => Promise<void>) => { pending = pending.then(work); };
    const consumeLine = async (line: string) => { for (const event of normalizer.consume(line)) await callbacks.onEvent(event); };

    child.stdout.on("data", data => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) enqueue(() => consumeLine(line));
    });
    child.stderr.on("data", data => { const text = data.toString(); enqueue(async () => { await callbacks.onStderr(text); }); });
    child.stdin.end(request.prompt);

    const exitCode = await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", code => resolve(code ?? 1));
    }).catch(error => { throw new HarnessRunError("harness", error instanceof Error ? error.message : String(error), undefined, normalizer.usage, normalizer.turns); });
    if (stdoutBuffer.trim()) enqueue(() => consumeLine(stdoutBuffer));
    await pending;

    if (normalizer.malformedLine !== undefined) throw new HarnessRunError("protocol", "Pi emitted a malformed JSON event", exitCode, normalizer.usage, normalizer.turns);
    if (exitCode !== 0) throw new HarnessRunError("harness", normalizer.errorMessage ?? `Pi exited with code ${exitCode}`, exitCode, normalizer.usage, normalizer.turns);
    if (normalizer.stopReason === "error" || normalizer.stopReason === "aborted") {
        throw new HarnessRunError("harness", normalizer.errorMessage ?? `Pi stopped with ${normalizer.stopReason}`, exitCode, normalizer.usage, normalizer.turns);
    }
    return { output: normalizer.finalOutput, usage: normalizer.usage, turns: normalizer.turns };
}
