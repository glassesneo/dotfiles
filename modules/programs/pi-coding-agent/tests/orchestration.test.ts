import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { buildLaunchEnvelope, buildPolicySnapshot, policyDigest, projectLaunchEnvelope, publicCapability, resolveAuthorizedSelectors, validateChildCatalog, validateLaunchEnvelope, validateOrchestrationConfig, validateOrchestrationReferences } from "../extensions_src/utilities/agent_types.ts";
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

const syntheticExecution = { models: ["provider/model"], thinkingLevel: "medium" as const, harness: "pi" as const };
const syntheticGc = { collectAt: 2, retain: 1, pressureFloor: 0 };
const syntheticChild = (name = "worker", extra: Record<string, unknown> = {}) => ({ selector: { agent: name, access: "read" as const }, description: `Synthetic ${name}`, tools: [], instructions: "Return the bounded result.", contextPolicy: "project" as const, childExtensionContributions: [], execution: syntheticExecution, targets: [] as string[], gc: syntheticGc, ...extra });
const syntheticCatalog = (children: Record<string, ReturnType<typeof syntheticChild>>) => ({ schemaVersion: 1 as const, children });
const syntheticEpochInput = (mode: string, children: Record<string, ReturnType<typeof syntheticChild>>) => ({
    mode,
    catalog: syntheticCatalog(children),
    callPolicy: { modes: { [mode]: { targets: Object.keys(children) } } },
});

const budgets = { maxLiveAgents: 2, maxConcurrentTasks: 2, maxTasksPerMesh: 8 };
const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" };
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };

async function createPublishedAgent(stateRoot: string, meshId: string, epochId: string, childId = "worker") {
    const definition = syntheticChild(childId);
    const reservation = await reserveMeshCapacity(stateRoot, meshId, "new-agent-task");
    const prepared = await prepareAgent(stateRoot, meshId, { reservationId: reservation.reservationId, childId, harness: definition.execution.harness, cwd: stateRoot, definitionSnapshot: definition, launchEnvelope: "pending", epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    const epoch = await readPolicyEpoch(stateRoot, meshId, epochId);
    const childExtensions = Object.fromEntries(Object.keys(epoch.children).map(name => [name, ["/popup.ts", "/orchestration.ts", ...epoch.children[name]!.childExtensionContributions, "/bridge.ts"]]));
    const envelope = buildLaunchEnvelope({ meshId, agentId: prepared.agentId, epochId, childId, snapshot: epoch, childExtensions });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
    await publishAgent(stateRoot, meshId, prepared.paths, { agentId: prepared.agentId, epochId, childId, harness: definition.execution.harness, cwd: stateRoot, definitionSnapshot: definition, launchEnvelope: envelopePath, tmux, capabilities, creatorSessionId: "creator" });
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
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, syntheticEpochInput("ops", { worker: syntheticChild("worker") }));
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
    const roles = { worker: syntheticChild("worker") };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, syntheticEpochInput("ops", roles));
    const agent = await createPublishedAgent(root, mesh.meshId, epoch.epochId);
    const task = await createTask(root, mesh.meshId, agent.agentId, { prompt: "Complete one bounded task", purpose: "synthetic purpose" }, `root:${mesh.meshId}`);
    await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "done" });
    assert.equal((await readAgentSnapshot(root, mesh.meshId, agent.agentId, task.request.taskId)).task?.result?.output, "done");
}));

void test("holistic orchestration references reject unknown and incompatible child edges", () => {
    const child = (name: string, extra: Record<string, unknown> = {}) => ({ ...syntheticChild(name), ...extra });
    const cursorExecution = { models: ["cursor/model"], harness: "cursor-agent" as const, harnessOptions: { mode: "agent" as const, permissionPolicy: "allow-always" as const, sandbox: "disabled" as const, trustWorkspace: true, worktree: false } };
    const catalog = { schemaVersion: 1 as const, children: { worker: child("worker"), external: child("external", { execution: cursorExecution }), isolated: child("isolated", { contextPolicy: "prompt-only" as const }) } };
    const raw = {
        schemaVersion: 6, stateRoot: "/state", tmux: "/tmux", returnParentCommand: "/return", parentNavigationHint: "parent", historyViewerExtension: "/history", popupExtension: "/popup", orchestrationExtension: "/orchestration", childBridgeExtension: "/bridge",
        harnesses: { pi: { adapter: "pi-native", command: "/pi" }, "cursor-agent": { adapter: "cursor-acp", command: "/cursor", modelIds: { model: "synthetic-acp-model" } } }, natureHandleWords: ["May"],
        callPolicy: { modes: { ops: { targets: ["worker"] } } },
        budgets: { maxLiveAgents: 2, maxConcurrentTasks: 2, maxTasksPerMesh: 4 },
        gc: { contextHeadroomTokens: 1, periodicIntervalMs: 1, activityHeartbeatMs: 1, activityStaleMs: 2 },
    };
    const config = validateOrchestrationConfig(raw);
    validateOrchestrationReferences(config, catalog, ["ops"]);
    const reject = (callPolicy: unknown, pattern: RegExp, modes: readonly string[] = ["ops"]) => assert.throws(() => validateOrchestrationReferences(validateOrchestrationConfig({ ...raw, callPolicy }), catalog, modes), pattern);
    reject({ modes: { ghostMode: { targets: ["worker"] } } }, /unknown mode caller/u);
    reject({ modes: { ops: { targets: ["ghost"] } } }, /unknown child/u);
    assert.throws(() => validateOrchestrationConfig({ ...raw, callPolicy: { modes: { ops: { targets: ["worker"] } }, roles: {} } }), /unknown keys/u);
    assert.throws(() => validateOrchestrationConfig({ ...raw, gc: { ...raw.gc, roles: {} } }), /unknown keys/u);
    assert.throws(() => validateOrchestrationReferences(config, { schemaVersion: 1, children: { ...catalog.children, worker: { ...catalog.children.worker, targets: ["ghost"] } } }, ["ops"]), /unknown child/u);
    assert.throws(() => validateOrchestrationReferences(config, { schemaVersion: 1, children: { ...catalog.children, external: { ...catalog.children.external, targets: ["worker"] } } }, ["ops"]), /external-harness caller/u);
    assert.throws(() => validateOrchestrationReferences(config, { schemaVersion: 1, children: { ...catalog.children, isolated: { ...catalog.children.isolated, targets: ["worker"] } } }, ["ops"]), /prompt-only caller/u);
    assert.throws(() => validateOrchestrationReferences(config, { schemaVersion: 1, children: { ...catalog.children, isolated: { ...catalog.children.isolated, execution: cursorExecution } } }, ["ops"]), /prompt-only child isolated/u);
    assert.throws(() => resolveAuthorizedSelectors({ targets: ["worker", "alias"] }, { worker: child("worker"), alias: { ...child("worker"), selector: { agent: "worker", access: "read" } } }), /ambiguous/u);
    const searchCatalog = { schemaVersion: 1 as const, children: { ...catalog.children, research: { ...child("research"), selector: { agent: "research", access: "read" as const }, targets: ["search"] }, search: { ...child("search"), selector: { agent: "search", access: "read" as const } } } };
    const searchPolicy = (callPolicy: unknown, extra = searchCatalog) => validateOrchestrationReferences(validateOrchestrationConfig({ ...raw, callPolicy }), extra, ["ops"]);
    assert.throws(() => searchPolicy({ modes: { ops: { targets: ["search"] } } }), /root target/u);
    assert.throws(() => searchPolicy({ modes: { ops: { targets: ["worker"] } } }, { ...searchCatalog, children: { ...searchCatalog.children, worker: { ...searchCatalog.children.worker, targets: ["search"] } } }), /only be targeted by research/u);
    searchPolicy({ modes: { ops: { targets: ["research"] } } });
});

// Admission: persisted consumers parse the authority protocol; accepting the retired role/profile catalogs could restore stale execution authority.
// Given a v1 child catalog and mode-target policy, protocol consumers retain exact closure and reject older/defaultProfile records.
void test("child protocol v1 captures required-access closure and rejects retired role generations", async () => withRoot("mesh-child-v1-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "session", recoverable: true, budgets });
    const child = (name: string, extra: Record<string, unknown> = {}) => ({ ...syntheticChild(name), description: name, ...extra });
    const catalog = { schemaVersion: 1 as const, children: {
        reviewer: child("reviewer", { execution: { models: ["provider/review"], thinkingLevel: "high" as const, harness: "pi" as const }, targets: ["lens"] }),
        lens: child("lens", { execution: { models: ["provider/lens"], thinkingLevel: "medium" as const, harness: "pi" as const }, targets: ["leaf"] }),
        leaf: child("leaf", { execution: { models: ["provider/leaf"], thinkingLevel: "low" as const, harness: "pi" as const } }),
        sibling: child("sibling", { execution: { models: ["provider/leaf"], thinkingLevel: "low" as const, harness: "pi" as const } }),
    } };
    assert.deepEqual(validateChildCatalog(catalog), catalog);
    assert.throws(() => validateChildCatalog({ ...catalog, schemaVersion: 6 }), /Unsupported/u);
    assert.throws(() => validateChildCatalog({ ...catalog, children: { ...catalog.children, invalid: { ...child("invalid"), selector: { agent: "small" } } } }), /missing required keys/u);
    assert.doesNotThrow(() => validateChildCatalog({ ...catalog, children: { ...catalog.children, research: { ...child("research"), selector: { agent: "research", access: "read" } } } }));
    assert.throws(() => validateChildCatalog({ ...catalog, children: { ...catalog.children, reviewer: { ...catalog.children.reviewer, defaultProfile: "review" } } }), /unknown keys/u);
    const callPolicy = { modes: { ops: { targets: ["reviewer", "sibling"] } } };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", catalog, callPolicy });
    assert.equal(epoch.schemaVersion, 7);
    assert.deepEqual(epoch.directTargets, ["reviewer", "sibling"]);
    assert.deepEqual(Object.keys(epoch.children).sort(), ["leaf", "lens", "reviewer", "sibling"]);
    assert.equal(epoch.policyDigest, policyDigest({ mode: epoch.mode, directTargets: epoch.directTargets, children: epoch.children }));
    const envelope = buildLaunchEnvelope({ meshId: mesh.meshId, agentId: randomUUID(), epochId: epoch.epochId, childId: "reviewer", snapshot: epoch, childExtensions: Object.fromEntries(Object.keys(epoch.children).map(name => [name, [`/${name}`]])) });
    assert.deepEqual({ schemaVersion: envelope.schemaVersion, marker: envelope.marker }, { schemaVersion: 8, marker: "pi-mesh-child-launch-v8" });
    assert.deepEqual(Object.keys(envelope.children).sort(), ["leaf", "lens", "reviewer"]);
    assert.equal(envelope.children.sibling, undefined);
    assert.deepEqual(envelope.self.targets, ["lens"]);
    assert.deepEqual(envelope.self.execution, catalog.children.reviewer.execution);
    assert.deepEqual(envelope.children.leaf!.execution.models, ["provider/leaf"]);
    const forgedExternalCaller = structuredClone(envelope);
    forgedExternalCaller.children.lens!.execution = { models: ["cursor/model"], harness: "cursor-agent", harnessOptions: { mode: "ask", permissionPolicy: "reject", sandbox: "disabled", trustWorkspace: true, worktree: false } };
    assert.throws(() => validateLaunchEnvelope(forgedExternalCaller), /external harness caller lens/u);
    const empty = buildPolicySnapshot({ mode: "missing", catalog, callPolicy });
    assert.deepEqual(empty, { mode: "missing", directTargets: [], children: {} });
    assert.throws(() => buildLaunchEnvelope({ meshId: mesh.meshId, agentId: randomUUID(), epochId: epoch.epochId, childId: "ghost", snapshot: epoch, childExtensions: Object.fromEntries(Object.keys(epoch.children).map(name => [name, [`/${name}`]])) }), /outside policy snapshot|unknown child/u);
    assert.throws(() => validateLaunchEnvelope({ ...envelope, schemaVersion: 7, marker: "pi-mesh-role-launch-v7" }), /Unsupported/u);
    const persisted = JSON.parse(await readFile(epochPath(root, mesh.meshId, epoch.epochId), "utf8")) as Record<string, any>;
    const malformedEdge = structuredClone(persisted); malformedEdge.directTargets = { reviewer: true };
    await writeFile(epochPath(root, mesh.meshId, epoch.epochId), JSON.stringify(malformedEdge));
    await assert.rejects(readPolicyEpoch(root, mesh.meshId, epoch.epochId), /non-empty string array/u);
    await writeFile(epochPath(root, mesh.meshId, epoch.epochId), JSON.stringify({ ...persisted, schemaVersion: 6 }));
    await assert.rejects(readPolicyEpoch(root, mesh.meshId, epoch.epochId), /Unsupported/u);
}));

// Admission: Nix assertions cannot observe TypeScript consumer resolution of public selectors into one internal child, write leakage into a read-only closure, or root publication of search.
// Given capability-shaped children, the shared resolver and launch closure expose only authorized public pairs and keep search off the root edge.
void test("capability selectors resolve uniquely and keep write and search out of unauthorized closures", () => {
    const capabilityChild = (agent: string, access: "read" | "write" = "read", extra: Record<string, unknown> = {}) => ({ ...syntheticChild(agent), selector: { agent, access }, description: `${publicCapability({ agent, access })}`, contextPolicy: agent === "perspective" ? "prompt-only" as const : "project" as const, ...extra });
    const children = {
        "small-read": capabilityChild("small", "read"),
        "small-write": capabilityChild("small", "write"),
        "standard-read": capabilityChild("standard", "read"),
        "advanced-read": capabilityChild("advanced", "read", { targets: ["small-read", "standard-read", "research", "perspective"] }),
        "advanced-write": capabilityChild("advanced", "write", { targets: ["small-read", "small-write", "standard-read", "research", "perspective"] }),
        research: capabilityChild("research", "read", { targets: ["search"] }),
        perspective: capabilityChild("perspective"),
        search: capabilityChild("search"),
    };
    const catalog = { schemaVersion: 1 as const, children };
    const callPolicy = {
        modes: {
            recon: { targets: ["small-read", "standard-read", "advanced-read", "research", "perspective"] },
            ops: { targets: ["small-read", "small-write", "standard-read", "advanced-read", "advanced-write", "research", "perspective"] },
        },
    };
    const recon = resolveAuthorizedSelectors(callPolicy.modes.recon, children);
    assert.deepEqual(recon.map(route => [route.selector.agent, route.selector.access, route.childId]), [["small", "read", "small-read"], ["standard", "read", "standard-read"], ["advanced", "read", "advanced-read"], ["research", "read", "research"], ["perspective", "read", "perspective"]]);
    assert.equal(recon.some(route => route.selector.agent === "search"), false);
    const advancedRead = resolveAuthorizedSelectors({ targets: children["advanced-read"]!.targets }, children);
    assert.equal(advancedRead.some(route => route.selector.access === "write"), false);
    const researchRoutes = resolveAuthorizedSelectors({ targets: children.research.targets }, children);
    assert.deepEqual(researchRoutes.map(route => route.selector.agent), ["search"]);
    const snapshot = buildPolicySnapshot({ mode: "recon", catalog, callPolicy });
    assert.equal(snapshot.directTargets.includes("search"), false);
    const envelope = buildLaunchEnvelope({ meshId: randomUUID(), agentId: randomUUID(), epochId: randomUUID(), childId: "advanced-read", snapshot, childExtensions: Object.fromEntries(Object.keys(snapshot.children).map(name => [name, [`/${name}`]])) });
    assert.equal(envelope.children["small-write"], undefined);
    assert.equal(envelope.children["advanced-write"], undefined);
    assert.ok(envelope.children.search);
    assert.deepEqual([...envelope.self.targets].sort(), ["perspective", "research", "small-read", "standard-read"]);
    assert.equal(envelope.self.contextPolicy, "project");
    const isolated = buildLaunchEnvelope({ meshId: randomUUID(), agentId: randomUUID(), epochId: randomUUID(), childId: "perspective", snapshot, childExtensions: Object.fromEntries(Object.keys(snapshot.children).map(name => [name, [`/${name}`]])) });
    assert.equal(isolated.self.contextPolicy, "prompt-only");
    assert.deepEqual(isolated.self.tools, []);
    assert.deepEqual(isolated.self.targets, []);
});

// Admission: closure inventory cannot observe the actual nested launch-envelope boundary that turns research's authorized edge into a search child.
// Given a root policy that exposes research and a research-only search edge, projecting a child envelope permits search only through research while root construction still rejects search.
void test("nested child envelope permits research-only search dispatch without exposing a root search target", () => {
    const capabilityChild = (agent: string, extra: Record<string, unknown> = {}) => ({ ...syntheticChild(agent), selector: { agent, access: "read" as const }, ...extra });
    const catalog = { schemaVersion: 1 as const, children: { research: capabilityChild("research", { targets: ["search"] }), search: capabilityChild("search") } };
    const callPolicy = { modes: { recon: { targets: ["research"] } } };
    const snapshot = buildPolicySnapshot({ mode: "recon", catalog, callPolicy });
    assert.equal(snapshot.directTargets.includes("search"), false);
    const childExtensions = { research: ["/research"], search: ["/search"] };
    const research = buildLaunchEnvelope({ meshId: randomUUID(), agentId: randomUUID(), epochId: randomUUID(), childId: "research", snapshot, childExtensions });
    const search = projectLaunchEnvelope("search", randomUUID(), research);
    const roundTripped = validateLaunchEnvelope(JSON.parse(JSON.stringify(search)));
    assert.equal(roundTripped.childId, "search");
    assert.deepEqual(roundTripped.self.targets, []);
    assert.equal(roundTripped.children.research, undefined);
    const forgedRoot = structuredClone(snapshot);
    forgedRoot.directTargets = [...forgedRoot.directTargets, "search"];
    assert.throws(() => buildLaunchEnvelope({ meshId: randomUUID(), agentId: randomUUID(), epochId: randomUUID(), childId: "search", snapshot: forgedRoot, childExtensions }), /root target/u);
});

void test("persisted agents reject a forged sibling policy edge even when the epoch digest remains valid", async () => withRoot("mesh-forged-envelope-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const reviewer = syntheticChild("reviewer");
    const lens = syntheticChild("lens");
    const sibling = syntheticChild("sibling");
    const catalog = syntheticCatalog({ reviewer: { ...reviewer, targets: ["lens"] }, lens, sibling });
    const callPolicy = { modes: { ops: { targets: ["reviewer", "sibling"] } } };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", catalog, callPolicy });
    const reservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task");
    const prepared = await prepareAgent(root, mesh.meshId, { reservationId: reservation.reservationId, childId: "reviewer", harness: "pi", cwd: root, definitionSnapshot: catalog.children.reviewer, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { creatorSessionId: "root" }, capabilities });
    const extensions = Object.fromEntries(Object.keys(epoch.children).map(name => [name, [`/${name}`]]));
    const envelope = buildLaunchEnvelope({ meshId: mesh.meshId, agentId: prepared.agentId, epochId: epoch.epochId, childId: "reviewer", snapshot: epoch, childExtensions: extensions });
    const forged = structuredClone(envelope) as typeof envelope;
    forged.children.sibling = sibling;
    forged.children.reviewer = { ...forged.children.reviewer!, targets: ["lens", "sibling"] };
    forged.childExtensions.sibling = extensions.sibling!;
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json"); await writeFile(envelopePath, JSON.stringify(forged));
    await assert.rejects(publishAgent(root, mesh.meshId, prepared.paths, { agentId: prepared.agentId, epochId: epoch.epochId, childId: "reviewer", harness: "pi", cwd: root, definitionSnapshot: catalog.children.reviewer, launchEnvelope: envelopePath, tmux, capabilities, creatorSessionId: "root" }), /exact child projection/u);
}));

void test("task requests persist requester provenance and reject requester-less legacy records", async () => withRoot("mesh-requester-v3-", async root => {
    const taskId = randomUUID(); const meshId = randomUUID(); const agentId = randomUUID(); const paths = taskPaths(root, meshId, taskId); await mkdir(paths.directory, { recursive: true });
    const createdAt = new Date().toISOString(); await writeFile(paths.request, JSON.stringify({ schemaVersion: 4, meshId, agentId, taskId, prompt: "bounded", purpose: "synthetic purpose", requesterEndpointId: `agent:${agentId}`, requesterAgentId: agentId, createdAt }));
    await writeFile(paths.status, JSON.stringify({ schemaVersion: 1, meshId, agentId, taskId, state: "created", createdAt }));
    await mkdir(join(root, "meshes", meshId, "agents", agentId), { recursive: true }); await writeFile(join(root, "meshes", meshId, "agents", agentId, "events.jsonl"), "");
    const task = await import("../extensions_src/utilities/orchestration_store.ts").then(store => store.readTask(root, meshId, taskId));
    assert.deepEqual({ endpoint: task.request.requesterEndpointId, agent: task.request.requesterAgentId, purpose: task.request.purpose, schemaVersion: task.request.schemaVersion }, { endpoint: `agent:${agentId}`, agent: agentId, purpose: "synthetic purpose", schemaVersion: 4 });
    await writeFile(paths.request, JSON.stringify({ schemaVersion: 4, meshId, agentId, taskId, prompt: "forged", purpose: "synthetic purpose", requesterEndpointId: `root:${meshId}`, requesterAgentId: agentId, createdAt }));
    await assert.rejects(import("../extensions_src/utilities/orchestration_store.ts").then(store => store.readTask(root, meshId, taskId)), /requester identity/u);
    await writeFile(paths.request, JSON.stringify({ schemaVersion: 1, meshId, agentId, taskId, prompt: "legacy", createdAt }));
    await assert.rejects(import("../extensions_src/utilities/orchestration_store.ts").then(store => store.readTask(root, meshId, taskId)), /Unsupported task request/u);
    await writeFile(paths.request, JSON.stringify({ schemaVersion: 3, meshId, agentId, taskId, prompt: "retired", requesterEndpointId: `agent:${agentId}`, requesterAgentId: agentId, createdAt }));
    await assert.rejects(import("../extensions_src/utilities/orchestration_store.ts").then(store => store.readTask(root, meshId, taskId)), /Unsupported task request/u);
    await writeFile(paths.request, JSON.stringify({ schemaVersion: 4, meshId, agentId, taskId, prompt: "bounded", purpose: "  padded  ", requesterEndpointId: `agent:${agentId}`, requesterAgentId: agentId, createdAt }));
    await assert.rejects(import("../extensions_src/utilities/orchestration_store.ts").then(store => store.readTask(root, meshId, taskId)), /canonical form/u);
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
    const roles = { worker: syntheticChild("worker") };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, syntheticEpochInput("ops", roles));
    const agent = await createPublishedAgent(root, mesh.meshId, epoch.epochId);
    const reservation = await reserveMeshCapacity(root, mesh.meshId, "existing-agent-task", agent.agentId);
    await releaseMeshReservation(root, mesh.meshId, reservation.reservationId, "caller abandoned submission");
    await assert.rejects(createTask(root, mesh.meshId, agent.agentId, { prompt: "must not commit", purpose: "synthetic purpose" }, `root:${mesh.meshId}`, reservation.reservationId), /reservation does not match/u);
}));

// Admission: purpose is a persisted identity field; schema 4 cannot by itself prevent createTask from reserving then storing an invalid or missing purpose, including controls that String.trim would otherwise strip at the edges.
// Given invalid purpose, edge controls, or a valid trimmed purpose, createTask rejects before reservation or stores the canonical purpose on schema 4.
void test("createTask requires canonical purpose before reservation and persists schema 4", async () => withRoot("mesh-task-purpose-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "session", recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, syntheticEpochInput("ops", { worker: syntheticChild("worker") }));
    const agent = await createPublishedAgent(root, mesh.meshId, epoch.epochId);
    await assert.rejects(createTask(root, mesh.meshId, agent.agentId, { prompt: "work", purpose: "" }, `root:${mesh.meshId}`), /non-empty string/u);
    await assert.rejects(createTask(root, mesh.meshId, agent.agentId, { prompt: "work", purpose: "bad\npurpose" }, `root:${mesh.meshId}`), /single line/u);
    await assert.rejects(createTask(root, mesh.meshId, agent.agentId, { prompt: "work", purpose: "\nname" }, `root:${mesh.meshId}`), /single line/u);
    await assert.rejects(createTask(root, mesh.meshId, agent.agentId, { prompt: "work", purpose: "name\t" }, `root:${mesh.meshId}`), /single line/u);
    await assert.rejects(createTask(root, mesh.meshId, agent.agentId, { prompt: "work", purpose: "\u2028name" }, `root:${mesh.meshId}`), /single line/u);
    await assert.rejects(createTask(root, mesh.meshId, agent.agentId, { prompt: "work", purpose: "name\u2028" }, `root:${mesh.meshId}`), /single line/u);
    await assert.rejects(createTask(root, mesh.meshId, agent.agentId, { prompt: "work", purpose: "界".repeat(121) }, `root:${mesh.meshId}`), /120 Unicode code points/u);
    assert.deepEqual(await readdir(meshPaths(root, mesh.meshId).tasks), []);
    const pending = (await Promise.all((await readdir(meshPaths(root, mesh.meshId).reservations)).map(async name => JSON.parse(await readFile(join(meshPaths(root, mesh.meshId).reservations, name), "utf8")) as { kind?: string; state?: string }))).filter(item => item.kind === "existing-agent-task");
    assert.equal(pending.length, 0);
    const task = await createTask(root, mesh.meshId, agent.agentId, { prompt: "full request body", purpose: "  Investigate Cursor termination  " }, `root:${mesh.meshId}`);
    assert.equal(task.request.schemaVersion, 4);
    assert.equal(task.request.purpose, "Investigate Cursor termination");
    assert.equal(task.request.prompt, "full request body");
    await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "done" });
    const later = await createTask(root, mesh.meshId, agent.agentId, { prompt: "second body", purpose: "later purpose" }, `root:${mesh.meshId}`);
    assert.equal(later.request.purpose, "later purpose");
    const earlier = await import("../extensions_src/utilities/orchestration_store.ts").then(store => store.readTask(root, mesh.meshId, task.request.taskId));
    assert.equal(earlier.request.purpose, "Investigate Cursor termination");
    assert.equal(earlier.request.prompt, "full request body");
}));

void test("closing admission checkpoints reject preparation, publication, and task commit without leaving reserved capacity", async () => withRoot("mesh-closing-admission-", async root => {
    const definition = syntheticChild("worker");
    const preparationMesh = await initializeMesh(root, { rootSessionId: "prepare", recoverable: true, budgets });
    const preparationLease = await attachRootMesh(root, preparationMesh.meshId, { rootSessionId: "prepare", budgets });
    const preparationReservation = await reserveMeshCapacity(root, preparationMesh.meshId, "new-agent-task");
    await beginMeshClose(root, preparationMesh.meshId, preparationLease.leaseId);
    await assert.rejects(prepareAgent(root, preparationMesh.meshId, { reservationId: preparationReservation.reservationId, childId: "worker", harness: "pi", cwd: root, definitionSnapshot: definition, launchEnvelope: "pending", epochId: randomUUID(), provenance: { creatorSessionId: "creator" }, capabilities }), /closing/u);
    assert.equal((await readMeshBudgetUsage(root, preparationMesh.meshId)).pendingLiveSlots, 0);

    const publicationMesh = await initializeMesh(root, { rootSessionId: "publish", recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, publicationMesh.meshId, syntheticEpochInput("ops", { worker: definition }));
    const publicationReservation = await reserveMeshCapacity(root, publicationMesh.meshId, "new-agent-task");
    const prepared = await prepareAgent(root, publicationMesh.meshId, { reservationId: publicationReservation.reservationId, childId: "worker", harness: "pi", cwd: root, definitionSnapshot: definition, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    const envelope = buildLaunchEnvelope({ meshId: publicationMesh.meshId, agentId: prepared.agentId, epochId: epoch.epochId, childId: "worker", snapshot: epoch, childExtensions: { worker: ["/popup.ts", "/orchestration.ts", "/bridge.ts"] } });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json"); await writeFile(envelopePath, JSON.stringify(envelope));
    const publicationLease = await attachRootMesh(root, publicationMesh.meshId, { rootSessionId: "publish", budgets }); await beginMeshClose(root, publicationMesh.meshId, publicationLease.leaseId);
    await assert.rejects(publishAgent(root, publicationMesh.meshId, prepared.paths, { agentId: prepared.agentId, epochId: epoch.epochId, childId: "worker", harness: "pi", cwd: root, definitionSnapshot: definition, launchEnvelope: envelopePath, tmux, capabilities, creatorSessionId: "creator" }), /closing/u);

    const taskMesh = await initializeMesh(root, { rootSessionId: "task", recoverable: true, budgets });
    const taskEpoch = await ensurePolicyEpoch(root, taskMesh.meshId, syntheticEpochInput("ops", { worker: definition }));
    const agent = await createPublishedAgent(root, taskMesh.meshId, taskEpoch.epochId); const taskReservation = await reserveMeshCapacity(root, taskMesh.meshId, "existing-agent-task", agent.agentId); const requestedTaskId = randomUUID();
    const taskLease = await attachRootMesh(root, taskMesh.meshId, { rootSessionId: "task", budgets }); await beginMeshClose(root, taskMesh.meshId, taskLease.leaseId);
    await assert.rejects(createTask(root, taskMesh.meshId, agent.agentId, { prompt: "must not commit", purpose: "synthetic purpose" }, `root:${taskMesh.meshId}`, taskReservation.reservationId, requestedTaskId), /closing/u);
    await assert.rejects(access(taskPaths(root, taskMesh.meshId, requestedTaskId).request), error => (error as NodeJS.ErrnoException).code === "ENOENT");
}));

void test("root reconciliation removes uncommitted task directories and settles durable task, agent, and usage state exactly once", async () => withRoot("mesh-state-reconcile-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, syntheticEpochInput("ops", { worker: syntheticChild("worker") })); const agent = await createPublishedAgent(root, mesh.meshId, epoch.epochId);
    const taskId = randomUUID(); const paths = taskPaths(root, mesh.meshId, taskId); const createdAt = new Date().toISOString(); await mkdir(paths.directory, { recursive: true }); await writeFile(paths.request, JSON.stringify({ schemaVersion: 4, meshId: mesh.meshId, agentId: agent.agentId, taskId, prompt: "durable request", purpose: "synthetic purpose", requesterEndpointId: `root:${mesh.meshId}`, createdAt }));
    const abandonedId = randomUUID(); await mkdir(taskPaths(root, mesh.meshId, abandonedId).directory, { recursive: true });
    await patchAgentStatus(root, mesh.meshId, agent.agentId, { state: "idle", activeTaskId: undefined });
    assert.equal((await readMeshBudgetUsage(root, mesh.meshId)).lifetimeTasks, 1);
    const prepared = await reconcileMeshState(root, mesh.meshId); assert.equal(prepared.removedTaskDirectories, 1); assert.equal((await readAgentSnapshot(root, mesh.meshId, agent.agentId, taskId)).status.activeTaskId, taskId); await reconcileMeshReservations(root, mesh.meshId, async () => "absent"); const repairedReservation = JSON.parse(await readFile(reservationPath(root, mesh.meshId, agent.reservation.reservationId), "utf8")) as { taskId?: string }; assert.equal(repairedReservation.taskId, taskId);
    const task = await readAgentSnapshot(root, mesh.meshId, agent.agentId, taskId); const usage = emptyUsage(); usage.input = 7; usage.totalTokens = 7; usage.cost.input = 0.07; usage.cost.total = 0.07;
    await writeFile(paths.result, JSON.stringify({ schemaVersion: 1, meshId: mesh.meshId, agentId: agent.agentId, taskId, outcome: "succeeded", output: "done", usage, turns: 1, interventions: [], startedAt: task.task!.status.createdAt, finishedAt: new Date().toISOString() }));
    await reconcileMeshState(root, mesh.meshId); const settled = await readAgentSnapshot(root, mesh.meshId, agent.agentId, taskId); assert.equal(settled.agent.schemaVersion, 7); assert.equal(settled.task?.status.state, "succeeded"); assert.equal(settled.status.state, "idle"); assert.equal(settled.status.agentUsage.input, 7); assert.deepEqual(settled.status.accountedTaskIds, [taskId]);
    await reconcileMeshState(root, mesh.meshId); assert.equal((await readAgentSnapshot(root, mesh.meshId, agent.agentId, taskId)).status.agentUsage.input, 7);
    const agentPath = join(meshPaths(root, mesh.meshId).agents, agent.agentId, "agent.json"); const agentRecord = JSON.parse(await readFile(agentPath, "utf8")) as Record<string, unknown>; await writeFile(agentPath, JSON.stringify({ ...agentRecord, schemaVersion: 4 }));
    await assert.rejects(readAgentSnapshot(root, mesh.meshId, agent.agentId), /Unsupported agent record/u);
}));

void test("reservation recovery retains creating agents on unknown tmux evidence and removes records only on definitive absence", async () => withRoot("mesh-reservation-evidence-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const definition = syntheticChild("worker"); const epochId = randomUUID();
    const liveReservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task"); const live = await prepareAgent(root, mesh.meshId, { reservationId: liveReservation.reservationId, childId: "worker", harness: "pi", cwd: root, definitionSnapshot: definition, launchEnvelope: "pending", epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    assert.equal(await reconcileMeshReservations(root, mesh.meshId, async agentId => agentId === live.agentId ? "unknown" : "absent"), 0); await access(live.paths.status);
    const abandonedReservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task"); const abandoned = await prepareAgent(root, mesh.meshId, { reservationId: abandonedReservation.reservationId, childId: "worker", harness: "pi", cwd: root, definitionSnapshot: definition, launchEnvelope: "pending", epochId, provenance: { creatorSessionId: "creator" }, capabilities });
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
