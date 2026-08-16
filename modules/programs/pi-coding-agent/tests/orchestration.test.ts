import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { buildLaunchEnvelope, buildPolicySnapshot, policyDigest, validateLaunchEnvelope, validateOrchestrationConfig, validateOrchestrationReferences, validateRoleCatalog } from "../extensions_src/utilities/agent_types.ts";
import { availableContext, publishAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { bindAgentRuntime } from "../extensions_src/utilities/orchestration_runtime.ts";
import {
    attachRootMesh,
    beginMeshClose,
    claimPendingTask,
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
import { withMeshLock } from "../extensions_src/utilities/orchestration_lock.ts";
import { emptyUsage } from "../extensions_src/utilities/orchestration_types.ts";
import { settleWithinEventLoopTurns, withTemporaryRoot as withRoot, yieldToIO } from "./test_helpers.ts";

const syntheticRole = (name = "worker") => ({ description: `Synthetic ${name}`, tools: [], instructions: "Return the bounded result.", defaultProfile: "pi-medium", contextPolicy: "project" as const, childExtensionContributions: [] });
const syntheticProfile = { model: "provider/model", thinkingLevel: "medium" as const, harness: "pi" as const };
const syntheticCatalog = (roles: Record<string, ReturnType<typeof syntheticRole>>) => ({ schemaVersion: 3 as const, roles });
const syntheticEpochInput = (mode: string, roles: Record<string, ReturnType<typeof syntheticRole>>) => ({
    mode,
    catalog: syntheticCatalog(roles),
    profiles: { schemaVersion: 1 as const, profiles: { "pi-medium": syntheticProfile } },
    callPolicy: { modes: { [mode]: { roles: Object.keys(roles) } }, roles: {} },
});

const budgets = { maxLiveAgents: 2, maxConcurrentTasks: 2, maxTasksPerMesh: 8 };
const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" };
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };

async function createPublishedAgent(stateRoot: string, meshId: string, epochId: string, role = "worker") {
    const definition = syntheticRole(role);
    const reservation = await reserveMeshCapacity(stateRoot, meshId, "new-agent-task");
    const prepared = await prepareAgent(stateRoot, meshId, { reservationId: reservation.reservationId, role, selectedProfile: "pi-medium", harness: syntheticProfile.harness, cwd: stateRoot, roleSnapshot: definition, profileSnapshot: syntheticProfile, launchEnvelope: "pending", epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    const epoch = await readPolicyEpoch(stateRoot, meshId, epochId);
    const childExtensions = Object.fromEntries(epoch.roleSet.map(name => [name, ["/popup.ts", "/orchestration.ts", ...epoch.roles[name]!.childExtensionContributions, "/bridge.ts"]]));
    const envelope = buildLaunchEnvelope({ meshId, agentId: prepared.agentId, epochId, role, snapshot: epoch, childExtensions });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
    await publishAgent(stateRoot, meshId, prepared.paths, { agentId: prepared.agentId, epochId, role, selectedProfile: "pi-medium", harness: syntheticProfile.harness, cwd: stateRoot, roleSnapshot: definition, profileSnapshot: syntheticProfile, launchEnvelope: envelopePath, tmux, capabilities, creatorSessionId: "creator" });
    await patchAgentStatus(stateRoot, meshId, prepared.agentId, { state: "idle", bridgeReady: true });
    const runtimeId = randomUUID(); await bindAgentRuntime(stateRoot, meshId, prepared.agentId, { runtimeId, kind: "external" }); const now = new Date().toISOString(); await publishAgentActivity(stateRoot, meshId, prepared.agentId, { runtimeId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: now, observedAt: now, heartbeatAt: now, context: availableContext(10, 100_000, 100) });
    return { ...prepared, reservation };
}

void test("persisted roots reuse an open lease, close durably, and require a fresh mesh after close", async () => withRoot("mesh-lifecycle-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "session", rootSessionFile: "/session.jsonl", recoverable: true, budgets });
    const first = await attachRootMesh(root, mesh.meshId, { rootSessionId: "session", budgets, rootSessionFile: "/session.jsonl", pid: 101, tmuxServerPid: "10", tmuxSessionId: "$1" });
    const reload = await attachRootMesh(root, mesh.meshId, { rootSessionId: "session", budgets, rootSessionFile: "/session.jsonl", pid: 101, tmuxServerPid: "10", tmuxSessionId: "$1" });
    assert.equal(reload.leaseId, first.leaseId);
    assert.equal((await beginMeshClose(root, mesh.meshId, first.leaseId)).state, "closing");
    assert.equal((await completeMeshClose(root, mesh.meshId, first.leaseId)).state, "closed");
    await assert.rejects(attachRootMesh(root, mesh.meshId, { rootSessionId: "session", budgets, rootSessionFile: "/session.jsonl" }), /closed/u);
    const reopened = await initializeMesh(root, { rootSessionId: "session", rootSessionFile: "/session.jsonl", recoverable: true, budgets });
    assert.notEqual(reopened.meshId, mesh.meshId);
}));

void test("root attach migrates only the exact legacy budget and rejects visible unexpected mismatches", async () => withRoot("mesh-budget-compatibility-", async root => {
    const generated = { maxLiveAgents: 20, maxConcurrentTasks: 20, maxTasksPerMesh: 256 };
    const legacy = await initializeMesh(root, { rootSessionId: "legacy", recoverable: true, budgets: { maxLiveAgents: 20, maxConcurrentTasks: 6, maxTasksPerMesh: 256 } });
    await attachRootMesh(root, legacy.meshId, { rootSessionId: "legacy", budgets: generated });
    const migrated = await readMesh(root, legacy.meshId);
    assert.deepEqual(migrated.budgets, generated);
    assert.deepEqual(migrated.budgetMigration && { type: migrated.budgetMigration.type, from: migrated.budgetMigration.from, to: migrated.budgetMigration.to }, { type: "mesh_budget_migrated", from: { maxLiveAgents: 20, maxConcurrentTasks: 6, maxTasksPerMesh: 256 }, to: generated });
    await attachRootMesh(root, legacy.meshId, { rootSessionId: "legacy", budgets: generated });
    assert.deepEqual((await readMesh(root, legacy.meshId)).budgetMigration, migrated.budgetMigration);

    const current = await initializeMesh(root, { rootSessionId: "current", recoverable: true, budgets: generated });
    await attachRootMesh(root, current.meshId, { rootSessionId: "current", budgets: generated });
    assert.equal((await readMesh(root, current.meshId)).budgetMigration, undefined);

    const retiredLegacy = await initializeMesh(root, { rootSessionId: "retired", recoverable: true, budgets: { maxLiveAgents: 12, maxConcurrentTasks: 6, maxTasksPerMesh: 256 } });
    await assert.rejects(attachRootMesh(root, retiredLegacy.meshId, { rootSessionId: "retired", budgets: generated }), /budget mismatch/u);

    const unexpectedBudgets = { maxLiveAgents: 13, maxConcurrentTasks: 6, maxTasksPerMesh: 256 };
    const unexpected = await initializeMesh(root, { rootSessionId: "unexpected", recoverable: true, budgets: unexpectedBudgets });
    await assert.rejects(attachRootMesh(root, unexpected.meshId, { rootSessionId: "unexpected", budgets: generated }), error => {
        assert.match((error as Error).message, /budget mismatch/u);
        assert.match((error as Error).message, /maxLiveAgents[^}]*13/u);
        assert.match((error as Error).message, /maxLiveAgents[^}]*20/u);
        return true;
    });
    assert.deepEqual((await readMesh(root, unexpected.meshId)).budgets, unexpectedBudgets);
    await assert.rejects(access(meshPaths(root, unexpected.meshId).lease), error => (error as NodeJS.ErrnoException).code === "ENOENT");
}));

void test("contended mesh locking reclaims a dead owner without losing exclusion or leaking lock paths", async () => withRoot("mesh-lock-reclaim-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const lockDirectory = join(meshPaths(root, mesh.meshId).directory, ".lock");
    await mkdir(lockDirectory);
    await writeFile(join(lockDirectory, "owner.json"), `${JSON.stringify({ pid: 99_999_999, acquiredAt: new Date().toISOString(), token: randomUUID() })}\n`);
    let started = 0; let entered = 0; let maximumEntered = 0; let completed = 0; let release!: () => void; let acquired!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const acquiredPromise = new Promise<void>(resolve => { acquired = resolve; });
    const contender = (wait = false) => { started += 1; return withMeshLock(root, mesh.meshId, async () => {
        entered += 1; maximumEntered = Math.max(maximumEntered, entered);
        if (wait) { acquired(); await gate; }
        completed += 1; entered -= 1;
    }); };
    const first = contender(true); await acquiredPromise;
    const others = [contender(), contender()]; assert.equal(started, 3); await yieldToIO(); assert.equal(maximumEntered, 1);
    release(); await Promise.all([first, ...others]);
    assert.equal(completed, 3);
    assert.equal(maximumEntered, 1);
    assert.deepEqual((await readdir(meshPaths(root, mesh.meshId).directory)).filter(name => name.startsWith(".lock")), []);
}));

void test("an ownerless lock left before owner publication ages into recoverable state", async () => withRoot("mesh-ownerless-lock-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const directory = meshPaths(root, mesh.meshId).directory; const lockDirectory = join(directory, ".lock");
    await mkdir(lockDirectory); const stale = new Date("2020-01-01T00:00:00.000Z"); await utimes(lockDirectory, stale, stale);
    let called = false; await withMeshLock(root, mesh.meshId, async () => { called = true; });
    assert.equal(called, true);
    assert.deepEqual((await readdir(directory)).filter(name => name.startsWith(".lock")), []);
}));

void test("an idle agent poll does not queue behind unrelated mesh-wide work", async () => withRoot("mesh-idle-poll-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, syntheticEpochInput("ops", { worker: syntheticRole("worker") }));
    const agent = await createPublishedAgent(root, mesh.meshId, epoch.epochId);
    let release!: () => void; let acquired!: () => void; const acquiredPromise = new Promise<void>(resolve => { acquired = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    const held = withMeshLock(root, mesh.meshId, async () => { acquired(); await gate; });
    await acquiredPromise;
    const observed = await settleWithinEventLoopTurns(claimPendingTask(root, mesh.meshId, agent.agentId));
    release(); await held;
    assert.equal(observed, null);
}));

void test("stale persisted leases recover only with dead-PID, same-session, and matching-tmux evidence", async () => withRoot("mesh-lease-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "session", rootSessionFile: "/session.jsonl", recoverable: true, budgets });
    const first = await attachRootMesh(root, mesh.meshId, { rootSessionId: "session", budgets, rootSessionFile: "/session.jsonl", pid: 101, tmuxServerPid: "10", tmuxSessionId: "$1" });
    for (const evidence of [
        { pidAlive: true, sameSession: true, tmuxMatches: true },
        { pidAlive: false, sameSession: false, tmuxMatches: true },
        { pidAlive: false, sameSession: true, tmuxMatches: false },
    ]) await assert.rejects(attachRootMesh(root, mesh.meshId, { rootSessionId: "session", budgets, rootSessionFile: "/session.jsonl", pid: 202, inspectExisting: async () => evidence }), /active root lease/u);
    const recovered = await attachRootMesh(root, mesh.meshId, { rootSessionId: "session", budgets, rootSessionFile: "/session.jsonl", pid: 202, tmuxServerPid: "10", tmuxSessionId: "$1", inspectExisting: async existing => ({ pidAlive: false, sameSession: existing.rootSessionId === "session" && existing.rootSessionFile === "/session.jsonl", tmuxMatches: existing.tmuxServerPid === "10" && existing.tmuxSessionId === "$1" }) });
    assert.notEqual(recovered.leaseId, first.leaseId);
}));

void test("an ephemeral root remains nonrecoverable while supporting the persisted task lifecycle", async () => withRoot("mesh-ephemeral-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "memory", recoverable: false, budgets });
    await attachRootMesh(root, mesh.meshId, { rootSessionId: "memory", budgets, pid: 101 });
    await assert.rejects(attachRootMesh(root, mesh.meshId, { rootSessionId: "other", budgets, pid: 202, inspectExisting: async () => ({ pidAlive: false, sameSession: false, tmuxMatches: true }) }), /nonrecoverable/u);
    const roles = { worker: syntheticRole("worker") };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, syntheticEpochInput("ops", roles));
    const agent = await createPublishedAgent(root, mesh.meshId, epoch.epochId);
    const task = await createTask(root, mesh.meshId, agent.agentId, "Complete one bounded task", `root:${mesh.meshId}`);
    await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "done" });
    assert.equal((await readAgentSnapshot(root, mesh.meshId, agent.agentId, task.request.taskId)).task?.result?.output, "done");
}));

void test("holistic orchestration references reject unreachable ghost and incompatible caller edges", () => {
    const role = (name: string, defaultProfile = "pi-medium", contextPolicy: "project" | "prompt-only" = "project") => ({ ...syntheticRole(name), defaultProfile, contextPolicy });
    const catalog = { schemaVersion: 3 as const, roles: { worker: role("worker"), external: role("external", "external"), isolated: role("isolated", "pi-medium", "prompt-only") } };
    const profiles = { schemaVersion: 1 as const, profiles: { "pi-medium": syntheticProfile, external: { model: "cursor/model", harness: "cursor-agent" as const, harnessOptions: { mode: "agent" } } } };
    const raw = {
        schemaVersion: 3, stateRoot: "/state", tmux: "/tmux", returnParentCommand: "/return", parentNavigationHint: "parent", historyViewerExtension: "/history", popupExtension: "/popup", orchestrationExtension: "/orchestration", childBridgeExtension: "/bridge",
        harnesses: { pi: { adapter: "pi-native", command: "/pi" } }, natureHandleWords: ["May"],
        callPolicy: { modes: { ops: { roles: ["worker"] } }, roles: {} },
        budgets: { maxLiveAgents: 2, maxConcurrentTasks: 2, maxTasksPerMesh: 4 },
        gc: { contextHeadroomTokens: 1, periodicIntervalMs: 1, activityHeartbeatMs: 1, activityStaleMs: 2, roles: {} },
    };
    const config = validateOrchestrationConfig(raw);
    validateOrchestrationReferences(config, catalog, profiles, ["ops"]);
    const reject = (callPolicy: { modes: Record<string, { roles: string[] }>; roles: Record<string, { roles: string[]; profiles: string[] }> }, pattern: RegExp, modes: readonly string[] = ["ops"]) => assert.throws(() => validateOrchestrationReferences(validateOrchestrationConfig({ ...raw, callPolicy }), catalog, profiles, modes), pattern);
    reject({ modes: { ghostMode: { roles: ["worker"] } }, roles: {} }, /unknown mode caller/u);
    reject({ modes: { ops: { roles: ["ghost"] } }, roles: {} }, /unknown roles/u);
    reject({ modes: { ops: { roles: ["worker"] } }, roles: { ghost: { roles: [], profiles: [] } } }, /unknown role caller/u);
    reject({ modes: { ops: { roles: ["worker"] } }, roles: { worker: { roles: ["ghost"], profiles: [] } } }, /unknown roles/u);
    reject({ modes: { ops: { roles: ["worker"] } }, roles: { worker: { roles: [], profiles: ["ghost"] } } }, /unknown profiles/u);
    reject({ modes: { ops: { roles: [] } }, roles: { external: { roles: ["worker"], profiles: [] } } }, /external-profile caller/u);
    reject({ modes: { ops: { roles: [] } }, roles: { isolated: { roles: ["worker"], profiles: [] } } }, /prompt-only caller/u);
    reject({ modes: { ops: { roles: [] } }, roles: { worker: { roles: [], profiles: ["pi-medium"] } } }, /repeats its default/u);
    const externalPromptOnly = { ...catalog, roles: { ...catalog.roles, isolated: role("isolated", "external", "prompt-only") } };
    assert.throws(() => validateOrchestrationReferences(config, externalPromptOnly, profiles, ["ops"]), /prompt-only role isolated/u);
});

// Admission: persisted and external consumers parse these exact protocol generations; accepting a stale role shape could silently restore retired prompt ownership.
// Given a v3 role catalog, when it crosses catalog, epoch, and launch-envelope boundaries, consumers observe v3 records without role Skill opt-ins and reject the v2 generation and old role shape.
void test("role protocol v3 captures policy closure and rejects the v2 role generation", async () => withRoot("mesh-role-v3-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "session", recoverable: true, budgets });
    const role = (description: string, defaultProfile: string) => ({ description, tools: [], instructions: "Return evidence.", defaultProfile, contextPolicy: "project" as const, childExtensionContributions: [] });
    const catalog = { schemaVersion: 3 as const, roles: { reviewer: role("Review", "review"), lens: role("Lens", "lens"), leaf: role("Leaf", "leaf"), sibling: role("Sibling", "leaf") } };
    assert.deepEqual(validateRoleCatalog(catalog), catalog);
    assert.throws(() => validateRoleCatalog({ ...catalog, schemaVersion: 2 }), /Unsupported/u);
    assert.throws(() => validateRoleCatalog({ ...catalog, roles: { ...catalog.roles, reviewer: { ...catalog.roles.reviewer, skillOptIns: ["retired-role-method"] } } }), /unknown keys/u);
    const profiles = { schemaVersion: 1 as const, profiles: { review: { model: "provider/review", thinkingLevel: "high" as const, harness: "pi" as const }, lens: { model: "provider/lens", thinkingLevel: "medium" as const, harness: "pi" as const }, leaf: { model: "provider/leaf", thinkingLevel: "low" as const, harness: "pi" as const } } };
    const callPolicy = { modes: { ops: { roles: ["reviewer", "sibling"] } }, roles: { reviewer: { roles: ["lens"], profiles: [] }, lens: { roles: ["leaf"], profiles: [] } } };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", catalog, profiles, callPolicy });
    assert.equal(epoch.schemaVersion, 3);
    assert.deepEqual(epoch.directRoles, ["reviewer", "sibling"]);
    assert.deepEqual(Object.keys(epoch.roles).sort(), ["leaf", "lens", "reviewer", "sibling"]);
    assert.deepEqual(Object.keys(epoch.profiles).sort(), ["leaf", "lens", "review"]);
    assert.equal(epoch.policyDigest, policyDigest({ mode: epoch.mode, directRoles: epoch.directRoles, roles: epoch.roles, profiles: epoch.profiles, policies: epoch.policies }));
    const envelope = buildLaunchEnvelope({ meshId: mesh.meshId, agentId: randomUUID(), epochId: epoch.epochId, role: "reviewer", snapshot: epoch, childExtensions: Object.fromEntries(Object.keys(epoch.roles).map(name => [name, [`/${name}`]])) });
    assert.deepEqual({ schemaVersion: envelope.schemaVersion, marker: envelope.marker }, { schemaVersion: 3, marker: "pi-mesh-role-launch-v3" });
    assert.deepEqual(Object.keys(envelope.roles).sort(), ["leaf", "lens", "reviewer"]);
    assert.equal(envelope.roles.sibling, undefined);
    assert.deepEqual(envelope.policies.reviewer?.roles, ["lens"]);
    const empty = buildPolicySnapshot({ mode: "missing", catalog, profiles, callPolicy });
    assert.deepEqual(empty, { mode: "missing", directRoles: [], roles: {}, profiles: {}, policies: {} });
    assert.throws(() => buildLaunchEnvelope({ meshId: mesh.meshId, agentId: randomUUID(), epochId: epoch.epochId, role: "reviewer", selectedProfile: "lens", snapshot: epoch, childExtensions: Object.fromEntries(Object.keys(epoch.roles).map(name => [name, [`/${name}`]])) }), /not authorized/u);
    assert.throws(() => validateLaunchEnvelope({ ...envelope, schemaVersion: 2, marker: "pi-mesh-role-launch-v2" }), /Unsupported/u);
    const persisted = JSON.parse(await readFile(epochPath(root, mesh.meshId, epoch.epochId), "utf8")) as Record<string, unknown>;
    await writeFile(epochPath(root, mesh.meshId, epoch.epochId), JSON.stringify({ ...persisted, schemaVersion: 2 }));
    await assert.rejects(readPolicyEpoch(root, mesh.meshId, epoch.epochId), /Unsupported/u);
}));

void test("persisted agents reject a forged sibling policy edge even when the epoch digest remains valid", async () => withRoot("mesh-forged-envelope-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const reviewer = { ...syntheticRole("reviewer"), defaultProfile: "pi-medium" };
    const lens = syntheticRole("lens");
    const sibling = syntheticRole("sibling");
    const catalog = syntheticCatalog({ reviewer, lens, sibling });
    const profiles = { schemaVersion: 1 as const, profiles: { "pi-medium": syntheticProfile } };
    const callPolicy = { modes: { ops: { roles: ["reviewer", "sibling"] } }, roles: { reviewer: { roles: ["lens"], profiles: [] } } };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", catalog, profiles, callPolicy });
    const reservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task");
    const prepared = await prepareAgent(root, mesh.meshId, { reservationId: reservation.reservationId, role: "reviewer", selectedProfile: "pi-medium", harness: "pi", cwd: root, roleSnapshot: reviewer, profileSnapshot: syntheticProfile, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { creatorSessionId: "root" }, capabilities });
    const extensions = Object.fromEntries(Object.keys(epoch.roles).map(name => [name, [`/${name}`]]));
    const envelope = buildLaunchEnvelope({ meshId: mesh.meshId, agentId: prepared.agentId, epochId: epoch.epochId, role: "reviewer", snapshot: epoch, childExtensions: extensions });
    const forged = structuredClone(envelope) as typeof envelope;
    forged.roles.sibling = sibling;
    forged.policies.sibling = { roles: [], profiles: [] };
    forged.policies.reviewer!.roles.push("sibling");
    forged.childExtensions.sibling = extensions.sibling!;
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json"); await writeFile(envelopePath, JSON.stringify(forged));
    await assert.rejects(publishAgent(root, mesh.meshId, prepared.paths, { agentId: prepared.agentId, epochId: epoch.epochId, role: "reviewer", selectedProfile: "pi-medium", harness: "pi", cwd: root, roleSnapshot: reviewer, profileSnapshot: syntheticProfile, launchEnvelope: envelopePath, tmux, capabilities, creatorSessionId: "root" }), /exact child projection/u);
}));

void test("task requests persist requester provenance and reject requester-less legacy records", async () => withRoot("mesh-requester-v3-", async root => {
    const taskId = randomUUID(); const meshId = randomUUID(); const agentId = randomUUID(); const paths = taskPaths(root, meshId, taskId); await mkdir(paths.directory, { recursive: true });
    const createdAt = new Date().toISOString(); await writeFile(paths.request, JSON.stringify({ schemaVersion: 3, meshId, agentId, taskId, prompt: "bounded", requesterEndpointId: `agent:${agentId}`, requesterAgentId: agentId, createdAt }));
    await writeFile(paths.status, JSON.stringify({ schemaVersion: 1, meshId, agentId, taskId, state: "created", createdAt }));
    await mkdir(join(root, "meshes", meshId, "agents", agentId), { recursive: true }); await writeFile(join(root, "meshes", meshId, "agents", agentId, "events.jsonl"), "");
    const task = await import("../extensions_src/utilities/orchestration_store.ts").then(store => store.readTask(root, meshId, taskId));
    assert.deepEqual({ endpoint: task.request.requesterEndpointId, agent: task.request.requesterAgentId }, { endpoint: `agent:${agentId}`, agent: agentId });
    await writeFile(paths.request, JSON.stringify({ schemaVersion: 3, meshId, agentId, taskId, prompt: "forged", requesterEndpointId: `root:${meshId}`, requesterAgentId: agentId, createdAt }));
    await assert.rejects(import("../extensions_src/utilities/orchestration_store.ts").then(store => store.readTask(root, meshId, taskId)), /requester identity/u);
    await writeFile(paths.request, JSON.stringify({ schemaVersion: 1, meshId, agentId, taskId, prompt: "legacy", createdAt }));
    await assert.rejects(import("../extensions_src/utilities/orchestration_store.ts").then(store => store.readTask(root, meshId, taskId)), /Unsupported task request/u);
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
    const roles = { worker: syntheticRole("worker") };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, syntheticEpochInput("ops", roles));
    const agent = await createPublishedAgent(root, mesh.meshId, epoch.epochId);
    const reservation = await reserveMeshCapacity(root, mesh.meshId, "existing-agent-task", agent.agentId);
    await releaseMeshReservation(root, mesh.meshId, reservation.reservationId, "caller abandoned submission");
    await assert.rejects(createTask(root, mesh.meshId, agent.agentId, "must not commit", `root:${mesh.meshId}`, reservation.reservationId), /reservation does not match/u);
}));

void test("closing admission checkpoints reject preparation, publication, and task commit without leaving reserved capacity", async () => withRoot("mesh-closing-admission-", async root => {
    const definition = syntheticRole("worker");
    const preparationMesh = await initializeMesh(root, { rootSessionId: "prepare", recoverable: true, budgets });
    const preparationLease = await attachRootMesh(root, preparationMesh.meshId, { rootSessionId: "prepare", budgets });
    const preparationReservation = await reserveMeshCapacity(root, preparationMesh.meshId, "new-agent-task");
    await beginMeshClose(root, preparationMesh.meshId, preparationLease.leaseId);
    await assert.rejects(prepareAgent(root, preparationMesh.meshId, { reservationId: preparationReservation.reservationId, role: "worker", selectedProfile: "pi-medium", harness: "pi", cwd: root, roleSnapshot: definition, profileSnapshot: syntheticProfile, launchEnvelope: "pending", epochId: randomUUID(), provenance: { creatorSessionId: "creator" }, capabilities }), /closing/u);
    assert.equal((await readMeshBudgetUsage(root, preparationMesh.meshId)).pendingLiveSlots, 0);

    const publicationMesh = await initializeMesh(root, { rootSessionId: "publish", recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, publicationMesh.meshId, syntheticEpochInput("ops", { worker: definition }));
    const publicationReservation = await reserveMeshCapacity(root, publicationMesh.meshId, "new-agent-task");
    const prepared = await prepareAgent(root, publicationMesh.meshId, { reservationId: publicationReservation.reservationId, role: "worker", selectedProfile: "pi-medium", harness: "pi", cwd: root, roleSnapshot: definition, profileSnapshot: syntheticProfile, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    const envelope = buildLaunchEnvelope({ meshId: publicationMesh.meshId, agentId: prepared.agentId, epochId: epoch.epochId, role: "worker", snapshot: epoch, childExtensions: { worker: ["/popup.ts", "/orchestration.ts", "/bridge.ts"] } });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json"); await writeFile(envelopePath, JSON.stringify(envelope));
    const publicationLease = await attachRootMesh(root, publicationMesh.meshId, { rootSessionId: "publish", budgets }); await beginMeshClose(root, publicationMesh.meshId, publicationLease.leaseId);
    await assert.rejects(publishAgent(root, publicationMesh.meshId, prepared.paths, { agentId: prepared.agentId, epochId: epoch.epochId, role: "worker", selectedProfile: "pi-medium", harness: "pi", cwd: root, roleSnapshot: definition, profileSnapshot: syntheticProfile, launchEnvelope: envelopePath, tmux, capabilities, creatorSessionId: "creator" }), /closing/u);

    const taskMesh = await initializeMesh(root, { rootSessionId: "task", recoverable: true, budgets });
    const taskEpoch = await ensurePolicyEpoch(root, taskMesh.meshId, syntheticEpochInput("ops", { worker: definition }));
    const agent = await createPublishedAgent(root, taskMesh.meshId, taskEpoch.epochId); const taskReservation = await reserveMeshCapacity(root, taskMesh.meshId, "existing-agent-task", agent.agentId); const requestedTaskId = randomUUID();
    const taskLease = await attachRootMesh(root, taskMesh.meshId, { rootSessionId: "task", budgets }); await beginMeshClose(root, taskMesh.meshId, taskLease.leaseId);
    await assert.rejects(createTask(root, taskMesh.meshId, agent.agentId, "must not commit", `root:${taskMesh.meshId}`, taskReservation.reservationId, requestedTaskId), /closing/u);
    await assert.rejects(access(taskPaths(root, taskMesh.meshId, requestedTaskId).request), error => (error as NodeJS.ErrnoException).code === "ENOENT");
}));

void test("root reconciliation removes uncommitted task directories and settles durable task, agent, and usage state exactly once", async () => withRoot("mesh-state-reconcile-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, syntheticEpochInput("ops", { worker: syntheticRole("worker") })); const agent = await createPublishedAgent(root, mesh.meshId, epoch.epochId);
    const taskId = randomUUID(); const paths = taskPaths(root, mesh.meshId, taskId); const createdAt = new Date().toISOString(); await mkdir(paths.directory, { recursive: true }); await writeFile(paths.request, JSON.stringify({ schemaVersion: 3, meshId: mesh.meshId, agentId: agent.agentId, taskId, prompt: "durable request", requesterEndpointId: `root:${mesh.meshId}`, createdAt }));
    const abandonedId = randomUUID(); await mkdir(taskPaths(root, mesh.meshId, abandonedId).directory, { recursive: true });
    await patchAgentStatus(root, mesh.meshId, agent.agentId, { state: "idle", activeTaskId: undefined });
    assert.equal((await readMeshBudgetUsage(root, mesh.meshId)).lifetimeTasks, 1);
    const prepared = await reconcileMeshState(root, mesh.meshId); assert.equal(prepared.removedTaskDirectories, 1); assert.equal((await readAgentSnapshot(root, mesh.meshId, agent.agentId, taskId)).status.activeTaskId, taskId); await reconcileMeshReservations(root, mesh.meshId, async () => "absent"); const repairedReservation = JSON.parse(await readFile(reservationPath(root, mesh.meshId, agent.reservation.reservationId), "utf8")) as { taskId?: string }; assert.equal(repairedReservation.taskId, taskId);
    const task = await readAgentSnapshot(root, mesh.meshId, agent.agentId, taskId); const usage = emptyUsage(); usage.input = 7; usage.totalTokens = 7; usage.cost.input = 0.07; usage.cost.total = 0.07;
    await writeFile(paths.result, JSON.stringify({ schemaVersion: 1, meshId: mesh.meshId, agentId: agent.agentId, taskId, outcome: "succeeded", output: "done", usage, turns: 1, interventions: [], startedAt: task.task!.status.createdAt, finishedAt: new Date().toISOString() }));
    await reconcileMeshState(root, mesh.meshId); const settled = await readAgentSnapshot(root, mesh.meshId, agent.agentId, taskId); assert.equal(settled.agent.schemaVersion, 3); assert.equal(settled.task?.status.state, "succeeded"); assert.equal(settled.status.state, "idle"); assert.equal(settled.status.agentUsage.input, 7); assert.deepEqual(settled.status.accountedTaskIds, [taskId]);
    await reconcileMeshState(root, mesh.meshId); assert.equal((await readAgentSnapshot(root, mesh.meshId, agent.agentId, taskId)).status.agentUsage.input, 7);
    const agentPath = join(meshPaths(root, mesh.meshId).agents, agent.agentId, "agent.json"); const agentRecord = JSON.parse(await readFile(agentPath, "utf8")) as Record<string, unknown>; await writeFile(agentPath, JSON.stringify({ ...agentRecord, schemaVersion: 2 }));
    await assert.rejects(readAgentSnapshot(root, mesh.meshId, agent.agentId), /Unsupported agent record/u);
}));

void test("reservation recovery retains creating agents on unknown tmux evidence and removes records only on definitive absence", async () => withRoot("mesh-reservation-evidence-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const definition = syntheticRole("worker"); const epochId = randomUUID();
    const liveReservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task"); const live = await prepareAgent(root, mesh.meshId, { reservationId: liveReservation.reservationId, role: "worker", selectedProfile: "pi-medium", harness: "pi", cwd: root, roleSnapshot: definition, profileSnapshot: syntheticProfile, launchEnvelope: "pending", epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    assert.equal(await reconcileMeshReservations(root, mesh.meshId, async agentId => agentId === live.agentId ? "unknown" : "absent"), 0); await access(live.paths.status);
    const abandonedReservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task"); const abandoned = await prepareAgent(root, mesh.meshId, { reservationId: abandonedReservation.reservationId, role: "worker", selectedProfile: "pi-medium", harness: "pi", cwd: root, roleSnapshot: definition, profileSnapshot: syntheticProfile, launchEnvelope: "pending", epochId, provenance: { creatorSessionId: "creator" }, capabilities });
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
