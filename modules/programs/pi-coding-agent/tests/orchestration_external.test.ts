import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runExternalWorker } from "../extensions_src/orchestration_external_worker.ts";
import { buildLaunchEnvelope, settledAgentCatalog, settledAgentDefinition } from "../extensions_src/utilities/agent_types.ts";
import type { ExternalDriver } from "../extensions_src/utilities/orchestration_cursor_acp.ts";
import { createTask, markAgentStopping, prepareAgent, publishAgent, readAgentSnapshot, requestTaskCancellation } from "../extensions_src/utilities/orchestration_store.ts";

const definition = settledAgentDefinition("fast-worker");
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: false, interactiveInterventions: false, terminalHistory: false };
const tmux = { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "main", windowId: "@1", paneId: "%1", windowName: "fast" };
const yieldToIO = () => new Promise<void>(resolve => setImmediate(resolve));
async function eventually(predicate: () => Promise<boolean>): Promise<void> { for (let n = 0; n < 500; n += 1) { if (await predicate()) return; await yieldToIO(); } throw new Error("condition did not settle"); }

void test("ACP readiness rejects a tampered settled capability before driver startup", async () => {
    const root = await mkdtemp(join(tmpdir(), "orchestration-external-digest-")); const prepared = await prepareAgent(root, { agent: "fast-worker", harness: "cursor-agent", cwd: root, agentSnapshot: definition, launchEnvelope: "pending", lineage: { callerIdentity: "mode:ops", targetAgent: "fast-worker", depth: 1, originSessionId: "origin" }, capabilities });
    const envelope = buildLaunchEnvelope("fast-worker", settledAgentCatalog(), {}, ["/popup", "/orchestration", "/bridge"]); const envelopePath = join(prepared.paths.directory, "launch-envelope.json"); await writeFile(envelopePath, JSON.stringify(envelope)); await publishAgent(prepared.paths, { agentId: prepared.agentId, agent: "fast-worker", harness: "cursor-agent", cwd: root, agentSnapshot: definition, launchEnvelope: envelopePath, callerIdentity: "mode:ops", targetAgent: "fast-worker", depth: 1, originSessionId: "origin", tmux, capabilities });
    const changed = structuredClone(envelope); changed.catalog["fast-worker"]!.instructions = "Changed reachable behavior."; changed.self.instructions = "Changed reachable behavior."; await writeFile(envelopePath, JSON.stringify(changed)); let starts = 0; const driver: ExternalDriver = { async start() { starts += 1; }, async runTask() { return { output: "", stopReason: "end_turn" }; }, async cancel() {}, async shutdown() {}, waitForClose: () => new Promise(() => {}), fatalError: () => undefined };
    await assert.rejects(runExternalWorker({ PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_STATE_ROOT: root, PI_AGENT_RESOLVED_AGENT: envelopePath, PI_SUBAGENT_EXTERNAL_CONFIG: JSON.stringify({ adapter: "cursor-acp", command: "/cursor", cwd: root, permissionPolicy: "allow-always" }) }, { createDriver: () => driver, sleep: yieldToIO }), /settled fast-worker capability/u); assert.equal(starts, 0);
});

void test("ACP execution validates its envelope, persists cancellation, and reuses one driver", async () => {
    const root = await mkdtemp(join(tmpdir(), "orchestration-external-")); const prepared = await prepareAgent(root, { agent: "fast-worker", harness: "cursor-agent", cwd: root, agentSnapshot: definition, launchEnvelope: "pending", lineage: { callerIdentity: "mode:ops", targetAgent: "fast-worker", depth: 1, originSessionId: "origin" }, capabilities });
    const envelope = buildLaunchEnvelope("fast-worker", settledAgentCatalog(), {}, ["/popup", "/orchestration", "/bridge"]); const envelopePath = join(prepared.paths.directory, "launch-envelope.json"); await writeFile(envelopePath, JSON.stringify(envelope));
    await publishAgent(prepared.paths, { agentId: prepared.agentId, agent: "fast-worker", harness: "cursor-agent", cwd: root, agentSnapshot: definition, launchEnvelope: envelopePath, callerIdentity: "mode:ops", targetAgent: "fast-worker", depth: 1, originSessionId: "origin", tmux, capabilities });
    let rejectFirst!: (error: Error) => void; const firstTurn = new Promise<never>((_resolve, reject) => { rejectFirst = reject; }); let calls = 0; let cancels = 0; const prompts: string[] = [];
    const driver: ExternalDriver = { async start() {}, async runTask(prompt) { prompts.push(prompt); calls += 1; if (calls === 1) return firstTurn; return { output: "second done", stopReason: "end_turn" }; }, async cancel() { cancels += 1; }, partialOutput: () => "partial", async shutdown() {}, waitForClose: () => new Promise(() => {}), fatalError: () => undefined };
    const worker = runExternalWorker({ PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_STATE_ROOT: root, PI_AGENT_RESOLVED_AGENT: envelopePath, PI_SUBAGENT_EXTERNAL_CONFIG: JSON.stringify({ adapter: "cursor-acp", command: "/cursor", cwd: root, permissionPolicy: "allow-always" }) }, { createDriver: () => driver, sleep: yieldToIO });
    await eventually(async () => (await readAgentSnapshot(root, prepared.agentId)).status.bridgeReady);
    const first = await createTask(root, prepared.agentId, "first prompt"); await eventually(async () => (await readAgentSnapshot(root, prepared.agentId, first.request.taskId)).task?.status.state === "running"); await requestTaskCancellation(root, prepared.agentId, first.request.taskId, "cancel first"); await eventually(async () => cancels > 0); rejectFirst(new Error("cancelled")); await eventually(async () => (await readAgentSnapshot(root, prepared.agentId, first.request.taskId)).task?.status.state === "stopped"); assert.equal((await readAgentSnapshot(root, prepared.agentId, first.request.taskId)).task?.result?.output, "partial");
    const second = await createTask(root, prepared.agentId, "second prompt"); await eventually(async () => (await readAgentSnapshot(root, prepared.agentId, second.request.taskId)).task?.status.state === "succeeded"); await markAgentStopping(prepared.paths); await worker; assert.equal(calls, 2); assert.deepEqual(prompts, [`${definition.instructions}\n\nDelegated task:\nfirst prompt`, `${definition.instructions}\n\nDelegated task:\nsecond prompt`]);
});
