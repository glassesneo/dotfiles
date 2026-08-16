import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { buildLaunchEnvelope } from "../extensions_src/utilities/agent_types.ts";
import { availableContext, publishAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { createCompletionReceipt, readCompletionLedger } from "../extensions_src/utilities/orchestration_completion.ts";
import { acknowledgeMeshEvents, bindMeshEndpoint, markMeshEventsInjected, materializeMeshCompletionEvents, readEndpointDeliverySnapshot, registerMeshSignal, setMeshEndpointOffline } from "../extensions_src/utilities/orchestration_events.ts";
import { bindAgentRuntime } from "../extensions_src/utilities/orchestration_runtime.ts";
import { attachRootMesh, createTask, ensurePolicyEpoch, finishTask, initializeMesh, meshPaths, patchAgentStatus, prepareAgent, publishAgent, readPolicyEpoch, reserveMeshCapacity } from "../extensions_src/utilities/orchestration_store.ts";
import { withTemporaryRoot as withRoot } from "./test_helpers.ts";

const syntheticRole = (name = "worker") => ({ description: `Synthetic ${name}`, tools: [], instructions: "Return the bounded result.", defaultProfile: "pi-medium", contextPolicy: "project" as const, childExtensionContributions: [] });
const syntheticProfile = { model: "provider/model", thinkingLevel: "medium" as const, harness: "pi" as const };
const budgets = { maxLiveAgents: 4, maxConcurrentTasks: 8, maxTasksPerMesh: 8 };
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };
const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" };

async function publishEventAgent(root: string, meshId: string, epoch: Awaited<ReturnType<typeof ensurePolicyEpoch>>, definition: ReturnType<typeof syntheticRole>): Promise<string> {
    const reservation = await reserveMeshCapacity(root, meshId, "new-agent-task");
    const prepared = await prepareAgent(root, meshId, { reservationId: reservation.reservationId, role: "worker", selectedProfile: "pi-medium", harness: "pi", cwd: root, roleSnapshot: definition, profileSnapshot: syntheticProfile, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { creatorSessionId: "root" }, capabilities });
    const persistedEpoch = await readPolicyEpoch(root, meshId, epoch.epochId);
    const envelope = buildLaunchEnvelope({ meshId, agentId: prepared.agentId, epochId: epoch.epochId, role: "worker", snapshot: epoch, childExtensions: Object.fromEntries(persistedEpoch.roleSet.map(name => [name, ["/popup.ts", "/orchestration.ts", "/bridge.ts"]])) });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(envelope), { mode: 0o600 });
    await publishAgent(root, meshId, prepared.paths, { agentId: prepared.agentId, epochId: epoch.epochId, role: "worker", selectedProfile: "pi-medium", harness: "pi", cwd: root, roleSnapshot: definition, profileSnapshot: syntheticProfile, launchEnvelope: envelopePath, tmux: { ...tmux, windowId: `@${prepared.agentId}`, paneId: `%${prepared.agentId}` }, capabilities, creatorSessionId: "root" });
    await patchAgentStatus(root, meshId, prepared.agentId, { state: "idle", bridgeReady: true });
    await bindAgentRuntime(root, meshId, prepared.agentId, { runtimeId: prepared.agentId, kind: "external" });
    const now = new Date().toISOString();
    await publishAgentActivity(root, meshId, prepared.agentId, { runtimeId: prepared.agentId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: now, observedAt: now, heartbeatAt: now, context: availableContext(10, 100_000, 100) });
    return prepared.agentId;
}

async function eventFixture(root: string) {
    const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: "/root.jsonl", recoverable: true, budgets });
    const roles = { worker: syntheticRole("worker") };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", catalog: { schemaVersion: 3, roles }, profiles: { schemaVersion: 1, profiles: { "pi-medium": syntheticProfile } }, callPolicy: { modes: { ops: { roles: ["worker"] } }, roles: {} } });
    const [agentId, secondAgentId] = await Promise.all([publishEventAgent(root, mesh.meshId, epoch, roles.worker), publishEventAgent(root, mesh.meshId, epoch, roles.worker)]);
    const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile: "/root.jsonl" });
    const lease = await attachRootMesh(root, mesh.meshId, { rootSessionId: "root", rootSessionFile: "/root.jsonl", budgets });
    return { mesh, agentId, secondAgentId, endpoint, lease };
}

// Admission: assignment and event repair cross two durable files; type checks cannot detect duplicate or lost completion sources.
// Given multiple terminal tasks for one endpoint, when one root pass crosses ledger-first materialization and is interrupted, the receiver eventually observes one deterministic source event assigning each task once.
void test("root materialization groups endpoint completions and repairs ledger-first interruption", async () => withRoot("mesh-completion-repair-", async root => {
    const fixture = await eventFixture(root);
    const completion = { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile };
    const first = await createTask(root, fixture.mesh.meshId, fixture.agentId, "first", { requesterEndpointId: fixture.endpoint.endpointId, completion });
    const second = await createTask(root, fixture.mesh.meshId, fixture.secondAgentId, "second", { requesterEndpointId: fixture.endpoint.endpointId, completion });
    await finishTask(root, fixture.mesh.meshId, second.request.taskId, { outcome: "failed", error: "private" });
    await finishTask(root, fixture.mesh.meshId, first.request.taskId, { outcome: "succeeded", output: "private" });
    await assert.rejects(materializeMeshCompletionEvents(root, fixture.mesh.meshId, fixture.lease.leaseId, { afterLedgerPersisted: () => { throw new Error("interrupt after ledger"); } }), /interrupt after ledger/u);
    assert.deepEqual((await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, fixture.endpoint)).events, []);
    await materializeMeshCompletionEvents(root, fixture.mesh.meshId, fixture.lease.leaseId);
    const snapshot = await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, fixture.endpoint);
    assert.equal(snapshot.events.length, 1);
    const tasks = snapshot.events[0]!.payload.tasks as Array<{ taskId: string; agentId: string; state: string }>;
    assert.deepEqual(tasks.map(task => task.taskId), [first.request.taskId, second.request.taskId]);
    assert.deepEqual(tasks.map(task => task.agentId), [fixture.agentId, fixture.secondAgentId]);
    assert.doesNotMatch(JSON.stringify(snapshot.events[0]!.payload), /prompt|output|error|usage|channel|route/u);
    const ledger = await readCompletionLedger(root, fixture.mesh.meshId, fixture.endpoint.endpointId, fixture.endpoint.sessionFile);
    assert.equal(ledger!.batches.length, 1);
    assert.deepEqual(ledger!.batches[0]!.taskIds, tasks.map(task => task.taskId));
    await materializeMeshCompletionEvents(root, fixture.mesh.meshId, fixture.lease.leaseId);
    assert.equal((await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, fixture.endpoint)).events[0]!.eventId, snapshot.events[0]!.eventId);
}));

// Admission: root authority fencing is runtime persistence behavior; static schemas cannot prevent a stale cadence callback from mutating a successor mesh.
// Given a replaced root lease, when the stale root callback materializes, no ledger or event is written.
void test("completion materialization requires the active root lease", async () => withRoot("mesh-completion-lease-", async root => {
    const fixture = await eventFixture(root);
    const completion = { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile };
    const task = await createTask(root, fixture.mesh.meshId, fixture.agentId, "terminal", { requesterEndpointId: fixture.endpoint.endpointId, completion });
    await finishTask(root, fixture.mesh.meshId, task.request.taskId, { outcome: "succeeded" });
    const leasePath = meshPaths(root, fixture.mesh.meshId).lease;
    const lease = JSON.parse(await readFile(leasePath, "utf8"));
    await writeFile(leasePath, JSON.stringify({ ...lease, leaseId: randomUUID() }));
    await assert.rejects(materializeMeshCompletionEvents(root, fixture.mesh.meshId, fixture.lease.leaseId), /active root lease owner/u);
    assert.equal(await readCompletionLedger(root, fixture.mesh.meshId, fixture.endpoint.endpointId, fixture.endpoint.sessionFile), undefined);
}));

// Admission: receipt ordering spans retrieval and materialization transactions; schemas cannot prove suppression-before or frozen-repair-after behavior.
// Given retrieval on either side of assignment persistence, settlement suppresses receipt-first work while retaining the frozen source for ledger-first repair.
void test("receipt ordering suppresses new assignment without corrupting frozen repair", async () => withRoot("mesh-receipt-order-", async root => {
    const fixture = await eventFixture(root);
    const completion = { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile };
    const before = await createTask(root, fixture.mesh.meshId, fixture.agentId, "before", { requesterEndpointId: fixture.endpoint.endpointId, completion });
    await finishTask(root, fixture.mesh.meshId, before.request.taskId, { outcome: "succeeded" });
    await createCompletionReceipt(root, fixture.mesh.meshId, { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile, claimantSessionFile: fixture.endpoint.sessionFile, toolCallId: "before", toolName: "mesh_get", canonicalArguments: { taskId: before.request.taskId }, taskIds: [before.request.taskId], maxTasksPerMesh: budgets.maxTasksPerMesh });
    await materializeMeshCompletionEvents(root, fixture.mesh.meshId, fixture.lease.leaseId);
    assert.deepEqual((await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, fixture.endpoint)).events, []);

    const after = await createTask(root, fixture.mesh.meshId, fixture.agentId, "after", { requesterEndpointId: fixture.endpoint.endpointId, completion });
    await finishTask(root, fixture.mesh.meshId, after.request.taskId, { outcome: "failed" });
    await assert.rejects(materializeMeshCompletionEvents(root, fixture.mesh.meshId, fixture.lease.leaseId, { afterLedgerPersisted: () => { throw new Error("hold event"); } }), /hold event/u);
    await createCompletionReceipt(root, fixture.mesh.meshId, { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile, claimantSessionFile: fixture.endpoint.sessionFile, toolCallId: "after", toolName: "mesh_get", canonicalArguments: { taskId: after.request.taskId }, taskIds: [after.request.taskId], maxTasksPerMesh: budgets.maxTasksPerMesh });
    await materializeMeshCompletionEvents(root, fixture.mesh.meshId, fixture.lease.leaseId);
    const [event] = (await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, fixture.endpoint)).events;
    assert.deepEqual((event!.payload.tasks as Array<{ taskId: string }>).map(task => task.taskId), [after.request.taskId]);
}));

void test("signal retries preserve one event and reject changed arguments", async () => withRoot("mesh-signal-", async root => {
    const fixture = await eventFixture(root);
    const canonicalArguments = { receiver: "root", delivery: "steer", topic: "status", text: "Ready" };
    const input = { callerEndpointId: "agent:sender", toolCallId: "signal-call", endpoint: fixture.endpoint, delivery: "steer" as const, topic: "status", text: "Ready", canonicalArguments };
    const first = await registerMeshSignal(root, fixture.mesh.meshId, input);
    assert.equal((await registerMeshSignal(root, fixture.mesh.meshId, input)).eventId, first.eventId);
    await assert.rejects(registerMeshSignal(root, fixture.mesh.meshId, { ...input, text: "Changed", canonicalArguments: { ...canonicalArguments, text: "Changed" } }), /different arguments/u);
    assert.deepEqual((await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, fixture.endpoint)).events[0]!.payload, { eventId: first.eventId, topic: "status", text: "Ready" });
}));

// Admission: endpoint generation fencing protects durable state from delayed runtime callbacks; session identity alone cannot detect same-session reloads.
// Given a same-session endpoint rebind, stale snapshots, injection, acknowledgement, and offline callbacks fail while the current binding can deliver existing events.
void test("endpoint bindingId fences delivery lifecycle mutations", async () => withRoot("mesh-endpoint-generation-", async root => {
    const fixture = await eventFixture(root);
    const signal = await registerMeshSignal(root, fixture.mesh.meshId, { callerEndpointId: "agent:sender", toolCallId: "generation", endpoint: fixture.endpoint, delivery: "followUp", topic: "status", text: "Ready", canonicalArguments: { topic: "status" } });
    const replacement = await bindMeshEndpoint(root, fixture.mesh.meshId, { endpointId: fixture.endpoint.endpointId, kind: "root", harness: "pi", sessionId: fixture.endpoint.sessionId, sessionFile: fixture.endpoint.sessionFile });
    assert.notEqual(replacement.bindingId, fixture.endpoint.bindingId);
    await assert.rejects(readEndpointDeliverySnapshot(root, fixture.mesh.meshId, fixture.endpoint), /rotated or went offline/u);
    await assert.rejects(markMeshEventsInjected(root, fixture.mesh.meshId, fixture.endpoint, [signal.eventId]), /rotated or went offline/u);
    await assert.rejects(acknowledgeMeshEvents(root, fixture.mesh.meshId, fixture.endpoint, [signal.eventId]), /rotated or went offline/u);
    await setMeshEndpointOffline(root, fixture.mesh.meshId, replacement.endpointId, fixture.endpoint);
    assert.equal((await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, replacement)).events.length, 1);

    await markMeshEventsInjected(root, fixture.mesh.meshId, replacement, [signal.eventId, signal.eventId]);
    const injected = (await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, replacement)).events[0]!;
    assert.equal(injected.state, "injected");
    await markMeshEventsInjected(root, fixture.mesh.meshId, replacement, [signal.eventId]);
    assert.equal((await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, replacement)).events[0]!.injectedAt, injected.injectedAt);
    await acknowledgeMeshEvents(root, fixture.mesh.meshId, replacement, [signal.eventId, signal.eventId]);
    assert.deepEqual((await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, replacement)).events, []);
    const path = join(meshPaths(root, fixture.mesh.meshId).events, `${signal.eventId}.json`);
    const persisted = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    assert.equal(persisted.state, "acknowledged");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
}));
