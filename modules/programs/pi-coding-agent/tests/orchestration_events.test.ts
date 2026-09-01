import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { buildLaunchEnvelope } from "../extensions_src/utilities/agent_types.ts";
import { availableContext, publishAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { createCompletionReceipt, readCompletionLedger } from "../extensions_src/utilities/orchestration_completion.ts";
import { acknowledgeMeshContextInterventions, acknowledgeMeshEvents, bindMeshEndpoint, markMeshEventsInjected, materializeMeshCompletionEvents, readEndpointDeliverySnapshot, registerMeshReport, registerStateAwareMeshSend, setMeshEndpointOffline } from "../extensions_src/utilities/orchestration_events.ts";
import { indexEventCreation, orchestrationIndexPath } from "../extensions_src/utilities/orchestration_index.ts";
import { bindAgentRuntime } from "../extensions_src/utilities/orchestration_runtime.ts";
import { attachRootMesh, claimPendingTask, createTask, ensurePolicyEpoch, finishTask, initializeMesh, meshPaths, patchAgentStatus, prepareAgent, publishAgent, readPolicyEpoch, reserveMeshCapacity } from "../extensions_src/utilities/orchestration_store.ts";
import { DirectoryReadObserver, withTemporaryRoot as withRoot } from "./test_helpers.ts";

const syntheticRole = (name = "worker") => ({ description: `Synthetic ${name}`, tools: [], instructions: "Return the bounded result.", contextPolicy: "project" as const, childExtensionContributions: [] });
const syntheticProfile = { models: ["provider/model"], thinkingLevel: "medium" as const, harness: "pi" as const };
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
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", catalog: { schemaVersion: 4, roles }, profiles: { schemaVersion: 2, profiles: { "pi-medium": syntheticProfile } }, callPolicy: { modes: { ops: { targets: { worker: { profiles: ["pi-medium"] } } } }, roles: {} } });
    const [agentId, secondAgentId] = await Promise.all([publishEventAgent(root, mesh.meshId, epoch, roles.worker), publishEventAgent(root, mesh.meshId, epoch, roles.worker)]);
    const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile: "/root.jsonl" });
    const lease = await attachRootMesh(root, mesh.meshId, { rootSessionId: "root", rootSessionFile: "/root.jsonl", budgets });
    return { mesh, epoch, agentId, secondAgentId, endpoint, lease };
}

async function bindEventAgentEndpoint(root: string, meshId: string, agentId: string) {
    return bindMeshEndpoint(root, meshId, { endpointId: `agent:${agentId}`, kind: "agent", agentId, harness: "pi", sessionId: `session-${agentId}`, sessionFile: `/agent-${agentId}.jsonl` });
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
    const completionReference = (taskId: string) => orchestrationIndexPath(root, fixture.mesh.meshId, "completion-queue", { taskId });
    await Promise.all([access(completionReference(first.request.taskId)), access(completionReference(second.request.taskId))]);
    await materializeMeshCompletionEvents(root, fixture.mesh.meshId, fixture.lease.leaseId);
    await Promise.all([assert.rejects(access(completionReference(first.request.taskId)), error => (error as NodeJS.ErrnoException).code === "ENOENT"), assert.rejects(access(completionReference(second.request.taskId)), error => (error as NodeJS.ErrnoException).code === "ENOENT")]);
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

// Admission: task submission and terminal transition cross index-first crash windows that schemas cannot make atomic.
// Given stable task identity and injected post-index crashes, when submission and completion retry, the authoritative task is materialized once with both durable references retained.
void test("task submission and terminal transition retry their index-first crash points", async () => withRoot("mesh-task-index-crash-", async root => {
    const fixture = await eventFixture(root); const completion = { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile, bindingId: fixture.endpoint.bindingId }; const taskId = randomUUID();
    await assert.rejects(createTask(root, fixture.mesh.meshId, fixture.agentId, "indexed", { requesterEndpointId: fixture.endpoint.endpointId, completion, afterIndexesPersisted: () => { throw new Error("task index crash"); } }, undefined, taskId), /task index crash/u);
    const task = await createTask(root, fixture.mesh.meshId, fixture.agentId, "indexed", { requesterEndpointId: fixture.endpoint.endpointId, completion }, undefined, taskId); assert.equal(task.request.taskId, taskId);
    await assert.rejects(finishTask(root, fixture.mesh.meshId, taskId, { outcome: "succeeded", afterCompletionIndexPersisted: () => { throw new Error("terminal index crash"); } }), /terminal index crash/u);
    await finishTask(root, fixture.mesh.meshId, taskId, { outcome: "succeeded" });
    await Promise.all([stat(orchestrationIndexPath(root, fixture.mesh.meshId, "agent-task-inbox", { agentId: fixture.agentId, taskId })), stat(orchestrationIndexPath(root, fixture.mesh.meshId, "completion-queue", { ...completion, taskId }))]);
    await assert.rejects(stat(orchestrationIndexPath(root, fixture.mesh.meshId, "endpoint-tasks", { ...completion, taskId })), error => (error as NodeJS.ErrnoException).code === "ENOENT");
}));

// Admission: addressed steady-state reads own a performance contract not observable through result correctness alone.
// Given unrelated global task/event inventory, when a worker claims, root settles, and an endpoint snapshots, observers see only the addressed index directories and referenced records.
void test("addressed claim, completion, and endpoint reads never scan global task or event directories", async () => withRoot("mesh-addressed-reads-", async root => {
    const fixture = await eventFixture(root); const completion = { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile, bindingId: fixture.endpoint.bindingId };
    const claimTask = await createTask(root, fixture.mesh.meshId, fixture.agentId, "claim addressed", { requesterEndpointId: fixture.endpoint.endpointId, completion }); const claimReads = new DirectoryReadObserver(); assert.equal((await claimPendingTask(root, fixture.mesh.meshId, fixture.agentId, undefined, claimReads))!.request.taskId, claimTask.request.taskId);
    await finishTask(root, fixture.mesh.meshId, claimTask.request.taskId, { outcome: "succeeded" }); const completionReads = new DirectoryReadObserver(); await materializeMeshCompletionEvents(root, fixture.mesh.meshId, fixture.lease.leaseId, { indexReadObserver: completionReads });
    const endpointReads = new DirectoryReadObserver(); const snapshot = await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, fixture.endpoint, endpointReads); assert.equal(snapshot.events.length, 1);
    for (const observer of [claimReads, completionReads, endpointReads]) { observer.assertNeverRead(meshPaths(root, fixture.mesh.meshId).tasks); observer.assertNeverRead(meshPaths(root, fixture.mesh.meshId).events); }
    assert.equal(claimReads.paths.length, 1); assert.equal(endpointReads.paths.length, 2);
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

// Admission: state-aware send owns durable intervention delivery; type checks cannot detect retry duplication, task-local sequence gaps, or acknowledgement before model-context inclusion.
// Given repeated sends to a busy agent, when its endpoint injects the interventions and reports their context inclusion, sender and receiver observe one ordered delivery-acknowledged intervention per call.
void test("intervention transport is idempotent, ordered, and context-acknowledged after injection", async () => withRoot("mesh-intervention-", async root => {
    const fixture = await eventFixture(root);
    const agentEndpoint = await bindEventAgentEndpoint(root, fixture.mesh.meshId, fixture.agentId);
    const completion = { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile };
    const active = await createTask(root, fixture.mesh.meshId, fixture.agentId, "active", { requesterEndpointId: fixture.endpoint.endpointId, completion });
    const firstInput = { callerEndpointId: fixture.endpoint.endpointId, callerEndpointSessionFile: fixture.endpoint.sessionFile, toolCallId: "intervene-first", canonicalArguments: { agentId: fixture.agentId, message: "First intervention" }, endpoint: agentEndpoint, agentId: fixture.agentId, message: "First intervention", completion };
    const first = await registerStateAwareMeshSend(root, fixture.mesh.meshId, firstInput);
    assert.equal(first.disposition, "intervened");
    if (first.disposition !== "intervened") throw new Error("busy agent send did not create an intervention");
    assert.deepEqual(await registerStateAwareMeshSend(root, fixture.mesh.meshId, firstInput), first);
    await assert.rejects(registerStateAwareMeshSend(root, fixture.mesh.meshId, { ...firstInput, message: "Changed intervention", canonicalArguments: { agentId: fixture.agentId, message: "Changed intervention" } }), /different arguments/u);
    const second = await registerStateAwareMeshSend(root, fixture.mesh.meshId, { ...firstInput, toolCallId: "intervene-second", canonicalArguments: { agentId: fixture.agentId, message: "Second intervention" }, message: "Second intervention" });
    assert.equal(second.disposition, "intervened");
    if (second.disposition !== "intervened") throw new Error("busy agent send did not create a second intervention");
    assert.deepEqual([first.sequence, second.sequence], [1, 2]);

    const pending = await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, agentEndpoint);
    assert.deepEqual(new Map(pending.events.map(event => [event.eventId, event.state])), new Map([[first.messageId, "pending"], [second.messageId, "pending"]]));
    await assert.rejects(acknowledgeMeshContextInterventions(root, fixture.mesh.meshId, agentEndpoint, [first.messageId]), /not injected/u);
    await markMeshEventsInjected(root, fixture.mesh.meshId, agentEndpoint, [first.messageId, second.messageId, first.messageId]);
    const injected = await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, agentEndpoint);
    assert.deepEqual(new Map(injected.events.map(event => [event.eventId, event.state])), new Map([[first.messageId, "injected"], [second.messageId, "injected"]]));
    const acknowledgments = await acknowledgeMeshContextInterventions(root, fixture.mesh.meshId, agentEndpoint, [first.messageId, second.messageId, first.messageId]);
    assert.equal(acknowledgments.length, 1);
    assert.equal(acknowledgments[0]!.acknowledgedThrough, 2);
    assert.deepEqual(new Set(acknowledgments[0]!.messageIds), new Set([first.messageId, second.messageId]));
    assert.deepEqual(await acknowledgeMeshContextInterventions(root, fixture.mesh.meshId, agentEndpoint, [first.messageId, second.messageId]), acknowledgments);
    const third = await registerStateAwareMeshSend(root, fixture.mesh.meshId, { ...firstInput, toolCallId: "intervene-third", canonicalArguments: { agentId: fixture.agentId, message: "Third intervention" }, message: "Third intervention" });
    assert.equal(third.disposition, "intervened");
    if (third.disposition !== "intervened") throw new Error("busy agent send did not create a third intervention");
    await markMeshEventsInjected(root, fixture.mesh.meshId, agentEndpoint, [third.messageId]);
    const incremental = await acknowledgeMeshContextInterventions(root, fixture.mesh.meshId, agentEndpoint, [first.messageId, second.messageId, third.messageId]);
    assert.equal(incremental.length, 1);
    assert.notEqual(incremental[0]!.eventId, acknowledgments[0]!.eventId);
    assert.equal(incremental[0]!.acknowledgedThrough, 3);
    assert.deepEqual(incremental[0]!.messageIds, [third.messageId]);
    const fourth = await registerStateAwareMeshSend(root, fixture.mesh.meshId, { ...firstInput, toolCallId: "intervene-fourth", canonicalArguments: { agentId: fixture.agentId, message: "Fourth intervention" }, message: "Fourth intervention" });
    const fifth = await registerStateAwareMeshSend(root, fixture.mesh.meshId, { ...firstInput, toolCallId: "intervene-fifth", canonicalArguments: { agentId: fixture.agentId, message: "Fifth intervention" }, message: "Fifth intervention" });
    if (fourth.disposition !== "intervened" || fifth.disposition !== "intervened") throw new Error("busy agent sends did not create later interventions");
    await markMeshEventsInjected(root, fixture.mesh.meshId, agentEndpoint, [fourth.messageId, fifth.messageId]);
    const orphanAckId = randomUUID(); const fourthPath = join(meshPaths(root, fixture.mesh.meshId).events, `${fourth.messageId}.json`); const fourthEvent = JSON.parse(await readFile(fourthPath, "utf8"));
    await writeFile(fourthPath, JSON.stringify({ ...fourthEvent, state: "acknowledged", acknowledgedAt: new Date().toISOString(), ackEventId: orphanAckId }));
    const repaired = await acknowledgeMeshContextInterventions(root, fixture.mesh.meshId, agentEndpoint, [first.messageId, fourth.messageId, fifth.messageId]);
    assert.deepEqual(repaired, [{ eventId: orphanAckId, agentId: fixture.agentId, taskId: active.request.taskId, acknowledgedThrough: 5, messageIds: [fourth.messageId, fifth.messageId].sort((a, b) => a.localeCompare(b)) }]);

    const senderEvents = (await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, fixture.endpoint)).events.filter(event => event.kind === "delivery-ack");
    assert.equal(senderEvents.length, 3);
    assert.deepEqual(new Map(senderEvents.map(event => [event.eventId, event.payload])), new Map([
        [acknowledgments[0]!.eventId, { eventId: acknowledgments[0]!.eventId, ackId: acknowledgments[0]!.eventId, agentId: fixture.agentId, taskId: active.request.taskId, acknowledgedThrough: 2, messageIds: acknowledgments[0]!.messageIds }],
        [incremental[0]!.eventId, { eventId: incremental[0]!.eventId, ackId: incremental[0]!.eventId, agentId: fixture.agentId, taskId: active.request.taskId, acknowledgedThrough: 3, messageIds: incremental[0]!.messageIds }],
        [orphanAckId, { eventId: orphanAckId, ackId: orphanAckId, agentId: fixture.agentId, taskId: active.request.taskId, acknowledgedThrough: 5, messageIds: repaired[0]!.messageIds }],
    ]));
}));

// Admission: acknowledgment repair spans independently routed sender/task scopes; a successful new acknowledgment must not hide another scope's crash orphan.
// Given an orphaned acknowledgment from an earlier task and a new injected intervention for a later task, one context pass durably delivers both acknowledgment scopes.
void test("context acknowledgment repairs an orphan while creating another task scope", async () => withRoot("mesh-ack-mixed-repair-", async root => {
    const fixture = await eventFixture(root); const agentEndpoint = await bindEventAgentEndpoint(root, fixture.mesh.meshId, fixture.agentId); const completion = { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile };
    const earlierTask = await createTask(root, fixture.mesh.meshId, fixture.agentId, "earlier", { requesterEndpointId: fixture.endpoint.endpointId, completion });
    const earlier = await registerStateAwareMeshSend(root, fixture.mesh.meshId, { callerEndpointId: fixture.endpoint.endpointId, callerEndpointSessionFile: fixture.endpoint.sessionFile, toolCallId: "earlier-intervention", canonicalArguments: { agentId: fixture.agentId, message: "Earlier intervention" }, endpoint: agentEndpoint, agentId: fixture.agentId, message: "Earlier intervention", completion });
    if (earlier.disposition !== "intervened") throw new Error("earlier send did not intervene");
    await markMeshEventsInjected(root, fixture.mesh.meshId, agentEndpoint, [earlier.messageId]);
    const orphanAckId = randomUUID(); const earlierPath = join(meshPaths(root, fixture.mesh.meshId).events, `${earlier.messageId}.json`); const earlierEvent = JSON.parse(await readFile(earlierPath, "utf8"));
    await writeFile(earlierPath, JSON.stringify({ ...earlierEvent, state: "acknowledged", acknowledgedAt: new Date().toISOString(), ackEventId: orphanAckId }));
    await finishTask(root, fixture.mesh.meshId, earlierTask.request.taskId, { outcome: "succeeded" });
    const laterTask = await createTask(root, fixture.mesh.meshId, fixture.agentId, "later", { requesterEndpointId: fixture.endpoint.endpointId, completion });
    const later = await registerStateAwareMeshSend(root, fixture.mesh.meshId, { callerEndpointId: fixture.endpoint.endpointId, callerEndpointSessionFile: fixture.endpoint.sessionFile, toolCallId: "later-intervention", canonicalArguments: { agentId: fixture.agentId, message: "Later intervention" }, endpoint: agentEndpoint, agentId: fixture.agentId, message: "Later intervention", completion });
    if (later.disposition !== "intervened") throw new Error("later send did not intervene");
    await markMeshEventsInjected(root, fixture.mesh.meshId, agentEndpoint, [later.messageId]);
    const acknowledgments = await acknowledgeMeshContextInterventions(root, fixture.mesh.meshId, agentEndpoint, [earlier.messageId, later.messageId]);
    assert.equal(acknowledgments.length, 2);
    assert.deepEqual(new Map(acknowledgments.map(item => [item.taskId, item])), new Map([
        [laterTask.request.taskId, { eventId: acknowledgments.find(item => item.taskId === laterTask.request.taskId)!.eventId, agentId: fixture.agentId, taskId: laterTask.request.taskId, acknowledgedThrough: 1, messageIds: [later.messageId] }],
        [earlierTask.request.taskId, { eventId: orphanAckId, agentId: fixture.agentId, taskId: earlierTask.request.taskId, acknowledgedThrough: 1, messageIds: [earlier.messageId] }],
    ]));
    const delivered = (await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, fixture.endpoint)).events.filter(event => event.kind === "delivery-ack");
    assert.deepEqual(new Set(delivered.map(event => event.eventId)), new Set(acknowledgments.map(item => item.eventId)));
}));

// Admission: state-aware send is the durable mutation boundary; runtime prechecks cannot prevent a policy change before the mesh lock is acquired.
// Given stale dispatch authority for an idle target, when send crosses its locked mutation boundary, no task capacity is reserved.
void test("idle state-aware send fences dispatch authority before reservation", async () => withRoot("mesh-send-authority-idle-", async root => {
    const fixture = await eventFixture(root);
    const completion = { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile };
    await assert.rejects(registerStateAwareMeshSend(root, fixture.mesh.meshId, { callerEndpointId: fixture.endpoint.endpointId, callerEndpointSessionFile: fixture.endpoint.sessionFile, toolCallId: "stale-idle-send", canonicalArguments: { agentId: fixture.agentId, message: "must fail" }, agentId: fixture.agentId, message: "must fail", completion, authority: { requesterEndpointId: fixture.endpoint.endpointId, requesterEndpointSessionFile: fixture.endpoint.sessionFile, epochId: fixture.epoch.epochId, policyDigest: "invalid", targetRole: "worker", selectedProfile: "pi-medium" } }), /policy digest changed/u);
    const reservations = await Promise.all((await readdir(meshPaths(root, fixture.mesh.meshId).reservations)).map(async name => JSON.parse(await readFile(join(meshPaths(root, fixture.mesh.meshId).reservations, name), "utf8")) as Record<string, unknown>));
    assert.equal(reservations.filter(item => item.kind === "existing-agent-task" && item.agentId === fixture.agentId).length, 0);
}));

// Given stale dispatch authority for a busy target, when send crosses its locked mutation boundary, the active task receives no intervention.
void test("busy state-aware send fences dispatch authority before intervention", async () => withRoot("mesh-send-authority-busy-", async root => {
    const fixture = await eventFixture(root);
    const agentEndpoint = await bindEventAgentEndpoint(root, fixture.mesh.meshId, fixture.agentId);
    const completion = { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile };
    await createTask(root, fixture.mesh.meshId, fixture.agentId, "active", { requesterEndpointId: fixture.endpoint.endpointId, completion });
    await assert.rejects(registerStateAwareMeshSend(root, fixture.mesh.meshId, { callerEndpointId: fixture.endpoint.endpointId, callerEndpointSessionFile: fixture.endpoint.sessionFile, toolCallId: "stale-busy-send", canonicalArguments: { agentId: fixture.agentId, message: "must fail" }, endpoint: agentEndpoint, agentId: fixture.agentId, message: "must fail", completion, authority: { requesterEndpointId: fixture.endpoint.endpointId, requesterEndpointSessionFile: fixture.endpoint.sessionFile, epochId: fixture.epoch.epochId, policyDigest: "invalid", targetRole: "worker", selectedProfile: "pi-medium" } }), /policy digest changed/u);
    assert.deepEqual((await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, agentEndpoint)).events, []);
}));

// Admission: report routing is durable peer transport outside type coverage.
// Given an agent report and a retry, when the report is routed to its root endpoint, the root observes one persisted report with the stable report identity.
void test("reports route durably to the requested endpoint without duplicate retries", async () => withRoot("mesh-report-", async root => {
    const fixture = await eventFixture(root);
    const agentEndpoint = await bindEventAgentEndpoint(root, fixture.mesh.meshId, fixture.agentId);
    const task = await createTask(root, fixture.mesh.meshId, fixture.agentId, "active", { requesterEndpointId: fixture.endpoint.endpointId, completion: { endpointId: fixture.endpoint.endpointId, endpointSessionFile: fixture.endpoint.sessionFile } });
    const input = { callerEndpointId: agentEndpoint.endpointId, callerEndpointSessionFile: agentEndpoint.sessionFile, toolCallId: "report-call", endpoint: fixture.endpoint, agentId: fixture.agentId, taskId: task.request.taskId, summary: "Bounded report", canonicalArguments: { taskId: task.request.taskId, summary: "Bounded report" } };
    const first = await registerMeshReport(root, fixture.mesh.meshId, input);
    assert.deepEqual(await registerMeshReport(root, fixture.mesh.meshId, input), first);
    const reports = (await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, fixture.endpoint)).events.filter(event => event.kind === "report");
    assert.equal(reports.length, 1);
    assert.deepEqual(reports[0]!.payload, { eventId: first.reportId, reportId: first.reportId, agentId: fixture.agentId, taskId: task.request.taskId, summary: "Bounded report" });
    await bindMeshEndpoint(root, fixture.mesh.meshId, { endpointId: agentEndpoint.endpointId, kind: "agent", agentId: fixture.agentId, harness: "pi", sessionId: "replacement-agent-session", sessionFile: "/replacement-agent.jsonl" });
    await assert.rejects(registerMeshReport(root, fixture.mesh.meshId, { ...input, toolCallId: "stale-report-call", canonicalArguments: { taskId: task.request.taskId, summary: "Stale report" }, summary: "Stale report" }), /binding is stale or offline/u);
}));

// Mechanical protocol validation: manually persisted v6 completion and signal records are readable, while only intervention context inclusion may create delivery acknowledgments.
void test("v6 completion and signal events remain readable without generating delivery acknowledgments", async () => withRoot("mesh-legacy-events-", async root => {
    const fixture = await eventFixture(root);
    const agentEndpoint = await bindEventAgentEndpoint(root, fixture.mesh.meshId, fixture.agentId);
    const completionId = randomUUID();
    const signalId = randomUUID();
    const createdAt = new Date().toISOString();
    await writeFile(join(meshPaths(root, fixture.mesh.meshId).events, `${completionId}.json`), JSON.stringify({ schemaVersion: 1, meshId: fixture.mesh.meshId, eventId: completionId, endpointId: agentEndpoint.endpointId, endpointSessionFile: agentEndpoint.sessionFile, endpointBindingId: agentEndpoint.bindingId, senderEndpointId: fixture.endpoint.endpointId, delivery: "steer", state: "pending", kind: "completion", payload: { eventId: completionId, batchId: randomUUID(), settledAt: createdAt, tasks: [{ taskId: randomUUID(), agentId: fixture.agentId, state: "succeeded" }] }, createdAt }));
    await writeFile(join(meshPaths(root, fixture.mesh.meshId).events, `${signalId}.json`), JSON.stringify({ schemaVersion: 1, meshId: fixture.mesh.meshId, eventId: signalId, endpointId: agentEndpoint.endpointId, endpointSessionFile: agentEndpoint.sessionFile, endpointBindingId: agentEndpoint.bindingId, senderEndpointId: fixture.endpoint.endpointId, delivery: "followUp", state: "pending", kind: "signal", payload: { topic: "legacy", text: "readable" }, createdAt }));
    await Promise.all([completionId, signalId].map(eventId => indexEventCreation(root, fixture.mesh.meshId, { endpointId: agentEndpoint.endpointId, endpointSessionFile: agentEndpoint.sessionFile, bindingId: agentEndpoint.bindingId, eventId, createdAt })));
    assert.deepEqual((await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, agentEndpoint)).events.map(event => event.kind).sort(), ["completion", "signal"]);
    assert.deepEqual(await acknowledgeMeshContextInterventions(root, fixture.mesh.meshId, agentEndpoint, [completionId, signalId]), []);
    assert.deepEqual((await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, fixture.endpoint)).events, []);
}));

// Admission: endpoint generation fencing protects durable state from delayed runtime callbacks; session identity alone cannot detect same-session reloads.
// Given a same-session endpoint rebind, stale snapshots, injection, acknowledgement, and offline callbacks fail while the current binding can deliver existing events.
void test("endpoint bindingId fences delivery lifecycle mutations", async () => withRoot("mesh-endpoint-generation-", async root => {
    const fixture = await eventFixture(root);
    const sender = await bindEventAgentEndpoint(root, fixture.mesh.meshId, fixture.agentId);
    const report = await registerMeshReport(root, fixture.mesh.meshId, { callerEndpointId: sender.endpointId, callerEndpointSessionFile: sender.sessionFile, toolCallId: "generation", endpoint: fixture.endpoint, agentId: fixture.agentId, taskId: randomUUID(), summary: "Ready", canonicalArguments: { summary: "Ready" } });
    const replacement = await bindMeshEndpoint(root, fixture.mesh.meshId, { endpointId: fixture.endpoint.endpointId, kind: "root", harness: "pi", sessionId: fixture.endpoint.sessionId, sessionFile: fixture.endpoint.sessionFile });
    assert.notEqual(replacement.bindingId, fixture.endpoint.bindingId);
    await assert.rejects(readEndpointDeliverySnapshot(root, fixture.mesh.meshId, fixture.endpoint), /rotated or went offline/u);
    await assert.rejects(markMeshEventsInjected(root, fixture.mesh.meshId, fixture.endpoint, [report.reportId]), /rotated or went offline/u);
    await assert.rejects(acknowledgeMeshEvents(root, fixture.mesh.meshId, fixture.endpoint, [report.reportId]), /rotated or went offline/u);
    await setMeshEndpointOffline(root, fixture.mesh.meshId, replacement.endpointId, fixture.endpoint);
    assert.equal((await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, replacement)).events.length, 0);
    const replacementReport = await registerMeshReport(root, fixture.mesh.meshId, { callerEndpointId: sender.endpointId, callerEndpointSessionFile: sender.sessionFile, toolCallId: "replacement-generation", endpoint: replacement, agentId: fixture.agentId, taskId: randomUUID(), summary: "Current", canonicalArguments: { summary: "Current" } });

    await markMeshEventsInjected(root, fixture.mesh.meshId, replacement, [replacementReport.reportId, replacementReport.reportId]);
    const injected = (await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, replacement)).events[0]!;
    assert.equal(injected.state, "injected");
    await markMeshEventsInjected(root, fixture.mesh.meshId, replacement, [replacementReport.reportId]);
    assert.equal((await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, replacement)).events[0]!.injectedAt, injected.injectedAt);
    await acknowledgeMeshEvents(root, fixture.mesh.meshId, replacement, [replacementReport.reportId, replacementReport.reportId]);
    assert.deepEqual((await readEndpointDeliverySnapshot(root, fixture.mesh.meshId, replacement)).events, []);
    const path = join(meshPaths(root, fixture.mesh.meshId).events, `${replacementReport.reportId}.json`);
    const persisted = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    assert.equal(persisted.state, "acknowledged");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
}));
