import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMeshChildBridge, type MeshChildBridgeDependencies } from "../extensions_src/orchestration_child_bridge.ts";
import { buildLaunchEnvelope } from "../extensions_src/utilities/agent_types.ts";
import { readAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { createTask, ensurePolicyEpoch, initializeMesh, markAgentStopping, prepareAgent, publishAgent, readAgentSnapshot, requestTaskCancellation, reserveMeshCapacity } from "../extensions_src/utilities/orchestration_store.ts";

const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };
const tmux = { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "main", windowId: "@1", paneId: "%1", windowName: "worker" };
const syntheticRole = (name = "worker") => ({ description: `Synthetic ${name}`, tools: [], skillOptIns: [], instructions: "Return the bounded result.", defaultProfile: "pi-medium", contextPolicy: "project" as const, childExtensionContributions: [] });
const syntheticProfile = { model: "provider/model", thinkingLevel: "medium" as const, harness: "pi" as const };
const syntheticCatalog = (roles: Record<string, ReturnType<typeof syntheticRole>>) => ({ schemaVersion: 2 as const, roles });
const syntheticEpochInput = (mode: string, roles: Record<string, ReturnType<typeof syntheticRole>>) => ({
    mode,
    catalog: syntheticCatalog(roles),
    profiles: { schemaVersion: 1 as const, profiles: { "pi-medium": syntheticProfile } },
    callPolicy: { modes: { [mode]: { roles: Object.keys(roles) } }, roles: {} },
});
const definition = syntheticRole("worker");

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
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, syntheticEpochInput("ops", roles));
    const reservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task");
    const agentId = randomUUID();
    const envelope = buildLaunchEnvelope({ meshId: mesh.meshId, agentId, epochId: epoch.epochId, role: "worker", snapshot: epoch, childExtensions: { worker: ["/popup", "/orchestration", "/bridge"] } });
    const prepared = await prepareAgent(root, mesh.meshId, { reservationId: reservation.reservationId, agentId, role: "worker", selectedProfile: "pi-medium", harness: "pi", cwd: "/work", roleSnapshot: definition, profileSnapshot: syntheticProfile, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { creatorSessionId: "parent" }, capabilities });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(envelope));
    const publish = () => publishAgent(root, mesh.meshId, prepared.paths, { agentId, epochId: epoch.epochId, role: "worker", selectedProfile: "pi-medium", harness: "pi", cwd: "/work", roleSnapshot: definition, profileSnapshot: syntheticProfile, launchEnvelope: envelopePath, creatorSessionId: "parent", tmux, capabilities });
    if (options.publish !== false) await publish();

    const handlers = new Map<string, (...args: any[]) => any>();
    const eventHandlers: Array<(value: unknown) => void> = [];
    let intervalCallback: (() => void | Promise<void>) | undefined;
    let shutdowns = 0;
    let aborts = 0;
    let idle = true;
    let pendingMessages = false;
    const delivered: string[] = [];
    const pi = {
        on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); },
        events: { on(_name: string, handler: (value: unknown) => void) { eventHandlers.push(handler); return () => {}; } },
        sendUserMessage(prompt: string) { delivered.push(prompt); },
    } as unknown as ExtensionAPI;
    registerMeshChildBridge(pi, { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: agentId, PI_MESH_AGENT_DIR: prepared.paths.directory, PI_MESH_EPOCH_ID: epoch.epochId, PI_AGENT_RESOLVED_AGENT: envelopePath }, {
        setInterval(callback) { intervalCallback = callback; return 1; }, clearInterval() {}, resolveCompactionReserveTokens: () => 68, contextHeadroomTokens: 32, standaloneRuntimeBinding: true, ...options.dependencies,
    });
    const activate = (value: unknown = envelope) => { for (const handler of eventHandlers) handler({ schemaVersion: 1, identity: envelope.identity, envelope: value }); };
    const start = () => handlers.get("session_start")?.({}, { cwd: "/work", sessionManager: { getSessionId: () => "child", getSessionFile: () => join(root, "child.jsonl") }, getContextUsage: () => ({ tokens: 99, contextWindow: 200, percent: 49.5 }), isIdle: () => idle, hasPendingMessages: () => pendingMessages, abort() { aborts += 1; }, shutdown() { shutdowns += 1; } });
    const tick = async () => { await intervalCallback?.(); };
    const emit = async (name: string, event: unknown = {}) => { await handlers.get(name)?.(event, {}); };
    return { root, meshId: mesh.meshId, envelope, envelopePath, prepared, agentId, activate, start, tick, emit, publish, delivered, setIdle(value: boolean) { idle = value; }, setPendingMessages(value: boolean) { pendingMessages = value; }, get shutdowns() { return shutdowns; }, get aborts() { return aborts; } };
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

void test("Pi lifecycle events publish running, compaction health, and settled activity", async () => {
    const fixture = await bridgeFixture({ dependencies: { resolveCompactionReserveTokens: () => 68, contextHeadroomTokens: 32 } });
    fixture.activate(); await fixture.start();
    const ready = await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId);
    assert.deepEqual({ phase: ready?.phase, health: ready?.context.health, until: ready?.context.tokensUntilCompaction }, { phase: "idle", health: "healthy", until: 33 });
    await fixture.emit("agent_start");
    assert.equal((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, "running");
    const controller = new AbortController(); await fixture.emit("session_before_compact", { reason: "threshold", signal: controller.signal });
    assert.deepEqual({ phase: (await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, reason: (await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.compactionReason }, { phase: "compacting", reason: "threshold" });
    await fixture.emit("agent_settled");
    assert.equal((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, "idle");
    const manual = new AbortController(); await fixture.emit("session_before_compact", { reason: "manual", signal: manual.signal }); await fixture.emit("session_compact", { reason: "manual", willRetry: false }); assert.equal((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, "compacting"); await fixture.emit("agent_settled"); assert.equal((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, "idle");
});

// Given a completed manual idle compaction, when a later tick observes Pi idle with no queued work, the mesh consumer sees the child become idle without requiring agent_settled.
void test("manual idle compaction settles on a later quiescent observation", async () => {
    const fixture = await bridgeFixture(); fixture.activate(); await fixture.start();
    const manual = new AbortController(); await fixture.emit("session_before_compact", { reason: "manual", signal: manual.signal }); await fixture.emit("session_compact", { reason: "manual", willRetry: false });
    assert.equal((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, "compacting");
    fixture.setIdle(false); await fixture.tick(); assert.equal((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, "compacting");
    fixture.setIdle(true); fixture.setPendingMessages(true); await fixture.tick(); assert.equal((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, "compacting");
    fixture.setPendingMessages(false); await fixture.tick(); assert.equal((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, "idle");
});

// Given a durable root stop, when child shutdown crosses the bridge boundary, lifecycle remains stopping for root tmux confirmation.
void test("Pi bridge never terminalizes a root-managed stopping agent", async () => { const fixture = await bridgeFixture(); fixture.activate(); await fixture.start(); await markAgentStopping(fixture.root, fixture.meshId, fixture.agentId); await fixture.emit("session_shutdown", { reason: "quit" }); assert.equal((await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId)).status.state, "stopping"); });

void test("Pi settings resolution failure preserves readiness with unknown context health", async () => {
    const fixture = await bridgeFixture({ dependencies: { resolveCompactionReserveTokens: () => { throw new Error("settings unavailable"); } } });
    fixture.activate(); await fixture.start();
    const activity = await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId);
    assert.deepEqual({ bridgeReady: (await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId)).status.bridgeReady, context: activity?.context.state, health: activity?.context.health }, { bridgeReady: true, context: "unknown", health: "unknown" });
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

void test("child initialization failure requests shutdown even when failure persistence is unavailable", async () => {
    const fixture = await bridgeFixture({ dependencies: {
        recordChildSessionIdentity: async () => { throw new Error("mesh store unavailable"); },
        failAgent: async () => { throw new Error("mesh store still unavailable"); },
    } });
    fixture.activate();
    await fixture.start();
    assert.equal(fixture.shutdowns, 1);
});

void test("stalled completion persistence shuts down the settled child after a bounded window", async () => {
    let now = Date.now(); let expire!: () => void; let timerScheduled!: () => void; const scheduled = new Promise<void>(resolve => { timerScheduled = resolve; });
    const fixture = await bridgeFixture({ dependencies: {
        completionPersistenceTimeoutMs: 2,
        now: () => now,
        finishTask: () => new Promise<never>(() => {}),
        setTimeout(callback) { expire = callback; timerScheduled(); return 1; },
        clearTimeout() {},
    } });
    fixture.activate();
    await fixture.start();
    await createTask(fixture.root, fixture.meshId, fixture.agentId, "complete before store failure", `root:${fixture.meshId}`);
    await fixture.tick();
    await fixture.emit("before_agent_start", { prompt: "complete before store failure" });
    await fixture.emit("agent_start");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" } });
    const settling = fixture.emit("agent_settled");
    await scheduled; assert.equal(fixture.shutdowns, 0);
    now += 2; expire(); await settling;
    assert.equal(fixture.shutdowns, 1);
    await fixture.emit("session_shutdown", { reason: "quit" });
});

void test("Pi child tasks preserve completion, cancellation, and failure outcomes", async () => {
    const fixture = await bridgeFixture();
    fixture.activate();
    await fixture.start();

    const complete = await createTask(fixture.root, fixture.meshId, fixture.agentId, "complete", `root:${fixture.meshId}`);
    await fixture.tick();
    assert.deepEqual(fixture.delivered, ["complete"]);
    await fixture.emit("before_agent_start", { prompt: "complete" });
    await fixture.emit("agent_start");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", usage: { input: 2, output: 3, totalTokens: 5 } } });
    await fixture.emit("agent_settled");
    const completed = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, complete.request.taskId);
    assert.equal(completed.task?.result?.outcome, "succeeded");
    assert.equal(completed.task?.result?.output, "done");

    const cancel = await createTask(fixture.root, fixture.meshId, fixture.agentId, "cancel", `root:${fixture.meshId}`);
    await fixture.tick();
    await requestTaskCancellation(fixture.root, fixture.meshId, cancel.request.taskId, "caller cancelled");
    await fixture.tick();
    const cancelled = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, cancel.request.taskId);
    assert.equal(cancelled.task?.result?.outcome, "stopped");

    const fail = await createTask(fixture.root, fixture.meshId, fixture.agentId, "fail", `root:${fixture.meshId}`);
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
