import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMeshChildBridge, type MeshChildBridgeDependencies } from "../extensions_src/orchestration_child_bridge.ts";
import { buildLaunchEnvelope, settledAgentDefinition } from "../extensions_src/utilities/agent_types.ts";
import { createTask, ensurePolicyEpoch, initializeMesh, prepareAgent, publishAgent, readAgentSnapshot, requestTaskCancellation, reserveMeshCapacity } from "../extensions_src/utilities/orchestration_store.ts";

const definition = settledAgentDefinition("worker");
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };
const tmux = { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "main", windowId: "@1", paneId: "%1", windowName: "worker" };
const budgets = { maxLiveAgents: 4, maxConcurrentTasks: 4, maxTasksPerMesh: 20 };

function reverseKeyInsertionOrder(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reverseKeyInsertionOrder);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([key, item]) => [key, reverseKeyInsertionOrder(item)]));
    return value;
}

async function bridgeFixture(options: { publish?: boolean; dependencies?: MeshChildBridgeDependencies } = {}) {
    const root = await mkdtemp(join(tmpdir(), "orchestration-bridge-"));
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: false, budgets });
    const roles = { worker: definition };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles });
    const reservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task");
    const agentId = randomUUID();
    const envelope = buildLaunchEnvelope({ meshId: mesh.meshId, agentId, epochId: epoch.epochId, agent: "worker", mode: "ops", roleSet: ["worker"], catalog: { schemaVersion: 1, agents: roles }, childExtensions: { worker: ["/popup", "/orchestration", "/bridge"] } });
    const prepared = await prepareAgent(root, mesh.meshId, { reservationId: reservation.reservationId, agentId, agent: "worker", harness: "pi", cwd: "/work", agentSnapshot: definition, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { creatorSessionId: "parent" }, capabilities });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(envelope));
    const publish = () => publishAgent(root, mesh.meshId, prepared.paths, { agentId, epochId: epoch.epochId, agent: "worker", harness: "pi", cwd: "/work", agentSnapshot: definition, launchEnvelope: envelopePath, creatorSessionId: "parent", tmux, capabilities });
    if (options.publish !== false) await publish();

    const handlers = new Map<string, (...args: any[]) => any>();
    const eventHandlers: Array<(value: unknown) => void> = [];
    let intervalCallback: (() => void | Promise<void>) | undefined;
    let shutdowns = 0;
    let aborts = 0;
    const delivered: string[] = [];
    const pi = {
        on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); },
        events: { on(_name: string, handler: (value: unknown) => void) { eventHandlers.push(handler); return () => {}; } },
        sendUserMessage(prompt: string) { delivered.push(prompt); },
    } as unknown as ExtensionAPI;
    registerMeshChildBridge(pi, { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: agentId, PI_MESH_AGENT_DIR: prepared.paths.directory, PI_MESH_EPOCH_ID: epoch.epochId, PI_AGENT_RESOLVED_AGENT: envelopePath }, {
        setInterval(callback) { intervalCallback = callback; return 1; }, clearInterval() {}, ...options.dependencies,
    });
    const activate = (value: unknown = envelope) => { for (const handler of eventHandlers) handler({ schemaVersion: 1, identity: envelope.identity, envelope: value }); };
    const start = () => handlers.get("session_start")?.({}, { sessionManager: { getSessionId: () => "child", getSessionFile: () => undefined }, abort() { aborts += 1; }, shutdown() { shutdowns += 1; } });
    const tick = async () => { await intervalCallback?.(); };
    const emit = async (name: string, event: unknown = {}) => { await handlers.get(name)?.(event, {}); };
    return { root, meshId: mesh.meshId, envelope, envelopePath, prepared, agentId, activate, start, tick, emit, publish, delivered, get shutdowns() { return shutdowns; }, get aborts() { return aborts; } };
}

void test("child readiness accepts the activated immutable epoch snapshot independent of JSON key order", async () => {
    const fixture = await bridgeFixture();
    const reordered = reverseKeyInsertionOrder(fixture.envelope);
    assert.notEqual(JSON.stringify(reordered), JSON.stringify(fixture.envelope));
    fixture.activate(reordered);
    await fixture.start();
    const ready = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId);
    assert.equal(ready.status.bridgeReady, true);
    assert.equal(ready.status.state, "idle");
});

void test("child readiness rejects a different activated epoch snapshot and bounds publication waiting", async () => {
    const mismatch = await bridgeFixture();
    const changed = structuredClone(mismatch.envelope);
    changed.childExtensions.worker![0] = "/changed-popup";
    mismatch.activate(changed);
    await mismatch.start();
    const failed = JSON.parse(await readFile(mismatch.prepared.paths.status, "utf8")) as { bridgeReady: boolean; state: string };
    assert.equal(failed.bridgeReady, false);
    assert.equal(failed.state, "failed");
    assert.equal(mismatch.shutdowns, 1);

    let now = 0;
    const timedOut = await bridgeFixture({ publish: false, dependencies: { publicationTimeoutMs: 2, publicationRetryMs: 1, now: () => now, sleep: async (milliseconds: number) => { now += milliseconds; } } });
    timedOut.activate();
    await timedOut.start();
    const timeoutStatus = JSON.parse(await readFile(timedOut.prepared.paths.status, "utf8")) as { bridgeReady: boolean; state: string; exitReason: string };
    assert.equal(timeoutStatus.bridgeReady, false);
    assert.equal(timeoutStatus.state, "failed");
    assert.match(timeoutStatus.exitReason, /mesh agent publication/u);
    assert.equal(timedOut.shutdowns, 1);
});

void test("Pi child tasks preserve completion, cancellation, and failure outcomes", async () => {
    const fixture = await bridgeFixture();
    fixture.activate();
    await fixture.start();

    const complete = await createTask(fixture.root, fixture.meshId, fixture.agentId, "complete");
    await fixture.tick();
    assert.deepEqual(fixture.delivered, ["complete"]);
    await fixture.emit("before_agent_start", { prompt: "complete" });
    await fixture.emit("agent_start");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", usage: { input: 2, output: 3, totalTokens: 5 } } });
    await fixture.emit("agent_settled");
    const completed = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, complete.request.taskId);
    assert.equal(completed.task?.result?.outcome, "succeeded");
    assert.equal(completed.task?.result?.output, "done");

    const cancel = await createTask(fixture.root, fixture.meshId, fixture.agentId, "cancel");
    await fixture.tick();
    await requestTaskCancellation(fixture.root, fixture.meshId, cancel.request.taskId, "caller cancelled");
    await fixture.tick();
    const cancelled = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, cancel.request.taskId);
    assert.equal(cancelled.task?.result?.outcome, "stopped");

    const fail = await createTask(fixture.root, fixture.meshId, fixture.agentId, "fail");
    await fixture.tick();
    await fixture.emit("before_agent_start", { prompt: "fail" });
    await fixture.emit("agent_start");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "model failed", usage: { input: 1, output: 1, totalTokens: 2 } } });
    await fixture.emit("agent_settled");
    const failedTask = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, fail.request.taskId);
    assert.equal(failedTask.task?.result?.outcome, "failed");
    assert.match(failedTask.task?.result?.error ?? "", /model failed/u);
});

void test("idle child turns aggregate both assistant and mesh tool-result usage", async () => {
    const fixture = await bridgeFixture();
    fixture.activate();
    await fixture.start();
    await fixture.emit("message_end", { message: { role: "assistant", content: [], usage: { input: 1, output: 2, totalTokens: 3 } } });
    await fixture.emit("message_end", { message: { role: "toolResult", toolName: "mesh_get", usage: { input: 4, output: 1, totalTokens: 5 } } });
    const snapshot = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId);
    assert.equal(snapshot.status.agentUsage.totalTokens, 8);
    assert.equal(snapshot.status.agentUsage.input, 5);
    assert.equal(snapshot.status.agentUsage.output, 3);
});
