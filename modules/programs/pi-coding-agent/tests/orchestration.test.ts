import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildLaunchEnvelope, policyDigest, settledAgentCatalog, settledAgentDefinition, validateLaunchEnvelope } from "../extensions_src/utilities/agent_types.ts";
import {
    attachRootMesh,
    beginMeshClose,
    completeMeshClose,
    createTask,
    ensurePolicyEpoch,
    epochPath,
    finishTask,
    initializeMesh,
    meshPaths,
    patchAgentStatus,
    prepareAgent,
    publishAgent,
    readAgentSnapshot,
    readMesh,
    readMeshBudgetUsage,
    readPolicyEpoch,
    reconcileMeshReservations,
    reconcileMeshState,
    releaseMeshReservation,
    reserveMeshCapacity,
    reservationPath,
    taskPaths,
} from "../extensions_src/utilities/orchestration_store.ts";
import { emptyUsage } from "../extensions_src/utilities/orchestration_types.ts";

const budgets = { maxLiveAgents: 2, maxConcurrentTasks: 2, maxTasksPerMesh: 8 };
const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" };
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };

async function withRoot(prefix: string, run: (root: string) => Promise<void>): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), prefix));
    try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function createPublishedAgent(stateRoot: string, meshId: string, epochId: string, role = "worker") {
    const definition = settledAgentDefinition(role);
    const reservation = await reserveMeshCapacity(stateRoot, meshId, "new-agent-task");
    const prepared = await prepareAgent(stateRoot, meshId, { reservationId: reservation.reservationId, agent: role, harness: definition.harness, cwd: stateRoot, agentSnapshot: definition, launchEnvelope: "pending", epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    const epoch = await readPolicyEpoch(stateRoot, meshId, epochId);
    const childExtensions = Object.fromEntries(epoch.roleSet.map(name => [name, ["/popup.ts", "/orchestration.ts", ...epoch.roles[name]!.childExtensionContributions, "/bridge.ts"]]));
    const envelope = buildLaunchEnvelope({ meshId, agentId: prepared.agentId, epochId, agent: role, mode: epoch.mode, roleSet: epoch.roleSet, catalog: settledAgentCatalog(), childExtensions });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
    await publishAgent(stateRoot, meshId, prepared.paths, { agentId: prepared.agentId, epochId, agent: role, harness: definition.harness, cwd: stateRoot, agentSnapshot: definition, launchEnvelope: envelopePath, tmux, capabilities, creatorSessionId: "creator" });
    await patchAgentStatus(stateRoot, meshId, prepared.agentId, { state: "idle", bridgeReady: true });
    return { ...prepared, reservation };
}

void test("persisted roots reuse an open lease, close durably, and require a fresh mesh after close", async () => withRoot("mesh-lifecycle-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "session", rootSessionFile: "/session.jsonl", recoverable: true, budgets });
    const first = await attachRootMesh(root, mesh.meshId, { rootSessionId: "session", rootSessionFile: "/session.jsonl", pid: 101, tmuxServerPid: "10", tmuxSessionId: "$1" });
    const reload = await attachRootMesh(root, mesh.meshId, { rootSessionId: "session", rootSessionFile: "/session.jsonl", pid: 101, tmuxServerPid: "10", tmuxSessionId: "$1" });
    assert.equal(reload.leaseId, first.leaseId);
    assert.equal((await beginMeshClose(root, mesh.meshId, first.leaseId)).state, "closing");
    assert.equal((await completeMeshClose(root, mesh.meshId, first.leaseId)).state, "closed");
    await assert.rejects(attachRootMesh(root, mesh.meshId, { rootSessionId: "session", rootSessionFile: "/session.jsonl" }), /closed/u);
    const reopened = await initializeMesh(root, { rootSessionId: "session", rootSessionFile: "/session.jsonl", recoverable: true, budgets });
    assert.notEqual(reopened.meshId, mesh.meshId);
}));

void test("stale persisted leases recover only with dead-PID, same-session, and matching-tmux evidence", async () => withRoot("mesh-lease-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "session", rootSessionFile: "/session.jsonl", recoverable: true, budgets });
    const first = await attachRootMesh(root, mesh.meshId, { rootSessionId: "session", rootSessionFile: "/session.jsonl", pid: 101, tmuxServerPid: "10", tmuxSessionId: "$1" });
    for (const evidence of [
        { pidAlive: true, sameSession: true, tmuxMatches: true },
        { pidAlive: false, sameSession: false, tmuxMatches: true },
        { pidAlive: false, sameSession: true, tmuxMatches: false },
    ]) await assert.rejects(attachRootMesh(root, mesh.meshId, { rootSessionId: "session", rootSessionFile: "/session.jsonl", pid: 202, inspectExisting: async () => evidence }), /active root lease/u);
    const recovered = await attachRootMesh(root, mesh.meshId, { rootSessionId: "session", rootSessionFile: "/session.jsonl", pid: 202, tmuxServerPid: "10", tmuxSessionId: "$1", inspectExisting: async existing => ({ pidAlive: false, sameSession: existing.rootSessionId === "session" && existing.rootSessionFile === "/session.jsonl", tmuxMatches: existing.tmuxServerPid === "10" && existing.tmuxSessionId === "$1" }) });
    assert.notEqual(recovered.leaseId, first.leaseId);
}));

void test("an ephemeral root remains nonrecoverable while supporting the persisted task lifecycle", async () => withRoot("mesh-ephemeral-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "memory", recoverable: false, budgets });
    await attachRootMesh(root, mesh.meshId, { rootSessionId: "memory", pid: 101 });
    await assert.rejects(attachRootMesh(root, mesh.meshId, { rootSessionId: "other", pid: 202, inspectExisting: async () => ({ pidAlive: false, sameSession: false, tmuxMatches: true }) }), /nonrecoverable/u);
    const roles = { worker: settledAgentDefinition("worker") };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles });
    const agent = await createPublishedAgent(root, mesh.meshId, epoch.epochId);
    const task = await createTask(root, mesh.meshId, agent.agentId, "Complete one bounded task");
    await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "done" });
    assert.equal((await readAgentSnapshot(root, mesh.meshId, agent.agentId, task.request.taskId)).task?.result?.output, "done");
}));

void test("policy changes create immutable epochs while restore and nested launch retain the selected authority snapshot", async () => withRoot("mesh-epoch-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "session", recoverable: true, budgets });
    const opsRoles = { worker: settledAgentDefinition("worker"), validator: settledAgentDefinition("validator") };
    const ops = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker", "validator"], roles: opsRoles });
    const duplicate = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker", "validator"], roles: opsRoles });
    assert.equal(duplicate.epochId, ops.epochId);
    const reconRoles = { explorer: settledAgentDefinition("explorer") };
    const recon = await ensurePolicyEpoch(root, mesh.meshId, { mode: "recon", roleSet: ["explorer"], roles: reconRoles });
    assert.notEqual(recon.epochId, ops.epochId);
    const restored = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker", "validator"], roles: opsRoles, restoreEpochId: ops.epochId });
    assert.equal(restored.epochId, ops.epochId);
    assert.deepEqual((await readPolicyEpoch(root, mesh.meshId, recon.epochId)).roleSet, ["explorer"]);
    assert.equal((await readMesh(root, mesh.meshId)).currentEpochId, ops.epochId);
}));

void test("reload accepts a prior realization snapshot and advances to the current relocated policy", async () => withRoot("mesh-relocated-policy-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "session", recoverable: true, budgets });
    const currentReviewer = settledAgentDefinition("reviewer");
    const currentRoles = { reviewer: currentReviewer };
    const original = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["reviewer"], roles: currentRoles });
    const priorArtifactExtension = `/nix/store/${"a".repeat(32)}-extensions_src/agent_artifact.ts`;
    const priorReviewer = { ...currentReviewer, childExtensionContributions: [priorArtifactExtension] };
    const priorRoles = { reviewer: priorReviewer };
    const persisted = JSON.parse(await readFile(epochPath(root, mesh.meshId, original.epochId), "utf8")) as Record<string, unknown>;
    persisted.roles = priorRoles;
    persisted.policyDigest = policyDigest({ mode: "ops", roleSet: ["reviewer"], roles: priorRoles });
    await writeFile(epochPath(root, mesh.meshId, original.epochId), `${JSON.stringify(persisted)}\n`);

    const historical = await readPolicyEpoch(root, mesh.meshId, original.epochId);
    assert.deepEqual(historical.roles.reviewer?.childExtensionContributions, [priorArtifactExtension]);
    const current = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["reviewer"], roles: currentRoles, restoreEpochId: original.epochId });
    assert.notEqual(current.epochId, original.epochId);
    assert.deepEqual(current.roles.reviewer?.childExtensionContributions, currentReviewer.childExtensionContributions);

    const envelope = buildLaunchEnvelope({ meshId: mesh.meshId, agentId: randomUUID(), epochId: original.epochId, agent: "reviewer", mode: "ops", roleSet: ["reviewer"], catalog: settledAgentCatalog(), childExtensions: { reviewer: [priorArtifactExtension] } });
    const priorEnvelope = { ...envelope, self: priorReviewer, catalog: priorRoles, policyDigest: policyDigest({ mode: "ops", roleSet: ["reviewer"], roles: priorRoles }) };
    assert.deepEqual(validateLaunchEnvelope(priorEnvelope).self.childExtensionContributions, [priorArtifactExtension]);
    const untrustedReviewer = { ...currentReviewer, childExtensionContributions: ["/tmp/extensions_src/agent_artifact.ts"] };
    assert.throws(() => validateLaunchEnvelope({ ...envelope, self: untrustedReviewer, catalog: { reviewer: untrustedReviewer } }), /settled reviewer capability contract/u);
}));

void test("concurrent admission never exceeds mesh budgets and abandoned reservations become reusable", async () => withRoot("mesh-budget-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "session", recoverable: true, budgets: { maxLiveAgents: 1, maxConcurrentTasks: 1, maxTasksPerMesh: 1 } });
    const raced = await Promise.allSettled([reserveMeshCapacity(root, mesh.meshId, "new-agent-task"), reserveMeshCapacity(root, mesh.meshId, "new-agent-task")]);
    assert.equal(raced.filter(result => result.status === "fulfilled").length, 1);
    assert.match((raced.find(result => result.status === "rejected") as PromiseRejectedResult).reason.message, /capacity exhausted/u);
    assert.deepEqual(await readMeshBudgetUsage(root, mesh.meshId), { liveAgents: 0, concurrentTasks: 0, lifetimeTasks: 0, pendingLiveSlots: 1, pendingTaskSlots: 1, pendingLifetimeTasks: 1 });
    assert.equal(await reconcileMeshReservations(root, mesh.meshId, async () => "absent"), 1);
    assert.equal((await reserveMeshCapacity(root, mesh.meshId, "new-agent-task")).state, "pending");
}));

void test("a released reservation cannot be resurrected by a delayed task commit", async () => withRoot("mesh-reservation-race-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "session", recoverable: true, budgets });
    const roles = { worker: settledAgentDefinition("worker") };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles });
    const agent = await createPublishedAgent(root, mesh.meshId, epoch.epochId);
    const reservation = await reserveMeshCapacity(root, mesh.meshId, "existing-agent-task", agent.agentId);
    await releaseMeshReservation(root, mesh.meshId, reservation.reservationId, "caller abandoned submission");
    await assert.rejects(createTask(root, mesh.meshId, agent.agentId, "must not commit", reservation.reservationId), /reservation does not match/u);
}));

void test("closing admission checkpoints reject preparation, publication, and task commit without leaving reserved capacity", async () => withRoot("mesh-closing-admission-", async root => {
    const definition = settledAgentDefinition("worker");
    const preparationMesh = await initializeMesh(root, { rootSessionId: "prepare", recoverable: true, budgets });
    const preparationLease = await attachRootMesh(root, preparationMesh.meshId, { rootSessionId: "prepare" });
    const preparationReservation = await reserveMeshCapacity(root, preparationMesh.meshId, "new-agent-task");
    await beginMeshClose(root, preparationMesh.meshId, preparationLease.leaseId);
    await assert.rejects(prepareAgent(root, preparationMesh.meshId, { reservationId: preparationReservation.reservationId, agent: "worker", harness: "pi", cwd: root, agentSnapshot: definition, launchEnvelope: "pending", epochId: randomUUID(), provenance: { creatorSessionId: "creator" }, capabilities }), /closing/u);
    assert.equal((await readMeshBudgetUsage(root, preparationMesh.meshId)).pendingLiveSlots, 0);

    const publicationMesh = await initializeMesh(root, { rootSessionId: "publish", recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, publicationMesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: definition } });
    const publicationReservation = await reserveMeshCapacity(root, publicationMesh.meshId, "new-agent-task");
    const prepared = await prepareAgent(root, publicationMesh.meshId, { reservationId: publicationReservation.reservationId, agent: "worker", harness: "pi", cwd: root, agentSnapshot: definition, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    const envelope = buildLaunchEnvelope({ meshId: publicationMesh.meshId, agentId: prepared.agentId, epochId: epoch.epochId, agent: "worker", mode: "ops", roleSet: ["worker"], catalog: settledAgentCatalog(), childExtensions: { worker: ["/popup.ts", "/orchestration.ts", "/bridge.ts"] } });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json"); await writeFile(envelopePath, JSON.stringify(envelope));
    const publicationLease = await attachRootMesh(root, publicationMesh.meshId, { rootSessionId: "publish" }); await beginMeshClose(root, publicationMesh.meshId, publicationLease.leaseId);
    await assert.rejects(publishAgent(root, publicationMesh.meshId, prepared.paths, { agentId: prepared.agentId, epochId: epoch.epochId, agent: "worker", harness: "pi", cwd: root, agentSnapshot: definition, launchEnvelope: envelopePath, tmux, capabilities, creatorSessionId: "creator" }), /closing/u);

    const taskMesh = await initializeMesh(root, { rootSessionId: "task", recoverable: true, budgets });
    const taskEpoch = await ensurePolicyEpoch(root, taskMesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: definition } });
    const agent = await createPublishedAgent(root, taskMesh.meshId, taskEpoch.epochId); const taskReservation = await reserveMeshCapacity(root, taskMesh.meshId, "existing-agent-task", agent.agentId); const requestedTaskId = randomUUID();
    const taskLease = await attachRootMesh(root, taskMesh.meshId, { rootSessionId: "task" }); await beginMeshClose(root, taskMesh.meshId, taskLease.leaseId);
    await assert.rejects(createTask(root, taskMesh.meshId, agent.agentId, "must not commit", taskReservation.reservationId, requestedTaskId), /closing/u);
    await assert.rejects(access(taskPaths(root, taskMesh.meshId, requestedTaskId).request), error => (error as NodeJS.ErrnoException).code === "ENOENT");
}));

void test("root reconciliation removes uncommitted task directories and settles durable task, agent, and usage state exactly once", async () => withRoot("mesh-state-reconcile-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const agent = await createPublishedAgent(root, mesh.meshId, epoch.epochId);
    const taskId = randomUUID(); const paths = taskPaths(root, mesh.meshId, taskId); const createdAt = new Date().toISOString(); await mkdir(paths.directory, { recursive: true }); await writeFile(paths.request, JSON.stringify({ schemaVersion: 1, meshId: mesh.meshId, agentId: agent.agentId, taskId, prompt: "durable request", createdAt }));
    const abandonedId = randomUUID(); await mkdir(taskPaths(root, mesh.meshId, abandonedId).directory, { recursive: true });
    await patchAgentStatus(root, mesh.meshId, agent.agentId, { state: "idle", activeTaskId: undefined });
    assert.equal((await readMeshBudgetUsage(root, mesh.meshId)).lifetimeTasks, 1);
    const prepared = await reconcileMeshState(root, mesh.meshId); assert.equal(prepared.removedTaskDirectories, 1); assert.equal((await readAgentSnapshot(root, mesh.meshId, agent.agentId, taskId)).status.activeTaskId, taskId); await reconcileMeshReservations(root, mesh.meshId, async () => "absent"); const repairedReservation = JSON.parse(await readFile(reservationPath(root, mesh.meshId, agent.reservation.reservationId), "utf8")) as { taskId?: string }; assert.equal(repairedReservation.taskId, taskId);
    const task = await readAgentSnapshot(root, mesh.meshId, agent.agentId, taskId); const usage = emptyUsage(); usage.input = 7; usage.totalTokens = 7; usage.cost.input = 0.07; usage.cost.total = 0.07;
    await writeFile(paths.result, JSON.stringify({ schemaVersion: 1, meshId: mesh.meshId, agentId: agent.agentId, taskId, outcome: "succeeded", output: "done", usage, turns: 1, interventions: [], startedAt: task.task!.status.createdAt, finishedAt: new Date().toISOString() }));
    await reconcileMeshState(root, mesh.meshId); const settled = await readAgentSnapshot(root, mesh.meshId, agent.agentId, taskId); assert.equal(settled.task?.status.state, "succeeded"); assert.equal(settled.status.state, "idle"); assert.equal(settled.status.agentUsage.input, 7); assert.deepEqual(settled.status.accountedTaskIds, [taskId]);
    await reconcileMeshState(root, mesh.meshId); assert.equal((await readAgentSnapshot(root, mesh.meshId, agent.agentId, taskId)).status.agentUsage.input, 7);
}));

void test("reservation recovery retains creating agents on unknown tmux evidence and removes records only on definitive absence", async () => withRoot("mesh-reservation-evidence-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const definition = settledAgentDefinition("worker"); const epochId = randomUUID();
    const liveReservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task"); const live = await prepareAgent(root, mesh.meshId, { reservationId: liveReservation.reservationId, agent: "worker", harness: "pi", cwd: root, agentSnapshot: definition, launchEnvelope: "pending", epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    assert.equal(await reconcileMeshReservations(root, mesh.meshId, async agentId => agentId === live.agentId ? "unknown" : "absent"), 0); await access(live.paths.status);
    const abandonedReservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task"); const abandoned = await prepareAgent(root, mesh.meshId, { reservationId: abandonedReservation.reservationId, agent: "worker", harness: "pi", cwd: root, agentSnapshot: definition, launchEnvelope: "pending", epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    assert.equal(await reconcileMeshReservations(root, mesh.meshId, async agentId => agentId === live.agentId ? "unknown" : "absent"), 1);
    await assert.rejects(access(abandoned.paths.directory), error => (error as NodeJS.ErrnoException).code === "ENOENT"); const released = JSON.parse(await readFile(reservationPath(root, mesh.meshId, abandonedReservation.reservationId), "utf8")) as { state: string }; assert.equal(released.state, "released");
}));

void test("mesh records are written with exact schema keys and private file and directory modes", async () => withRoot("mesh-schema-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "session", rootSessionFile: "/session.jsonl", recoverable: true, budgets });
    const paths = meshPaths(root, mesh.meshId);
    const persisted = JSON.parse(await readFile(paths.mesh, "utf8")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(persisted).sort(), ["budgets", "createdAt", "meshId", "recoverable", "rootSessionFile", "rootSessionId", "schemaVersion", "state", "updatedAt"].sort());
    assert.equal((await stat(paths.directory)).mode & 0o777, 0o700);
    assert.equal((await stat(paths.mesh)).mode & 0o777, 0o600);
    await writeFile(paths.mesh, JSON.stringify({ ...persisted, unexpected: true }), { mode: 0o600 });
    await assert.rejects(readMesh(root, mesh.meshId), /unknown keys/u);
}));
