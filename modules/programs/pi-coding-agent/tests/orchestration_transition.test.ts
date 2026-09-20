import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { buildLaunchEnvelope, type ChildCatalog, type ChildDefinition } from "../extensions_src/utilities/agent_types.ts";
import { availableContext, publishAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { requestPressureAdmission } from "../extensions_src/utilities/orchestration_admission.ts";
import { bindMeshEndpoint, materializeMeshCompletionEvents, readMeshEndpoint, registerStateAwareMeshSend, reserveNewAgentMeshSendSubmission } from "../extensions_src/utilities/orchestration_events.ts";
import { writeAtomicJson } from "../extensions_src/utilities/orchestration_json.ts";
import { orchestrationIndexPath } from "../extensions_src/utilities/orchestration_index.ts";
import { bindAgentRuntime } from "../extensions_src/utilities/orchestration_runtime.ts";
import {
    agentPaths,
    attachRootMesh,
    beginMeshClose,
    commitMeshReservation,
    completeMeshClose,
    createTask,
    ensurePolicyEpoch,
    finishTask,
    heartbeatRootLease,
    initializeMesh,
    patchAgentStatus,
    prepareAgent,
    publishAgent,
    taskPaths,
    readAgentSnapshot,
    readMesh,
    readMeshReservation,
    readPolicyEpoch,
    releaseMeshReservation,
    reserveMeshCapacity,
} from "../extensions_src/utilities/orchestration_store.ts";
import {
    assertNoParentTransitionUnlocked,
    parentTransitionPath,
    prepareParentTransition,
    readParentTransition,
    releaseParentTransition,
    validateParentTransitionFence,
} from "../extensions_src/utilities/orchestration_transition.ts";
import { cancelPressureAdmission, listPressureAdmissions } from "../extensions_src/utilities/orchestration_admission.ts";
import { withTemporaryRoot as withRoot } from "./test_helpers.ts";

const syntheticExecution = { models: ["provider/model"], thinkingLevel: "medium" as const, harness: "pi" as const };
const syntheticChild = (name = "worker", extra: Record<string, unknown> = {}): ChildDefinition => ({ selector: { agent: name, access: "read" as const }, description: `Synthetic ${name}`, tools: [], instructions: "Return the bounded result.", contextPolicy: "project" as const, childExtensionContributions: [], execution: syntheticExecution, targets: [] as string[], gc: { collectAt: 2, retain: 1, pressureFloor: 0 }, ...extra });
const syntheticCatalog = (children: Record<string, ChildDefinition>): ChildCatalog => ({ schemaVersion: 1 as const, children });
const budgets = { maxLiveAgents: 4, maxConcurrentTasks: 4, maxTasksPerMesh: 16 };
const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" };
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };
const SESSION_ID = "root-session";
const SESSION_FILE = "/root.jsonl";

interface RootFixture {
    root: string;
    meshId: string;
    leaseId: string;
    endpointId: string;
    endpointSessionFile: string;
    endpointBindingId: string;
    agentId?: string;
    runtimeId?: string;
}
async function createRootFixture(root: string): Promise<RootFixture> {
    const mesh = await initializeMesh(root, { rootSessionId: SESSION_ID, rootSessionFile: SESSION_FILE, recoverable: true, budgets });
    const lease = await attachRootMesh(root, mesh.meshId, { rootSessionId: SESSION_ID, budgets, rootSessionFile: SESSION_FILE });
    await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: SESSION_ID, sessionFile: SESSION_FILE });
    await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", catalog: syntheticCatalog({ worker: syntheticChild() }), callPolicy: { modes: { ops: { targets: ["worker"] } } } });
    const endpoint = await readMeshEndpoint(root, mesh.meshId, `root:${mesh.meshId}`);
    return { root, meshId: mesh.meshId, leaseId: lease.leaseId, endpointId: `root:${mesh.meshId}`, endpointSessionFile: SESSION_FILE, endpointBindingId: endpoint.bindingId };
}
function prepareInput(fixture: RootFixture, kind: "mode" | "handoff" = "mode") {
    return {
        requestId: randomUUID(),
        rootLeaseId: fixture.leaseId,
        rootSessionId: SESSION_ID,
        kind,
        fromMode: "ops",
        ...(kind === "mode" ? { targetMode: "recon" } : {}),
        expectedBinding: { endpointId: fixture.endpointId, endpointSessionFile: fixture.endpointSessionFile, bindingId: fixture.endpointBindingId },
    };
}
async function createIdleChild(fixture: RootFixture): Promise<{ agentId: string; runtimeId: string }> {
    const { root, meshId } = fixture;
    const definition = syntheticChild("worker");
    const mesh = await readMesh(root, meshId);
    const epochId = mesh.currentEpochId!;
    const reservation = await reserveMeshCapacity(root, meshId, "new-agent-task");
    const prepared = await prepareAgent(root, meshId, { reservationId: reservation.reservationId, childId: "worker", harness: definition.execution.harness, cwd: root, definitionSnapshot: definition, launchEnvelope: "pending", epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    const epoch = await readPolicyEpoch(root, meshId, epochId);
    const envelope = buildLaunchEnvelope({ meshId, agentId: prepared.agentId, epochId, childId: "worker", snapshot: epoch, childExtensions: Object.fromEntries(Object.keys(epoch.children).map(name => [name, ["/bridge.ts"]])) });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
    await publishAgent(root, meshId, prepared.paths, { agentId: prepared.agentId, epochId, childId: "worker", harness: definition.execution.harness, cwd: root, definitionSnapshot: definition, launchEnvelope: envelopePath, tmux, capabilities, creatorSessionId: "creator" });
    await patchAgentStatus(root, meshId, prepared.agentId, { state: "idle", bridgeReady: true });
    const runtimeId = randomUUID();
    await bindAgentRuntime(root, meshId, prepared.agentId, { runtimeId, kind: "external" });
    const now = new Date().toISOString();
    await publishAgentActivity(root, meshId, prepared.agentId, { runtimeId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: now, observedAt: now, heartbeatAt: now, context: availableContext(10, 100_000, 100) });
    return { agentId: prepared.agentId, runtimeId };
}
async function completeChildTask(fixture: RootFixture, agentId: string): Promise<string> {
    const { root, meshId, endpointId, endpointSessionFile } = fixture;
    const task = await createTask(root, meshId, agentId, { prompt: "bounded synthetic work", purpose: "synthetic purpose" }, { requesterEndpointId: endpointId, completion: { endpointId, endpointSessionFile, bindingId: (await readMeshEndpoint(root, meshId, endpointId)).bindingId } });
    await finishTask(root, meshId, task.request.taskId, { outcome: "succeeded", output: "done" });
    return task.request.taskId;
}

void test("prepare succeeds at full quiescence and records one short-lived fence", async () => withRoot("parent-transition-prepare-", async root => {
    const fixture = await createRootFixture(root);
    const child = await createIdleChild(fixture);
    await completeChildTask(fixture, child.agentId);
    const fence = await prepareParentTransition(root, fixture.meshId, prepareInput(fixture));
    assert.equal(fence.requestId, validateParentTransitionFence(fence).requestId);
    assert.equal(fence.rootLeaseId, fixture.leaseId);
    assert.equal(fence.rootSessionId, SESSION_ID);
    assert.equal(fence.kind, "mode");
    assert.equal(fence.fromMode, "ops");
    assert.equal(fence.targetMode, "recon");
    assert.match(fence.token, /^[0-9a-f-]{36}$/u);
    const read = await readParentTransition(root, fixture.meshId);
    assert.deepEqual(read, fence);
    // Terminal task history and a normal idle child are not rejection reasons.
    await releaseParentTransition(root, fixture.meshId, { token: fence.token, rootLeaseId: fixture.leaseId });
    assert.equal(await readParentTransition(root, fixture.meshId), undefined);
}));

void test("prepare rejects nonterminal work and leaves no fence", async () => withRoot("parent-transition-nonterminal-", async root => {
    const fixture = await createRootFixture(root);
    const child = await createIdleChild(fixture);
    await createTask(root, fixture.meshId, child.agentId, { prompt: "still running", purpose: "synthetic purpose" }, { requesterEndpointId: fixture.endpointId });
    await assert.rejects(prepareParentTransition(root, fixture.meshId, prepareInput(fixture)), /quiescence/u);
    assert.equal(await readParentTransition(root, fixture.meshId), undefined);
}));

void test("prepare rejects a creating agent and an idle agent that still references an active task", async () => withRoot("parent-transition-agent-states-", async root => {
    const fixture = await createRootFixture(root);
    const definition = syntheticChild("worker");
    const reservation = await reserveMeshCapacity(root, fixture.meshId, "new-agent-task");
    const mesh = await readMesh(root, fixture.meshId);
    await prepareAgent(root, fixture.meshId, { reservationId: reservation.reservationId, childId: "worker", harness: "pi", cwd: root, definitionSnapshot: definition, launchEnvelope: "pending", epochId: mesh.currentEpochId!, provenance: { creatorSessionId: "creator" }, capabilities });
    await assert.rejects(prepareParentTransition(root, fixture.meshId, prepareInput(fixture)), /quiescence: agent .* is creating/u);

    const created = await createIdleChild(fixture);
    const task = await createTask(root, fixture.meshId, created.agentId, { prompt: "leave a reference", purpose: "synthetic purpose" }, { requesterEndpointId: fixture.endpointId });
    await finishTask(root, fixture.meshId, task.request.taskId, { outcome: "succeeded", output: "done" });
    await patchAgentStatus(root, fixture.meshId, created.agentId, { activeTaskId: task.request.taskId });
    const snapshot = await readAgentSnapshot(root, fixture.meshId, created.agentId);
    assert.equal(snapshot.status.state, "idle");
    await assert.rejects(prepareParentTransition(root, fixture.meshId, prepareInput(fixture)), /quiescence/u);
}));

void test("prepare rejects pending and unmaterialized committed reservations", async () => withRoot("parent-transition-reservations-", async root => {
    const fixture = await createRootFixture(root);
    const pending = await reserveMeshCapacity(root, fixture.meshId, "new-agent-task");
    await assert.rejects(prepareParentTransition(root, fixture.meshId, prepareInput(fixture)), /reservation .* pending/u);
    await releaseMeshReservation(root, fixture.meshId, pending.reservationId, "test");

    const unmaterialized = await reserveMeshCapacity(root, fixture.meshId, "new-agent-task");
    await commitMeshReservation(root, fixture.meshId, unmaterialized.reservationId, { agentId: randomUUID() });
    const committed = await readMeshReservation(root, fixture.meshId, unmaterialized.reservationId);
    assert.equal(committed.state, "committed");
    await assert.rejects(prepareParentTransition(root, fixture.meshId, prepareInput(fixture)), /committed but not materialized/u);
    await releaseMeshReservation(root, fixture.meshId, unmaterialized.reservationId, "test");
}));

void test("prepare rejects open pressure admissions and unacknowledged root deliveries", async () => withRoot("parent-transition-admission-delivery-", async root => {
    const fixture = await createRootFixture(root);
    const child = await createIdleChild(fixture);
    await requestPressureAdmission(root, fixture.meshId, { requestId: randomUUID(), requesterAgentId: child.agentId, requesterRuntimeId: child.runtimeId! });
    await assert.rejects(prepareParentTransition(root, fixture.meshId, prepareInput(fixture)), /pressure admission/u);
    for (const admission of await listPressureAdmissions(root, fixture.meshId)) await cancelPressureAdmission(root, fixture.meshId, admission.requestId, "test cleanup");
    const taskId = await completeChildTask(fixture, child.agentId);
    await materializeMeshCompletionEvents(root, fixture.meshId, fixture.leaseId);
    await assert.rejects(prepareParentTransition(root, fixture.meshId, prepareInput(fixture)), /quiescence/u);
    void taskId;
}));

void test("prepare rejects a closed mesh, a foreign root lease, and corrupted store state", async () => withRoot("parent-transition-identity-corruption-", async root => {
    const fixture = await createRootFixture(root);

    await beginMeshClose(root, fixture.meshId, fixture.leaseId);
    await assert.rejects(prepareParentTransition(root, fixture.meshId, prepareInput(fixture)), /is closing/u);
    // A closed mesh cannot be prepared; use a fresh mesh for the remaining identity checks.
    const fresh = await createRootFixture(root);
    await releaseParentTransition(root, fresh.meshId, { token: randomUUID(), rootLeaseId: randomUUID() });
    await assert.rejects(prepareParentTransition(root, fresh.meshId, { ...prepareInput(fresh), rootLeaseId: randomUUID() }), /root lease/u);
    await assert.rejects(prepareParentTransition(root, fresh.meshId, { ...prepareInput(fresh), rootSessionId: "other-session" }), /root session/u);
    await completeMeshClose(root, fixture.meshId, fixture.leaseId);

    const corrupt = await createRootFixture(root);
    const corruptChild = await createIdleChild(corrupt);
    await writeFile(agentPaths(root, corrupt.meshId, corruptChild.agentId).status, "not json", { mode: 0o600 });
    await assert.rejects(prepareParentTransition(root, corrupt.meshId, prepareInput(corrupt)), /agent status|schemaVersion|JSON/u);
    assert.equal(await readParentTransition(root, corrupt.meshId), undefined);
}));

void test("an existing fence is reported, never auto-deleted, and release requires ownership", async () => withRoot("parent-transition-fence-ownership-", async root => {
    const fixture = await createRootFixture(root);
    await createIdleChild(fixture);
    const fence = await prepareParentTransition(root, fixture.meshId, prepareInput(fixture));
    await assert.rejects(prepareParentTransition(root, fixture.meshId, prepareInput(fixture)), /already has an active parent transition fence/u);
    assert.deepEqual(await readParentTransition(root, fixture.meshId), fence);

    await assert.rejects(releaseParentTransition(root, fixture.meshId, { token: randomUUID(), rootLeaseId: fixture.leaseId }), /ownership mismatch/u);
    await assert.rejects(releaseParentTransition(root, fixture.meshId, { token: fence.token, rootLeaseId: randomUUID() }), /ownership mismatch/u);
    assert.deepEqual(await readParentTransition(root, fixture.meshId), fence);
    await releaseParentTransition(root, fixture.meshId, { token: fence.token, rootLeaseId: fixture.leaseId });
    assert.equal(await readParentTransition(root, fixture.meshId), undefined);
    // Releasing an absent fence is a no-op; the handoff close path may run after normal release.
    await releaseParentTransition(root, fixture.meshId, { token: fence.token, rootLeaseId: fixture.leaseId });
}));

void test("a fence suspends new work but not lease maintenance and release paths", async () => withRoot("parent-transition-fence-suspension-", async root => {
    const fixture = await createRootFixture(root);
    const child = await createIdleChild(fixture);
    const fence = await prepareParentTransition(root, fixture.meshId, prepareInput(fixture));
    await assert.rejects(reserveMeshCapacity(root, fixture.meshId, "new-agent-task"), /parent transition in progress/u);
    await assert.rejects(createTask(root, fixture.meshId, child.agentId, { prompt: "blocked while fenced", purpose: "synthetic purpose" }, { requesterEndpointId: fixture.endpointId }), /parent transition in progress/u);
    const binding = (await readMeshEndpoint(root, fixture.meshId, fixture.endpointId)).bindingId;
    await assert.rejects(registerStateAwareMeshSend(root, fixture.meshId, { callerEndpointId: fixture.endpointId, callerEndpointSessionFile: fixture.endpointSessionFile, toolCallId: randomUUID(), canonicalArguments: { agent: "worker", access: "read", purpose: "blocked", message: "blocked" }, agentId: child.agentId, message: "blocked", purpose: "blocked", completion: { endpointId: fixture.endpointId, endpointSessionFile: fixture.endpointSessionFile, bindingId: binding } }), /parent transition in progress/u);
    await assert.rejects(reserveNewAgentMeshSendSubmission(root, fixture.meshId, { callerEndpointId: fixture.endpointId, callerEndpointSessionFile: fixture.endpointSessionFile, toolCallId: randomUUID(), canonicalArguments: { agent: "worker", access: "read", purpose: "blocked", message: "blocked" } }), /parent transition in progress/u);
    // Recovery paths stay available so shutdown and stop collection are never trapped.
    await heartbeatRootLease(root, fixture.meshId, fixture.leaseId);
    await releaseParentTransition(root, fixture.meshId, { token: fence.token, rootLeaseId: fixture.leaseId });
    await reserveMeshCapacity(root, fixture.meshId, "new-agent-task").then(release);
    async function release(reservation: Awaited<ReturnType<typeof reserveMeshCapacity>>) { await releaseMeshReservation(root, fixture.meshId, reservation.reservationId, "unfenced again"); }
    assert.equal(await readParentTransition(root, fixture.meshId), undefined);
}));

void test("a corrupted fence is unavailable, never treated as empty", async () => withRoot("parent-transition-corrupt-fence-", async root => {
    const fixture = await createRootFixture(root);
    await writeAtomicJson(parentTransitionPath(root, fixture.meshId), { schemaVersion: 1, requestId: "corrupt" });
    await assert.rejects(assertNoParentTransitionUnlocked(root, fixture.meshId), /requestId must be a UUID/u);
    await assert.rejects(reserveMeshCapacity(root, fixture.meshId, "new-agent-task"), /requestId must be a UUID/u);
}));

void test("handoff kind records without targetMode and validates fence payloads", async () => withRoot("parent-transition-handoff-kind-", async root => {
    const fixture = await createRootFixture(root);
    const fence = await prepareParentTransition(root, fixture.meshId, prepareInput(fixture, "handoff"));
    assert.equal(fence.kind, "handoff");
    assert.equal(fence.targetMode, undefined);
    assert.throws(() => validateParentTransitionFence({ ...fence, unexpected: true }), /unknown keys/u);
    assert.throws(() => validateParentTransitionFence({ ...fence, kind: "other" }), /kind is invalid/u);
    await releaseParentTransition(root, fixture.meshId, { token: fence.token, rootLeaseId: fixture.leaseId });
}));

void test("a fence-less, child-less root mesh still prepares and releases cleanly", async () => withRoot("parent-transition-empty-mesh-", async root => {
    const fixture = await createRootFixture(root);
    const fence = await prepareParentTransition(root, fixture.meshId, prepareInput(fixture));
    assert.equal(fence.schemaVersion, 1);
    await releaseParentTransition(root, fixture.meshId, { token: fence.token, rootLeaseId: fixture.leaseId });
}));

// Mechanical check: a fence must suspend every new admission path, not just the reserved mutation points.
// Given a held fence, when a child requests pressure admission, the request is refused without creating an admission.
void test("pressure admission is rejected while a fence is held", async () => withRoot("parent-transition-admission-fence-", async root => {
    const fixture = await createRootFixture(root);
    const fence = await prepareParentTransition(root, fixture.meshId, prepareInput(fixture));
    await assert.rejects(requestPressureAdmission(root, fixture.meshId, { requestId: randomUUID(), requesterAgentId: randomUUID(), requesterRuntimeId: randomUUID() }), /parent transition/u);
    await releaseParentTransition(root, fixture.meshId, { token: fence.token, rootLeaseId: fixture.leaseId });
    assert.equal(await readParentTransition(root, fixture.meshId), undefined);
}));

// Mechanical check: strict quiescence must fail closed on records that are present but unreadable, never skip them as empty.
// Given corrupted agent and task directories, when a transition prepares, each corruption is reported as a distinct quiescence failure.
void test("prepare fails closed on corrupted agent and task records", async () => withRoot("parent-transition-corrupt-records-", async root => {
    const fixture = await createRootFixture(root);
    const brokenAgent = randomUUID();
    await mkdir(agentPaths(root, fixture.meshId, brokenAgent).directory, { recursive: true });
    await assert.rejects(prepareParentTransition(root, fixture.meshId, prepareInput(fixture)), /has no status record/u);
    await rm(agentPaths(root, fixture.meshId, brokenAgent).directory, { recursive: true, force: true });

    const brokenTask = randomUUID();
    await mkdir(taskPaths(root, fixture.meshId, brokenTask).directory, { recursive: true });
    await assert.rejects(prepareParentTransition(root, fixture.meshId, prepareInput(fixture)), /is missing its record/u);
    await rm(taskPaths(root, fixture.meshId, brokenTask).directory, { recursive: true, force: true });

    const agentsDir = agentPaths(root, fixture.meshId, brokenAgent).directory;
    await mkdir(join(agentsDir, "..", "not-a-uuid"), { recursive: true });
    await assert.rejects(prepareParentTransition(root, fixture.meshId, prepareInput(fixture)), /unrecognized state entry/u);
}));

// Mechanical check: the delivery snapshot used for quiescence must not skip index entries whose referenced records disappeared.
// Given a root index entry pointing at a missing task, when a transition prepares, the dangling reference is a quiescence failure.
void test("prepare fails closed on dangling endpoint task references", async () => withRoot("parent-transition-dangling-index-", async root => {
    const fixture = await createRootFixture(root);
    const reference = { schemaVersion: 1, meshId: fixture.meshId, endpointId: fixture.endpointId, endpointSessionFile: fixture.endpointSessionFile, bindingId: fixture.endpointBindingId, taskId: randomUUID(), agentId: randomUUID(), createdAt: new Date().toISOString() };
    await writeAtomicJson(orchestrationIndexPath(root, fixture.meshId, "endpoint-tasks", { endpointId: fixture.endpointId, endpointSessionFile: fixture.endpointSessionFile, bindingId: fixture.endpointBindingId, taskId: reference.taskId }), reference);
    await assert.rejects(prepareParentTransition(root, fixture.meshId, prepareInput(fixture)), /is missing its record/u);
}));

// Mechanical check: a request bound to an old endpoint binding must not validate after the binding rotated.
// Given a request captured against the current binding, when the endpoint rebinds before prepare, the prepare rejects as stale.
void test("prepare rejects a request bound to a rotated endpoint binding", async () => withRoot("parent-transition-binding-rotation-", async root => {
    const fixture = await createRootFixture(root);
    await bindMeshEndpoint(root, fixture.meshId, { endpointId: fixture.endpointId, kind: "root", harness: "pi", sessionId: SESSION_ID, sessionFile: SESSION_FILE });
    const input = prepareInput(fixture);
    input.expectedBinding = { endpointId: fixture.endpointId, endpointSessionFile: fixture.endpointSessionFile, bindingId: fixture.endpointBindingId };
    await assert.rejects(prepareParentTransition(root, fixture.meshId, input), /binding is stale/u);
}));
