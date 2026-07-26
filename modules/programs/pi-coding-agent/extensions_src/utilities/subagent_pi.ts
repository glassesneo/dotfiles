import { spawn } from "node:child_process";
import { emptyUsage, type NormalizedUsage, type ResolvedRun } from "./subagent_types.ts";

export type PiNormalizedInput =
    | { type: "assistant_text"; data: { text: string } }
    | { type: "tool_started"; data: { tool: string; arguments: Record<string, unknown> } }
    | { type: "tool_finished"; data: { tool: string; isError: boolean } };

export class HarnessRunError extends Error {
    readonly category: "harness" | "protocol";
    readonly exitCode?: number;

    constructor(category: "harness" | "protocol", message: string, exitCode?: number) {
        super(message);
        this.category = category;
        this.exitCode = exitCode;
    }
}

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function messageText(message: Record<string, unknown>): string {
    if (!Array.isArray(message.content)) return "";
    return message.content
        .map(part => {
            const item = record(part);
            return item.type === "text" && typeof item.text === "string" ? item.text : "";
        })
        .join("");
}

export class PiEventNormalizer {
    readonly usage: NormalizedUsage = emptyUsage();
    finalOutput = "";
    stopReason: string | undefined;
    errorMessage: string | undefined;
    malformedLine: string | undefined;

    consume(line: string): PiNormalizedInput[] {
        if (line.trim() === "") return [];
        let event: Record<string, unknown>;
        try {
            event = record(JSON.parse(line));
        } catch {
            this.malformedLine ??= line;
            return [];
        }

        if (event.type === "message_update") {
            const update = record(event.assistantMessageEvent);
            if (update.type === "text_delta" && typeof update.delta === "string") {
                return [{ type: "assistant_text", data: { text: update.delta } }];
            }
        }

        if (event.type === "tool_execution_start") {
            return [{
                type: "tool_started",
                data: {
                    tool: typeof event.toolName === "string" ? event.toolName : "unknown",
                    arguments: record(event.args),
                },
            }];
        }

        if (event.type === "tool_execution_end") {
            return [{
                type: "tool_finished",
                data: {
                    tool: typeof event.toolName === "string" ? event.toolName : "unknown",
                    isError: event.isError === true,
                },
            }];
        }

        if (event.type === "message_end") {
            const message = record(event.message);
            if (message.role !== "assistant") return [];
            this.usage.turns += 1;
            const usage = record(message.usage);
            const cost = record(usage.cost);
            this.usage.inputTokens += typeof usage.input === "number" ? usage.input : 0;
            this.usage.outputTokens += typeof usage.output === "number" ? usage.output : 0;
            this.usage.cacheReadTokens += typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
            this.usage.cacheWriteTokens += typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;
            this.usage.costUsd += typeof cost.total === "number" ? cost.total : 0;
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
): Promise<{ output: string; usage: NormalizedUsage }> {
    const args = ["--mode", "json", "-p", "--no-session", "--no-extensions", "--model", resolved.model];
    if (resolved.thinkingLevel) args.push("--thinking", resolved.thinkingLevel);
    if (resolved.tools) {
        if (resolved.tools.length === 0) args.push("--no-tools");
        else args.push("--tools", resolved.tools.join(","));
    }

    const normalizer = new PiEventNormalizer();
    const child = spawn(resolved.command, args, {
        cwd: request.cwd,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
    });
    let stdoutBuffer = "";
    let pending = Promise.resolve();

    const enqueue = (work: () => Promise<void>) => {
        pending = pending.then(work);
    };
    const consumeLine = async (line: string) => {
        for (const event of normalizer.consume(line)) await callbacks.onEvent(event);
    };

    child.stdout.on("data", data => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) enqueue(() => consumeLine(line));
    });
    child.stderr.on("data", data => {
        const text = data.toString();
        enqueue(async () => { await callbacks.onStderr(text); });
    });

    child.stdin.end(request.prompt);

    const exitCode = await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", code => resolve(code ?? 1));
    }).catch(error => {
        throw new HarnessRunError("harness", error instanceof Error ? error.message : String(error));
    });
    if (stdoutBuffer.trim()) enqueue(() => consumeLine(stdoutBuffer));
    await pending;

    if (normalizer.malformedLine !== undefined) {
        throw new HarnessRunError("protocol", "Pi emitted a malformed JSON event", exitCode);
    }
    if (exitCode !== 0) {
        throw new HarnessRunError("harness", normalizer.errorMessage ?? `Pi exited with code ${exitCode}`, exitCode);
    }
    if (normalizer.stopReason === "error" || normalizer.stopReason === "aborted") {
        throw new HarnessRunError("harness", normalizer.errorMessage ?? `Pi stopped with ${normalizer.stopReason}`, exitCode);
    }
    return { output: normalizer.finalOutput, usage: normalizer.usage };
}
