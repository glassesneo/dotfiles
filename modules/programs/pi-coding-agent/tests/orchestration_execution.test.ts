import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { buildLaunchEnvelope as buildLaunchEnvelopeV8 } from "../extensions_src/utilities/agent_types.ts";
import { availableContext, publishAgentActivity, readAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import {
    END_RESPONSE_TOOL_NAME,
    ProcessExecutionGate,
    canApplyControlRevision,
    isJoinableAgentEnd,
    projectExecutionPhase,
    shouldOpenExecutionGate,
    successfulEndResponseMarker,
} from "../extensions_src/utilities/orchestration_execution.ts";
import { bindAgentRuntime } from "../extensions_src/utilities/orchestration_runtime.ts";
import { applyAgentControl, claimIdleAgentForStop, claimPendingTask, createTask, ensurePolicyEpoch, initializeMesh, patchAgentStatus, prepareAgent, publishAgent, readAgentExecution, readPolicyEpoch, readTask, reserveMeshCapacity } from "../extensions_src/utilities/orchestration_store.ts";
import { withTemporaryRoot as withRoot, yieldToIO } from "./test_helpers.ts";

const budgets = { maxLiveAgents: 4, maxConcurrentTasks: 4, maxTasksPerMesh: 16 };
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };
const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" };
const definition = {
    selector: { agent: "worker" as const, access: "read" as const },
    description: "Synthetic worker",
    tools: ["read"],
    instructions: "Work.",
    contextPolicy: "project" as const,
    childExtensionContributions: [] as string[],
    execution: { models: ["openai/test"], thinkingLevel: "medium" as const, harness: "pi" as const },
    targets: [] as string[],
    gc: { collectAt: 2, retain: 1, pressureFloor: 0 },
};

const endMessages = (toolCallId: string, extraCalls: Array<{ id: string; name: string }> = []) => [
    {
        role: "assistant",
        stopReason: "toolUse",
        content: [
            ...extraCalls.map(call => ({ type: "toolCall", id: call.id, name: call.name })),
            { type: "toolCall", id: toolCallId, name: END_RESPONSE_TOOL_NAME },
        ],
    },
    { role: "toolResult", toolName: END_RESPONSE_TOOL_NAME, toolCallId, details: { kind: END_RESPONSE_TOOL_NAME, toolCallId, ended: true } },
];

async function publishIdleWorker(root: string, meshId: string, epochId: string) {
    const reservation = await reserveMeshCapacity(root, meshId, "new-agent-task");
    const prepared = await prepareAgent(root, meshId, { reservationId: reservation.reservationId, childId: "worker", harness: "pi", cwd: root, definitionSnapshot: definition, launchEnvelope: "pending", epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    const epoch = await readPolicyEpoch(root, meshId, epochId);
    const childExtensions = Object.fromEntries(Object.keys(epoch.children).map(name => [name, ["/popup.ts", "/orchestration.ts", "/bridge.ts"]]));
    const envelope = buildLaunchEnvelopeV8({ meshId, agentId: prepared.agentId, epochId, childId: "worker", snapshot: epoch, childExtensions });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(envelope), { mode: 0o600 });
    await publishAgent(root, meshId, prepared.paths, { agentId: prepared.agentId, epochId, childId: "worker", harness: "pi", cwd: root, definitionSnapshot: definition, launchEnvelope: envelopePath, tmux, capabilities, creatorSessionId: "creator" });
    await patchAgentStatus(root, meshId, prepared.agentId, { state: "idle", bridgeReady: true });
    const runtimeId = randomUUID();
    await bindAgentRuntime(root, meshId, prepared.agentId, { runtimeId, kind: "pi", sessionId: "child", sessionFile: join(root, "child.jsonl") });
    const now = new Date().toISOString();
    await publishAgentActivity(root, meshId, prepared.agentId, { runtimeId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: now, observedAt: now, heartbeatAt: now, context: availableContext(10, 100_000, 100) });
    return prepared;
}

// Admission: Pi's terminate flag is not reimplemented here; the owned join contract is whether a successful standalone yield, and only that, counts as a joinable end.
void test("only stop or standalone end_response is joinable", () => {
    assert.equal(isJoinableAgentEnd([{ role: "assistant", stopReason: "stop" }]), true);
    assert.equal(successfulEndResponseMarker(endMessages("yield"))?.ended, true);
    assert.equal(isJoinableAgentEnd(endMessages("yield")), true);
    assert.equal(isJoinableAgentEnd(endMessages("yield", [{ id: "other", name: "mesh_send" }])), false);
    assert.equal(isJoinableAgentEnd([{ role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "x", name: "mesh_get" }] }]), false);
    assert.equal(isJoinableAgentEnd([{ role: "assistant", stopReason: "error" }]), false);
    assert.equal(isJoinableAgentEnd([{ role: "assistant", stopReason: "length" }]), false);
    assert.equal(isJoinableAgentEnd([{ role: "assistant", stopReason: "aborted" }]), false);
});

void test("process gate holds new work until resume and rejects stale revisions", async () => {
    const gate = new ProcessExecutionGate();
    assert.equal(gate.requestPause(1), true);
    assert.equal(gate.requestPause(0), false);
    const admitted = gate.waitForAdmission("tool-a");
    let resolved: string | undefined;
    void admitted.then(value => { resolved = value; });
    await Promise.resolve();
    assert.equal(resolved, undefined);
    assert.equal(gate.resume(2), true);
    assert.equal(await admitted, "admit");
    gate.complete("tool-a");
    assert.equal(canApplyControlRevision(2, 1), false);
});

void test("execution phases distinguish pausing, interrupted, and blocked-limit", () => {
    const manual = { holdId: "h1", kind: "manual" as const, revision: 1, requestId: "r1", source: "user" as const, targetRoot: "a", createdAt: "2026-01-01T00:00:00.000Z" };
    const limit = { ...manual, holdId: "h2", kind: "limit" as const };
    assert.equal(projectExecutionPhase({ waiting: false, inFlightCount: 1, holds: [manual], interrupting: false, interruptConfirmed: false, unavailable: false }), "pausing");
    assert.equal(projectExecutionPhase({ waiting: false, inFlightCount: 0, holds: [manual], interrupting: false, interruptConfirmed: true, unavailable: false }), "interrupted");
    assert.equal(projectExecutionPhase({ waiting: true, inFlightCount: 0, holds: [limit], interrupting: false, interruptConfirmed: false, unavailable: false }), "blocked-limit");
    assert.equal(projectExecutionPhase({ waiting: true, inFlightCount: 0, holds: [], interrupting: false, interruptConfirmed: false, unavailable: false }), "waiting");
});

void test("interactive input opens the process gate only after a released manual hold", () => {
    const manual = { holdId: "h1", kind: "manual" as const, revision: 1, requestId: "r1", source: "user" as const, targetRoot: "a", createdAt: "2026-01-01T00:00:00.000Z" };
    const limit = { ...manual, holdId: "h2", kind: "limit" as const };
    const open = { applied: true, status: "acknowledged" as const, state: { holds: [] as const, interrupting: false, interruptConfirmed: false } };
    assert.equal(shouldOpenExecutionGate(open), true);
    assert.equal(shouldOpenExecutionGate({ ...open, applied: false, status: "not_ready" }), false);
    assert.equal(shouldOpenExecutionGate({ ...open, status: "unavailable" }), false);
    assert.equal(shouldOpenExecutionGate({ ...open, status: "manual_resume_required" }), false);
    assert.equal(shouldOpenExecutionGate({ ...open, state: { holds: [limit], interrupting: false, interruptConfirmed: false } }), false);
    assert.equal(shouldOpenExecutionGate({ ...open, state: { holds: [], interrupting: true, interruptConfirmed: false } }), false);
    assert.equal(shouldOpenExecutionGate({ applied: true, status: "acknowledged", state: { holds: [manual], interrupting: false, interruptConfirmed: false } }), true);
});

// Admission: held tasks must remain nonterminal across claim, stale resume, and peer resume of a limit hold.
void test("store control keeps held tasks and rejects stale or peer limit resume", async () => withRoot("mesh-execution-hold-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const catalog = { schemaVersion: 1 as const, children: { worker: definition } };
    const callPolicy = { modes: { ops: { targets: ["worker"] } } };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", catalog, callPolicy });
    const worker = await publishIdleWorker(root, mesh.meshId, epoch.epochId);
    const task = await createTask(root, mesh.meshId, worker.agentId, { prompt: "keep this work", purpose: "synthetic purpose" }, `root:${mesh.meshId}`);
    const paused = await applyAgentControl(root, mesh.meshId, worker.agentId, { action: "pause", source: "user", issuer: "root" });
    assert.equal(paused.applied, true);
    assert.equal((await readTask(root, mesh.meshId, task.request.taskId)).status.state, "created");
    assert.equal(await claimPendingTask(root, mesh.meshId, worker.agentId), null);
    assert.equal((await applyAgentControl(root, mesh.meshId, worker.agentId, { action: "resume", source: "user", issuer: "root", expectedRevision: 0 })).status, "not_ready");
    const limited = await applyAgentControl(root, mesh.meshId, worker.agentId, {
        action: "pause",
        source: "system",
        issuer: "limit",
        limitHold: { holdId: randomUUID(), kind: "limit", requestId: randomUUID(), source: "system", targetRoot: worker.agentId },
    });
    assert.equal(limited.applied, true);
    assert.equal((await applyAgentControl(root, mesh.meshId, worker.agentId, { action: "resume", source: "peer", issuer: "child" })).status, "manual_resume_required");
    const resumed = await applyAgentControl(root, mesh.meshId, worker.agentId, { action: "resume", source: "user", issuer: "root", clearLimitHolds: true });
    assert.equal(resumed.applied, true);
    assert.equal((await readAgentExecution(root, mesh.meshId, worker.agentId))?.holds.length, 0);
    assert.equal((await readTask(root, mesh.meshId, task.request.taskId)).status.state, "created");
}));

// Admission: stale runtime/binding CAS and idle GC must not drop a held task; types cannot observe the claim/GC exclusion.
void test("stale runtime control is rejected and held idle agents are excluded from GC claims", async () => withRoot("mesh-execution-cas-gc-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const catalog = { schemaVersion: 1 as const, children: { worker: definition } };
    const callPolicy = { modes: { ops: { targets: ["worker"] } } };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", catalog, callPolicy });
    const worker = await publishIdleWorker(root, mesh.meshId, epoch.epochId);
    await applyAgentControl(root, mesh.meshId, worker.agentId, { action: "pause", source: "user", issuer: "root" });
    const stale = await applyAgentControl(root, mesh.meshId, worker.agentId, { action: "resume", source: "user", issuer: "root", expectedRuntimeId: randomUUID(), expectedBindingId: randomUUID() });
    assert.equal(stale.status, "not_ready");
    assert.equal((await readAgentExecution(root, mesh.meshId, worker.agentId))?.holds.length, 1);
    const sequence = (await readAgentActivity(root, mesh.meshId, worker.agentId))!.sequence;
    assert.equal(await claimIdleAgentForStop(root, mesh.meshId, worker.agentId, { source: "gc-role", reason: "held idle must remain", activitySequence: sequence, staleMs: 10_000 }), undefined);
    assert.equal((await readAgentExecution(root, mesh.meshId, worker.agentId))?.holds.length, 1);
}));

async function publishRole(root: string, meshId: string, epochId: string, childId: string, definitionSnapshot: typeof definition, parentAgentId?: string) {
    const reservation = await reserveMeshCapacity(root, meshId, "new-agent-task");
    const prepared = await prepareAgent(root, meshId, { reservationId: reservation.reservationId, childId, harness: "pi", cwd: root, definitionSnapshot, launchEnvelope: "pending", epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    const epoch = await readPolicyEpoch(root, meshId, epochId);
    const childExtensions = Object.fromEntries(Object.keys(epoch.children).map(name => [name, ["/popup.ts", "/orchestration.ts", "/bridge.ts"]]));
    const envelope = buildLaunchEnvelopeV8({ meshId, agentId: prepared.agentId, epochId, childId, snapshot: epoch, childExtensions });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(envelope), { mode: 0o600 });
    await publishAgent(root, meshId, prepared.paths, { agentId: prepared.agentId, epochId, childId, harness: "pi", cwd: root, definitionSnapshot, launchEnvelope: envelopePath, tmux, capabilities, creatorSessionId: "creator", ...(parentAgentId ? { parentAgentId } : {}) });
    await patchAgentStatus(root, meshId, prepared.agentId, { state: "idle", bridgeReady: true });
    const runtimeId = randomUUID();
    await bindAgentRuntime(root, meshId, prepared.agentId, { runtimeId, kind: "pi", sessionId: childId, sessionFile: join(root, `${childId}.jsonl`) });
    const now = new Date().toISOString();
    await publishAgentActivity(root, meshId, prepared.agentId, { runtimeId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: now, observedAt: now, heartbeatAt: now, context: availableContext(10, 100_000, 100) });
    return { ...prepared, reservationId: reservation.reservationId };
}

// Admission: a hold written between ancestor check and commit would start work under a paused tree; the shared mesh→lineage lock is the consumer-visible admission boundary.
// Given a held ancestor, existing-agent create, new-agent task commit, and an overlapping pause all refuse or wait rather than committing under that hold.
void test("ancestor hold and task commit share one lock boundary", async () => withRoot("mesh-hold-dispatch-boundary-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const lead = { ...definition, selector: { agent: "lead", access: "read" as const }, targets: ["worker"] };
    const catalog = { schemaVersion: 1 as const, children: { lead, worker: definition } };
    const callPolicy = { modes: { ops: { targets: ["lead"] } } };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", catalog, callPolicy });
    const parent = await publishRole(root, mesh.meshId, epoch.epochId, "lead", lead as typeof definition);
    const child = await publishRole(root, mesh.meshId, epoch.epochId, "worker", definition, parent.agentId);
    await applyAgentControl(root, mesh.meshId, parent.agentId, { action: "pause", source: "user", issuer: "root" });
    await assert.rejects(createTask(root, mesh.meshId, child.agentId, { prompt: "existing under hold", purpose: "synthetic purpose" }, `root:${mesh.meshId}`), /held and cannot accept new work/u);
    const heldNew = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task");
    const prepared = await prepareAgent(root, mesh.meshId, { reservationId: heldNew.reservationId, childId: "worker", harness: "pi", cwd: root, definitionSnapshot: definition, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    const snapshot = await readPolicyEpoch(root, mesh.meshId, epoch.epochId);
    const childExtensions = Object.fromEntries(Object.keys(snapshot.children).map(name => [name, ["/popup.ts", "/orchestration.ts", "/bridge.ts"]]));
    const envelope = buildLaunchEnvelopeV8({ meshId: mesh.meshId, agentId: prepared.agentId, epochId: epoch.epochId, childId: "worker", snapshot, childExtensions });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(envelope), { mode: 0o600 });
    await publishAgent(root, mesh.meshId, prepared.paths, { agentId: prepared.agentId, epochId: epoch.epochId, childId: "worker", harness: "pi", cwd: root, definitionSnapshot: definition, launchEnvelope: envelopePath, tmux, capabilities, creatorSessionId: "creator", parentAgentId: parent.agentId });
    await patchAgentStatus(root, mesh.meshId, prepared.agentId, { state: "creating", bridgeReady: true });
    await assert.rejects(createTask(root, mesh.meshId, prepared.agentId, { prompt: "new under hold", purpose: "synthetic purpose" }, `root:${mesh.meshId}`, heldNew.reservationId), /held and cannot accept new work/u);
    await applyAgentControl(root, mesh.meshId, parent.agentId, { action: "resume", source: "user", issuer: "root" });
    let pauseApplied = false;
    let pausing: Promise<unknown> | undefined;
    const committed = await createTask(root, mesh.meshId, child.agentId, { prompt: "commit then pause", purpose: "synthetic purpose" }, {
        requesterEndpointId: `root:${mesh.meshId}`,
        afterIndexesPersisted: async () => {
            pausing = applyAgentControl(root, mesh.meshId, parent.agentId, { action: "pause", source: "user", issuer: "root" }).then(result => { pauseApplied = true; return result; });
            await yieldToIO();
            assert.equal(pauseApplied, false);
        },
    });
    assert.equal(committed.status.state, "created");
    await pausing;
    assert.equal(pauseApplied, true);
    assert.equal((await readAgentExecution(root, mesh.meshId, parent.agentId))?.holds.some(hold => hold.kind === "manual"), true);
}));
