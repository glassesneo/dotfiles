import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildLaunchEnvelope, settledAgentCatalog, settledAgentDefinition } from "../extensions_src/utilities/agent_types.ts";
import { renderRunResult } from "../extensions_src/utilities/orchestration_cards.ts";
import { buildSubagentDisplayTree } from "../extensions_src/utilities/orchestration_display_tree.ts";
import { detailPaneModel } from "../extensions_src/utilities/orchestration_palette.ts";
import { MAX_MODEL_VISIBLE_BYTES, MAX_MODEL_VISIBLE_LINES, serializeModelVisibleJson } from "../extensions_src/utilities/orchestration_projection.ts";
import { claimPendingTask, createTask, failAgent, finishTask, patchAgentStatus, prepareAgent, publishAgent, readAgentSnapshot, requestTaskCancellation } from "../extensions_src/utilities/orchestration_store.ts";
import { launchAgentSession, stopAgentSession, type CommandResult } from "../extensions_src/utilities/orchestration_tmux.ts";
import { emptyUsage, type AgentSnapshot, type AgentState } from "../extensions_src/utilities/orchestration_types.ts";

const definition = settledAgentDefinition("worker");
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true };
const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$hub", sessionName: "hub", windowId: "@child", paneId: "%child", windowName: "worker" };

async function storedAgent() {
    const root = await mkdtemp(join(tmpdir(), "orchestration-retained-"));
    const prepared = await prepareAgent(root, { agent: "worker", harness: "pi", cwd: "/work", agentSnapshot: definition, launchEnvelope: "pending", lineage: { callerIdentity: "mode:ops", targetAgent: "worker", depth: 1, originSessionId: "origin" }, capabilities });
    const envelope = buildLaunchEnvelope("worker", settledAgentCatalog(), {}, ["/popup", "/orchestration", "/bridge"]);
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json"); await writeFile(envelopePath, JSON.stringify(envelope));
    await publishAgent(prepared.paths, { agentId: prepared.agentId, agent: "worker", harness: "pi", cwd: "/work", agentSnapshot: definition, launchEnvelope: envelopePath, callerIdentity: "mode:ops", targetAgent: "worker", depth: 1, originSessionId: "origin", tmux, capabilities });
    await patchAgentStatus(prepared.paths, { state: "idle", bridgeReady: true }); return { root, prepared };
}

void test("tmux destructive operations retain recorded server and window identity", async () => {
    const mismatchCalls: string[][] = []; const mismatch = async (_command: string, args: string[]): Promise<CommandResult> => { mismatchCalls.push(args); return { stdout: "99\n", stderr: "", code: 0 }; };
    assert.equal(await stopAgentSession(mismatch, "/tmux", tmux), false); assert.equal(mismatchCalls.some(args => args.includes("kill-window")), false);

    const cleanupCalls: string[][] = []; const cleanup = async (_command: string, args: string[]): Promise<CommandResult> => { cleanupCalls.push(args); if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("has-session") && !args.includes("$hub")) return { stdout: "", stderr: "missing", code: 1 }; if (args.includes("new-session")) return { stdout: "$hub\t@child\t%child\n", stderr: "", code: 0 }; if (args.includes("set-option")) return { stdout: "", stderr: "metadata denied", code: 1 }; if (args.includes("kill-window")) return { stdout: "", stderr: "", code: 0 }; if (args.includes("list-panes")) return { stdout: "%child\t1\n", stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; };
    await assert.rejects(launchAgentSession(cleanup, "/tmux", { socket: "/tmp/tmux", serverPid: "10", sessionId: "$parent", sessionName: "main", windowId: "@parent", paneId: "%parent" }, { agentId: "550e8400-e29b-41d4-a716-446655440000", agent: "worker", originSessionId: "origin", cwd: "/work", launch: { command: "/pi", args: [], env: {} } }), /metadata denied/u);
    assert.ok(cleanupCalls.some(args => args.includes("kill-window") && args.includes("@child")));
});

void test("store locking admits one concurrent task and stop or cancellation wins later completion", async () => {
    const { root, prepared } = await storedAgent(); const attempts = await Promise.allSettled([createTask(root, prepared.agentId, "first"), createTask(root, prepared.agentId, "second")]);
    assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1); assert.equal(attempts.filter(result => result.status === "rejected").length, 1);
    const taskId = (attempts.find(result => result.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof createTask>>>).value.request.taskId; await claimPendingTask(root, prepared.agentId);
    await requestTaskCancellation(root, prepared.agentId, taskId, "caller cancelled"); const cancelled = await finishTask(root, prepared.agentId, taskId, { outcome: "succeeded", output: "partial" }); assert.equal(cancelled.outcome, "stopped"); assert.equal((await readAgentSnapshot(root, prepared.agentId, taskId)).status.state, "idle");
    const next = await createTask(root, prepared.agentId, "next"); await claimPendingTask(root, prepared.agentId); await patchAgentStatus(prepared.paths, { state: "stopping" }); const settled = await finishTask(root, prepared.agentId, next.request.taskId, { outcome: "succeeded", output: "too late" }); assert.equal(settled.outcome, "stopped"); await failAgent(root, prepared.agentId, "Stopped by caller", true); assert.equal((await readAgentSnapshot(root, prepared.agentId, next.request.taskId)).status.state, "stopped");
});

void test("model-visible projection remains parseable within aggregate byte and line bounds", () => {
    const text = serializeModelVisibleJson({ outcome: "completed", tasks: Array.from({ length: 128 }, (_, index) => ({ agentId: String(index), agent: "worker", output: `${"界".repeat(600)}\n`.repeat(30) })) });
    assert.ok(Buffer.byteLength(text, "utf8") <= MAX_MODEL_VISIBLE_BYTES); assert.ok(text.split(/\r\n|\r|\n/u).length <= MAX_MODEL_VISIBLE_LINES); const projected = JSON.parse(text); assert.equal(projected.outcome, "completed"); assert.ok(projected.tasks.some((task: { outputTruncated?: boolean }) => task.outputTruncated));
});

function snapshot(id: string, state: AgentState, parentAgentId?: string): AgentSnapshot {
    const taskId = id.replace(/^./u, "b"); const prompt = "Implement retained behavior\nfull detail";
    return { agent: { schemaVersion: 2, agentId: id, agent: "worker", harness: "pi", cwd: "/work", createdAt: id, agentSnapshot: definition, launchEnvelope: "/envelope", launchEnvelopeDigest: "digest", tmux, capabilities, callerIdentity: "mode:ops", targetAgent: "worker", depth: 1, originSessionId: "origin", ...(parentAgentId ? { parentAgentId } : {}) }, status: { schemaVersion: 2, agentId: id, state, bridgeReady: true, agentUsage: emptyUsage(), accountedTaskIds: [], updatedAt: id }, task: { request: { schemaVersion: 2, agentId: id, taskId, prompt, createdAt: id }, status: { schemaVersion: 2, agentId: id, taskId, state: state === "failed" ? "failed" : "succeeded", createdAt: id, finishedAt: id }, result: { schemaVersion: 2, agentId: id, taskId, outcome: state === "failed" ? "failed" : "succeeded", output: "done", usage: emptyUsage(), turns: 1, interventions: [], startedAt: id, finishedAt: id }, interventions: [], claimed: false, directory: "/task" } };
}

void test("cards expose agent, task outcome, and prompt summary while trees retain promoted descendants", () => {
    const parent = snapshot("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "stopped"); const child = snapshot("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "busy", parent.agent.agentId); const tree = buildSubagentDisplayTree([parent, child], ["May"]); const childNode = tree.byId.get(child.agent.agentId)!; assert.equal(childNode.promoted, true); assert.equal(childNode.viaHandle, tree.handles.get(parent.agent.agentId)); assert.ok(tree.roots.some(node => node.agentId === child.agent.agentId));
    const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text }; const card = renderRunResult({ content: [], details: snapshot("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "idle") } as never, { expanded: false } as never, theme as never, { lastComponent: undefined, args: { agent: "worker", prompt: "Implement retained behavior" } }); const lines = card.render(120); assert.match(lines.join("\n"), /worker.*IDLE.*SUCCEEDED|IDLE.*SUCCEEDED.*worker/u); assert.match(lines.join("\n"), /Implement retained behavior/u); assert.match(lines.join("\n"), /done/u); for (const line of lines) assert.ok(visibleWidth(line) <= 120);
    const noTask = { ...parent, task: undefined }; const detail = detailPaneModel(noTask); assert.equal(detail.title, "Agent"); assert.match(detail.body, new RegExp(`worker.*${definition.instructions.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "su")); assert.doesNotMatch(JSON.stringify(detail), /Purpose/u);
});
