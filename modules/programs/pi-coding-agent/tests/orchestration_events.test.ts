import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { buildLaunchEnvelope } from "../extensions_src/utilities/agent_types.ts";
import { availableContext, publishAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { bindAgentRuntime } from "../extensions_src/utilities/orchestration_runtime.ts";
import { createCompletionReceipt, readCompletionLedger } from "../extensions_src/utilities/orchestration_channel.ts";
import { acknowledgeMeshEvents, bindMeshEndpoint, markMeshEventInjected, pollMeshEvents, registerMeshSignal, setMeshEndpointOffline } from "../extensions_src/utilities/orchestration_events.ts";
import { createTask, ensurePolicyEpoch, finishTask, initializeMesh, meshPaths, patchAgentStatus, prepareAgent, publishAgent, readPolicyEpoch, reserveMeshCapacity } from "../extensions_src/utilities/orchestration_store.ts";
import { withTemporaryRoot as withRoot } from "./test_helpers.ts";

const syntheticRole = (name = "worker") => ({ description: `Synthetic ${name}`, tools: [], skillOptIns: [], instructions: "Return the bounded result.", defaultProfile: "pi-medium", contextPolicy: "project" as const, childExtensionContributions: [] });
const syntheticProfile = { model: "provider/model", thinkingLevel: "medium" as const, harness: "pi" as const };
const syntheticCatalog = (roles: Record<string, ReturnType<typeof syntheticRole>>) => ({ schemaVersion: 2 as const, roles });
const syntheticEpochInput = (mode: string, roles: Record<string, ReturnType<typeof syntheticRole>>) => ({
    mode,
    catalog: syntheticCatalog(roles),
    profiles: { schemaVersion: 1 as const, profiles: { "pi-medium": syntheticProfile } },
    callPolicy: { modes: { [mode]: { roles: Object.keys(roles) } }, roles: {} },
});

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
    await bindAgentRuntime(root, meshId, prepared.agentId, { runtimeId: prepared.agentId, kind: "external" }); const now = new Date().toISOString(); await publishAgentActivity(root, meshId, prepared.agentId, { runtimeId: prepared.agentId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: now, observedAt: now, heartbeatAt: now, context: availableContext(10, 100_000, 100) });
    return prepared.agentId;
}

async function eventFixture(root: string) {
    const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: "/root.jsonl", recoverable: true, budgets });
    const roles = { worker: syntheticRole("worker") };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, syntheticEpochInput("ops", roles));
    const agentId = await publishEventAgent(root, mesh.meshId, epoch, roles.worker);
    const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile: "/root.jsonl" });
    return { mesh, epoch, definition: roles.worker, agentId, endpoint };
}

void test("routed direct completion persists one minimal steer event and repairs ledger-first interruption", async () => withRoot("mesh-completion-repair-", async root => {
    const fixture = await eventFixture(root);
    const completion = { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile, mode: "direct" as const };
    const task = await createTask(root, fixture.mesh.meshId, fixture.agentId, "direct completion", { requesterEndpointId: fixture.endpoint.endpointId, completion });
    await finishTask(root, fixture.mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "secret output" });
    await assert.rejects(pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint, { afterLedgerPersisted: () => { throw new Error("injected materialization failure"); } }), /injected materialization failure/u);
    const [event] = await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint);
    assert.equal(event!.delivery, "steer");
    assert.equal(event!.payload.route, "direct");
    assert.deepEqual((event!.payload.tasks as Array<Record<string, unknown>>).map(item => ({ taskId: item.taskId, state: item.state })), [{ taskId: task.request.taskId, state: "succeeded" }]);
    assert.doesNotMatch(JSON.stringify(event!.payload), /prompt|output|error|usage/u);
    const [again] = await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint);
    assert.equal(again!.eventId, event!.eventId);
}));

// Given retrieval on either side of assignment persistence, completion settlement suppresses receipt-first work while retaining frozen batch payloads for ledger-first repair.
void test("receipt ordering suppresses new assignment without corrupting frozen event repair", async () => withRoot("mesh-receipt-order-", async root => {
    const fixture = await eventFixture(root); const completion = { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile, mode: "direct" as const };
    const before = await createTask(root, fixture.mesh.meshId, fixture.agentId, "received before assignment", { requesterEndpointId: fixture.endpoint.endpointId, completion }); await finishTask(root, fixture.mesh.meshId, before.request.taskId, { outcome: "succeeded" }); await createCompletionReceipt(root, fixture.mesh.meshId, { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile, claimantSessionFile: fixture.endpoint.sessionFile, toolCallId: "before-assignment", toolName: "mesh_get", canonicalArguments: { taskId: before.request.taskId }, taskIds: [before.request.taskId], maxTasksPerMesh: budgets.maxTasksPerMesh }); assert.deepEqual(await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint), []);
    const after = await createTask(root, fixture.mesh.meshId, fixture.agentId, "received after batch", { requesterEndpointId: fixture.endpoint.endpointId, completion }); await finishTask(root, fixture.mesh.meshId, after.request.taskId, { outcome: "failed" }); await assert.rejects(pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint, { afterLedgerPersisted: () => { throw new Error("hold materialization"); } }), /hold materialization/u); await createCompletionReceipt(root, fixture.mesh.meshId, { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile, claimantSessionFile: fixture.endpoint.sessionFile, toolCallId: "after-batch", toolName: "mesh_get", canonicalArguments: { taskId: after.request.taskId }, taskIds: [after.request.taskId], maxTasksPerMesh: budgets.maxTasksPerMesh }); const repaired = await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint); assert.deepEqual((repaired[0]!.payload.tasks as Array<{ taskId: string }>).map(task => task.taskId), [after.request.taskId]);
    const ledger = await readCompletionLedger(root, fixture.mesh.meshId, fixture.endpoint.endpointId, fixture.endpoint.sessionFile); assert.deepEqual(ledger!.batches.flatMap(batch => batch.taskIds), [after.request.taskId]); assert.deepEqual(ledger!.receipts.flatMap(receipt => receipt.taskIds).sort(), [after.request.taskId, before.request.taskId].sort());
}));

// Given a three-task channel cohort, when the last completion, another registration, and polling genuinely contend for the mesh lock, every admitted task is assigned to exactly one eventual cohort without duplicate or loss.
void test("concurrent channel completion registration and polling assign every task exactly once", async () => withRoot("mesh-channel-concurrency-", async root => {
    const fixture = await eventFixture(root); const secondAgent = await publishEventAgent(root, fixture.mesh.meshId, fixture.epoch, fixture.definition); const thirdAgent = await publishEventAgent(root, fixture.mesh.meshId, fixture.epoch, fixture.definition);
    const completion = { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile, mode: "channel" as const, channel: "A" as const };
    const first = await createTask(root, fixture.mesh.meshId, fixture.agentId, "first concurrent cohort member", { requesterEndpointId: fixture.endpoint.endpointId, completion });
    const second = await createTask(root, fixture.mesh.meshId, secondAgent, "second concurrent cohort member", { requesterEndpointId: fixture.endpoint.endpointId, completion });
    await finishTask(root, fixture.mesh.meshId, first.request.taskId, { outcome: "succeeded", output: "first" });
    const [, third, racedEvents] = await Promise.all([
        finishTask(root, fixture.mesh.meshId, second.request.taskId, { outcome: "failed", error: "second" }),
        createTask(root, fixture.mesh.meshId, thirdAgent, "registered during completion polling", { requesterEndpointId: fixture.endpoint.endpointId, completion }),
        pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint),
    ]);
    await finishTask(root, fixture.mesh.meshId, third.request.taskId, { outcome: "stopped" });
    const eventualEvents = await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint);
    const events = new Map([...racedEvents, ...eventualEvents].map(event => [event.eventId, event]));
    const assigned = [...events.values()].flatMap(event => (event.payload.tasks as Array<{ taskId: string }>).map(task => task.taskId));
    const expected = [first.request.taskId, second.request.taskId, third.request.taskId].sort();
    assert.deepEqual([...assigned].sort(), expected); assert.equal(new Set(assigned).size, expected.length);
    const ledger = await readCompletionLedger(root, fixture.mesh.meshId, fixture.endpoint.endpointId, fixture.endpoint.sessionFile); assert.ok(ledger);
    const ledgerAssignments = ledger.batches.flatMap(batch => batch.taskIds); assert.deepEqual([...ledgerAssignments].sort(), expected); assert.equal(new Set(ledgerAssignments).size, expected.length);
}));

void test("channel registration after terminal settlement rotates to the next cohort", async () => withRoot("mesh-channel-registration-", async root => {
    const fixture = await eventFixture(root);
    const completion = { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile, mode: "channel" as const, channel: "A" as const };
    const first = await createTask(root, fixture.mesh.meshId, fixture.agentId, "first cohort", { requesterEndpointId: fixture.endpoint.endpointId, completion });
    await finishTask(root, fixture.mesh.meshId, first.request.taskId, { outcome: "failed", error: "bounded failure" });
    const second = await createTask(root, fixture.mesh.meshId, fixture.agentId, "second cohort", { requesterEndpointId: fixture.endpoint.endpointId, completion });
    const [firstEvent] = await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint);
    assert.deepEqual((firstEvent!.payload.tasks as Array<{ taskId: string }>).map(item => item.taskId), [first.request.taskId]);
    await finishTask(root, fixture.mesh.meshId, second.request.taskId, { outcome: "stopped" });
    const events = await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint);
    assert.equal(events.length, 2);
    assert.equal(events.some(event => (event.payload.tasks as Array<{ taskId: string }>).some(item => item.taskId === second.request.taskId)), true);
}));

void test("signal retries return one frozen event for equal arguments and reject a changed retry", async () => withRoot("mesh-signal-", async root => {
    const fixture = await eventFixture(root);
    const task = await createTask(root, fixture.mesh.meshId, fixture.agentId, "sender remains active", `root:${fixture.mesh.meshId}`);
    const canonicalArguments = { action: "signal", receiver: "root", delivery: "steer", topic: "validation", text: "Contract mismatch", taskIds: [task.request.taskId] };
    const input = { callerEndpointId: "agent:sender", toolCallId: "signal-call", endpoint: fixture.endpoint, delivery: "steer" as const, topic: "validation", text: "Contract mismatch", taskIds: [task.request.taskId], canonicalArguments };
    const first = await registerMeshSignal(root, fixture.mesh.meshId, input);
    const retry = await registerMeshSignal(root, fixture.mesh.meshId, input);
    assert.equal(retry.eventId, first.eventId);
    await assert.rejects(registerMeshSignal(root, fixture.mesh.meshId, { ...input, text: "Different", canonicalArguments: { ...canonicalArguments, text: "Different" } }), /different arguments/u);
    const [event] = await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint);
    assert.deepEqual(event!.payload, { eventId: first.eventId, topic: "validation", text: "Contract mismatch", taskIds: [task.request.taskId] });
}));

void test("polling delivers only while the durable endpoint still matches the caller session identity and remains online", async () => withRoot("mesh-endpoint-recheck-", async root => {
    const fixture = await eventFixture(root); await registerMeshSignal(root, fixture.mesh.meshId, { callerEndpointId: "agent:sender", toolCallId: "endpoint-call", endpoint: fixture.endpoint, delivery: "steer", topic: "status", text: "Ready", canonicalArguments: { action: "signal", receiver: "root", delivery: "steer", topic: "status", text: "Ready" } });
    await bindMeshEndpoint(root, fixture.mesh.meshId, { endpointId: fixture.endpoint.endpointId, kind: "root", harness: "pi", sessionId: "replacement", sessionFile: fixture.endpoint.sessionFile });
    assert.deepEqual(await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint), []);
    const replacement = await bindMeshEndpoint(root, fixture.mesh.meshId, { endpointId: fixture.endpoint.endpointId, kind: "root", harness: "pi", sessionId: "replacement", sessionFile: fixture.endpoint.sessionFile });
    assert.equal((await pollMeshEvents(root, fixture.mesh.meshId, replacement)).length, 1);
    await setMeshEndpointOffline(root, fixture.mesh.meshId, replacement.endpointId);
    assert.deepEqual(await pollMeshEvents(root, fixture.mesh.meshId, replacement), []);
}));

void test("event delivery advances pending to injected to acknowledged without timestamp churn or state regression", async () => withRoot("mesh-event-state-", async root => {
    const fixture = await eventFixture(root);
    const signal = await registerMeshSignal(root, fixture.mesh.meshId, { callerEndpointId: "agent:sender", toolCallId: "state-call", endpoint: fixture.endpoint, delivery: "followUp", topic: "status", text: "Ready", canonicalArguments: { action: "signal", receiver: "root", delivery: "followUp", topic: "status", text: "Ready" } });
    assert.equal((await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint))[0]!.state, "pending");
    await markMeshEventInjected(root, fixture.mesh.meshId, signal.eventId);
    const injected = (await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint))[0]!;
    assert.equal(injected.state, "injected");
    await markMeshEventInjected(root, fixture.mesh.meshId, signal.eventId);
    assert.equal((await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint))[0]!.injectedAt, injected.injectedAt);
    await acknowledgeMeshEvents(root, fixture.mesh.meshId, [signal.eventId, signal.eventId]);
    await markMeshEventInjected(root, fixture.mesh.meshId, signal.eventId);
    await acknowledgeMeshEvents(root, fixture.mesh.meshId, [signal.eventId]);
    assert.deepEqual(await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint), []);
    const path = join(meshPaths(root, fixture.mesh.meshId).events, `${signal.eventId}.json`);
    const persisted = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    assert.equal(persisted.state, "acknowledged");
    assert.deepEqual(Object.keys(persisted).sort(), ["acknowledgedAt", "createdAt", "delivery", "endpointId", "endpointSessionFile", "eventId", "injectedAt", "kind", "meshId", "payload", "schemaVersion", "senderEndpointId", "state"].sort());
    assert.equal((await stat(path)).mode & 0o777, 0o600);
}));
