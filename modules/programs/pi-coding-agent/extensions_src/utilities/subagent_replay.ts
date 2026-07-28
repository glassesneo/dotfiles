import { randomUUID } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedRun, RunResult, TranscriptCapabilities } from "./subagent_types.ts";
import { isTerminalState } from "./subagent_types.ts";
import { readEvents, readJson, readRunRequest, readSnapshot, runPaths } from "./subagent_store.ts";
import type { CommandExecutor, TmuxContext } from "./subagent_tmux.ts";

function value(value: unknown): string { return typeof value === "string" ? value : JSON.stringify(value, null, 2); }
export async function renderReplay(stateRoot: string, runId: string): Promise<string> {
    const paths = runPaths(stateRoot, runId); const [request, snapshot, events] = await Promise.all([readRunRequest(paths), readSnapshot(stateRoot, runId), readEvents(paths)]);
    const resolved = await readJson<ResolvedRun>(paths.resolved);
    const harness = resolved.schemaVersion === 4 ? resolved.harness : "pi (legacy)";
    const capabilities: TranscriptCapabilities = resolved.schemaVersion === 4 ? resolved.transcriptCapabilities : { assistantText: true, toolCalls: true, toolResults: false, usage: true };
    const lines = [`Subagent replay`, `Run: ${runId}`, `Purpose: ${request.purpose}`, `Profile: ${snapshot.profile}`, `Harness: ${harness}`, `Status: ${snapshot.status}`, "", "Parent instruction:", request.prompt, "", "Transcript:"];
    let sawAssistant = false; let sawTool = false; let sawResult = false;
    for (const event of events) {
        if (event.type === "parent_instruction") continue;
        if (event.type === "run_started") lines.push(`[${event.sequence}] run started`);
        else if (event.type === "assistant_text") { sawAssistant = true; lines.push(value(event.data.text)); }
        else if (event.type === "tool_started") { sawTool = true; lines.push(`\n[${event.sequence}] tool ${value(event.data.name ?? event.data.tool)} (${value(event.data.toolCallId ?? "legacy-id-unavailable")})`, value(event.data.arguments)); }
        else if (event.type === "tool_finished") { sawResult = true; const text = typeof event.data.result === "string" && event.data.result !== "" ? event.data.result : `unavailable for harness ${harness}`; lines.push(`[${event.sequence}] tool result ${event.data.isError === true ? "ERROR" : "OK"} (${value(event.data.toolCallId ?? "legacy-id-unavailable")})`, text); }
        else if (event.type === "raw_harness_output") lines.push(value(event.data.text));
        else if (event.type === "diagnostic") lines.push(`[${event.sequence}] diagnostic: ${value(event.data.message)}`);
        else if (event.type === "run_finished") lines.push(`\n[${event.sequence}] run finished: ${value(event.data.outcome)}`);
    }
    if (!capabilities.assistantText) lines.push(`Assistant text unavailable for harness ${harness}.`); else if (!sawAssistant) lines.push("No assistant text was persisted.");
    if (!capabilities.toolCalls) lines.push(`Tool calls unavailable for harness ${harness}.`); else if (!sawTool) lines.push("No tool calls were persisted.");
    if (!capabilities.toolResults) lines.push(`Tool results unavailable for harness ${harness}.`); else if (sawTool && !sawResult) lines.push(`Tool results unavailable for harness ${harness}.`);
    if (snapshot.result) {
        const result: RunResult = snapshot.result; lines.push("", "Terminal summary:", `Outcome: ${result.outcome}`, `Turns: ${result.turns}`, capabilities.usage ? `Usage: ${result.usage.totalTokens} tokens; cost $${result.usage.cost.total.toFixed(4)}` : `Usage unavailable for harness ${harness}.`, `Output:`, result.output || "(empty)");
        if (result.error) lines.push(`Error: ${result.error.category}: ${result.error.message}`);
    }
    return `${lines.join("\n")}\n`;
}
export async function launchReplayWindow(exec: CommandExecutor, context: TmuxContext, options: { stateRoot: string; runId: string; cwd: string; node: string; viewer: string; configPath: string }): Promise<{ windowId: string; paneId: string; windowName: string }> {
    const windowName = `sa-view-${options.runId.slice(0, 8)}`;
    const created = await exec("tmux", ["new-window", "-d", "-P", "-F", "#{window_id}\t#{pane_id}", "-t", `${context.sessionId}:`, "-c", options.cwd, "-n", windowName, options.node, "--experimental-strip-types", options.viewer, options.configPath, options.runId]);
    if (created.code !== 0) throw new Error(created.stderr.trim() || "tmux replay window creation failed");
    const [windowId, paneId] = created.stdout.trim().split("\t"); if (!windowId || !paneId) throw new Error("tmux replay window did not return IDs");
    const remain = await exec("tmux", ["set-option", "-w", "-t", windowId, "remain-on-exit", "off"]); if (remain.code !== 0) { await exec("tmux", ["kill-window", "-t", windowId]); throw new Error(remain.stderr.trim() || "Could not disable remain-on-exit"); }
    const selected = await exec("tmux", ["select-window", "-t", windowId]); if (selected.code !== 0) { await exec("tmux", ["kill-window", "-t", windowId]); throw new Error(selected.stderr.trim() || "Could not select replay window"); }
    return { windowId, paneId, windowName };
}
export async function createReplayTemporary(runDirectory: string, text: string): Promise<string> { const path = join(runDirectory, `.replay-${randomUUID()}.txt`); await writeFile(path, text, { mode: 0o600 }); await chmod(path, 0o600); return path; }
export { isTerminalState };
