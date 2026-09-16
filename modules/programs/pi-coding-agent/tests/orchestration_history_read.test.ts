import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { buildLaunchEnvelope } from "../extensions_src/utilities/agent_types.ts";
import { availableContext, publishAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { bindMeshEndpoint } from "../extensions_src/utilities/orchestration_events.ts";
import { handleForAgentId } from "../extensions_src/utilities/orchestration_identity.ts";
import { listChildHistory, readChildHistoryBody } from "../extensions_src/utilities/orchestration_history_read.ts";
import { bindAgentRuntime } from "../extensions_src/utilities/orchestration_runtime.ts";
import { attachRootMesh, createTask, ensurePolicyEpoch, finishTask, initializeMesh, meshPaths, patchAgentStatus, prepareAgent, publishAgent, readPolicyEpoch, reserveMeshCapacity, taskPaths } from "../extensions_src/utilities/orchestration_store.ts";
import { withTemporaryRoot as withRoot } from "./test_helpers.ts";

const syntheticGc = { collectAt: 2, retain: 1, pressureFloor: 0 };
const syntheticExecution = { models: ["provider/model"], thinkingLevel: "medium" as const, harness: "pi" as const };
const syntheticChild = (name = "worker") => ({ selector: { agent: name, access: "read" as const }, description: `Synthetic ${name}`, tools: [], instructions: "Return the bounded result.", contextPolicy: "project" as const, childExtensionContributions: [] as string[], execution: syntheticExecution, targets: [] as string[], gc: syntheticGc });
const budgets = { maxLiveAgents: 4, maxConcurrentTasks: 8, maxTasksPerMesh: 8 };
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };
const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" };

async function publishHistoryAgent(root: string, meshId: string, epoch: Awaited<ReturnType<typeof ensurePolicyEpoch>>, definition: ReturnType<typeof syntheticChild>): Promise<string> {
    const reservation = await reserveMeshCapacity(root, meshId, "new-agent-task");
    const prepared = await prepareAgent(root, meshId, { reservationId: reservation.reservationId, childId: "worker", harness: "pi", cwd: root, definitionSnapshot: definition, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { creatorSessionId: "root" }, capabilities });
    const persistedEpoch = await readPolicyEpoch(root, meshId, epoch.epochId);
    const envelope = buildLaunchEnvelope({ meshId, agentId: prepared.agentId, epochId: epoch.epochId, childId: "worker", snapshot: epoch, childExtensions: Object.fromEntries(persistedEpoch.childSet.map(name => [name, ["/popup.ts", "/orchestration.ts", "/bridge.ts"]])) });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(envelope), { mode: 0o600 });
    await publishAgent(root, meshId, prepared.paths, { agentId: prepared.agentId, epochId: epoch.epochId, childId: "worker", harness: "pi", cwd: root, definitionSnapshot: definition, launchEnvelope: envelopePath, tmux: { ...tmux, windowId: `@${prepared.agentId}`, paneId: `%${prepared.agentId}` }, capabilities, creatorSessionId: "root" });
    await patchAgentStatus(root, meshId, prepared.agentId, { state: "idle", bridgeReady: true });
    await bindAgentRuntime(root, meshId, prepared.agentId, { runtimeId: prepared.agentId, kind: "external" });
    const now = new Date().toISOString();
    await publishAgentActivity(root, meshId, prepared.agentId, { runtimeId: prepared.agentId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: now, observedAt: now, heartbeatAt: now, context: availableContext(10, 100_000, 100) });
    return prepared.agentId;
}

async function historyFixture(root: string) {
    const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: "/root.jsonl", recoverable: true, budgets });
    const children = { worker: syntheticChild("worker") };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", catalog: { schemaVersion: 1, children }, callPolicy: { modes: { ops: { targets: ["worker"] } } } });
    const agentId = await publishHistoryAgent(root, mesh.meshId, epoch, children.worker);
    const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile: "/root.jsonl" });
    await attachRootMesh(root, mesh.meshId, { rootSessionId: "root", rootSessionFile: "/root.jsonl", budgets });
    return { mesh, agentId, endpoint };
}

function eventRecord(meshId: string, input: { eventId: string; endpointId: string; senderEndpointId: string; kind: "intervention" | "report" | "delivery-ack" | "completion" | "signal"; state: "pending" | "injected" | "acknowledged"; payload: Record<string, unknown>; createdAt?: string }) {
    return {
        schemaVersion: 1,
        meshId,
        eventId: input.eventId,
        endpointId: input.endpointId,
        endpointSessionFile: "/session.jsonl",
        endpointBindingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        senderEndpointId: input.senderEndpointId,
        senderEndpointSessionFile: "/root.jsonl",
        delivery: "steer",
        state: input.state,
        kind: input.kind,
        payload: { eventId: input.eventId, ...input.payload },
        createdAt: input.createdAt ?? "2026-01-01T00:00:00Z",
    };
}

async function writeEvent(root: string, meshId: string, event: ReturnType<typeof eventRecord>, name = `${event.eventId}.json`): Promise<void> {
    await writeFile(join(meshPaths(root, meshId).events, name), JSON.stringify(event));
}

async function snapshotMeshFiles(root: string, meshId: string): Promise<Map<string, string>> {
    const directory = meshPaths(root, meshId).directory;
    const files = new Map<string, string>();
    async function walk(current: string): Promise<void> {
        const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) await walk(path);
            else files.set(path, await readFile(path, "utf8"));
        }
    }
    await walk(directory);
    return files;
}

// Admission: the UI history reader is the only boundary that joins all tasks, multi-task completion batches, and pending/injected/acknowledged events without consuming delivery; schemas cannot prove purity or join correctness.
// Given reused tasks, a two-task completion batch, pending/injected/acknowledged events, retry files, and a malformed record, listChildHistory exposes readable rows and full bodies on demand without mutating mesh files.
void test("child history reader joins tasks and acknowledged events without delivery mutations", async () => withRoot("mesh-history-read-", async root => {
    const fixture = await historyFixture(root);
    const meshId = fixture.mesh.meshId;
    const child = fixture.agentId;
    const first = await createTask(root, meshId, child, { prompt: "first prompt body", purpose: "First purpose" }, fixture.endpoint.endpointId);
    await finishTask(root, meshId, first.request.taskId, { outcome: "succeeded", output: "first result body" });
    const prior = await createTask(root, meshId, child, { prompt: "prior prompt body", purpose: "Prior purpose" }, fixture.endpoint.endpointId);
    await finishTask(root, meshId, prior.request.taskId, { outcome: "succeeded", output: "prior result body" });
    const second = await createTask(root, meshId, child, { prompt: "second prompt body", purpose: "Second purpose" }, fixture.endpoint.endpointId);
    const interventionId = randomUUID();
    const pendingId = randomUUID();
    const reportId = randomUUID();
    const ackId = randomUUID();
    const completionId = randomUUID();
    const malformedId = randomUUID();
    const retryId = randomUUID();
    await writeEvent(root, meshId, eventRecord(meshId, {
        eventId: interventionId, endpointId: `agent:${child}`, senderEndpointId: fixture.endpoint.endpointId, kind: "intervention", state: "acknowledged",
        payload: { messageId: interventionId, agentId: child, taskId: second.request.taskId, sequence: 1, message: "follow-up one\nline two\nline three" }, createdAt: "2026-01-01T00:02:00Z",
    }));
    await writeEvent(root, meshId, eventRecord(meshId, {
        eventId: pendingId, endpointId: `agent:${child}`, senderEndpointId: fixture.endpoint.endpointId, kind: "intervention", state: "pending",
        payload: { messageId: pendingId, agentId: child, taskId: second.request.taskId, sequence: 2, message: "pending follow-up" }, createdAt: "2026-01-01T00:02:02Z",
    }));
    await writeEvent(root, meshId, eventRecord(meshId, {
        eventId: reportId, endpointId: fixture.endpoint.endpointId, senderEndpointId: `agent:${child}`, kind: "report", state: "injected",
        payload: { reportId, agentId: child, taskId: first.request.taskId, summary: "injected report body" }, createdAt: "2026-01-01T00:01:30Z",
    }));
    await writeEvent(root, meshId, eventRecord(meshId, {
        eventId: ackId, endpointId: fixture.endpoint.endpointId, senderEndpointId: `agent:${child}`, kind: "delivery-ack", state: "acknowledged",
        payload: { ackId, agentId: child, taskId: second.request.taskId, acknowledgedThrough: 1, messageIds: [interventionId] }, createdAt: "2026-01-01T00:02:01Z",
    }));
    await writeEvent(root, meshId, eventRecord(meshId, {
        eventId: completionId, endpointId: fixture.endpoint.endpointId, senderEndpointId: fixture.endpoint.endpointId, kind: "completion", state: "acknowledged",
        payload: { batchId: randomUUID(), settledAt: "2026-01-01T00:01:00Z", tasks: [
            { taskId: first.request.taskId, agentId: child, state: "succeeded" },
            { taskId: prior.request.taskId, agentId: child, state: "succeeded" },
        ] }, createdAt: "2026-01-01T00:01:00Z",
    }));
    await writeEvent(root, meshId, eventRecord(meshId, {
        eventId: retryId, endpointId: `agent:${child}`, senderEndpointId: fixture.endpoint.endpointId, kind: "intervention", state: "pending",
        payload: { messageId: retryId, agentId: child, taskId: second.request.taskId, sequence: 9, message: "retry only" },
    }), `send-retry-${retryId}.json`);
    await writeFile(join(meshPaths(root, meshId).events, `${malformedId}.json`), "{not-json");
    const before = await snapshotMeshFiles(root, meshId);
    const listed = await listChildHistory(root, meshId, child, ["May"]);
    const afterList = await snapshotMeshFiles(root, meshId);
    const byPath = (left: readonly [string, string], right: readonly [string, string]) => left[0].localeCompare(right[0]);
    assert.deepEqual([...afterList.entries()].sort(byPath), [...before.entries()].sort(byPath));
    assert.equal(listed.loadFailed, false);
    assert.equal(listed.unavailableCount, 1);
    assert.equal(listed.items.filter(item => item.kind === "request").length, 3);
    const completions = listed.items.filter(item => item.kind === "completion");
    assert.equal(completions.length, 2);
    assert.equal(new Set(completions.map(item => item.taskId)).size, 2);
    assert.ok(completions.every(item => item.deliveryState === "acknowledged"));
    assert.ok(completions.some(item => item.purpose === "First purpose" && item.taskId === first.request.taskId));
    assert.ok(completions.some(item => item.purpose === "Prior purpose" && item.taskId === prior.request.taskId));
    assert.equal(listed.items.filter(item => item.kind === "intervention").length, 2);
    assert.equal(listed.items.filter(item => item.kind === "delivery-ack").length, 1);
    assert.equal(listed.items.filter(item => item.kind === "report").length, 1);
    assert.equal(listed.items.some(item => item.preview.includes("retry only")), false);
    assert.ok(listed.items.some(item => item.kind === "intervention" && item.deliveryState === "pending" && item.preview.includes("pending follow-up")));
    assert.ok(listed.items.some(item => item.kind === "report" && item.deliveryState === "injected" && item.preview.includes("injected report body")));
    const completion = listed.items.find(item => item.kind === "completion" && item.taskId === first.request.taskId)!;
    assert.equal(completion.purpose, "First purpose");
    assert.equal(completion.deliveryState, "acknowledged");
    assert.match(completion.from.label, new RegExp(handleForAgentId(child, ["May"]), "u"));
    assert.match(completion.from.label, /worker\/read/u);
    assert.equal(completion.to.label, "root");
    assert.equal(listed.items.filter(item => item.kind === "completion" && item.taskId === first.request.taskId).length, 1);
    const intervention = listed.items.find(item => item.kind === "intervention" && item.deliveryState === "acknowledged")!;
    assert.equal(intervention.from.label, "root");
    assert.match(intervention.to.label, /May-/u);
    assert.equal(intervention.deliveryState, "acknowledged");
    assert.equal(intervention.truncated, true);
    assert.doesNotMatch(intervention.preview, /line three/u);
    const ack = listed.items.find(item => item.kind === "delivery-ack")!;
    assert.equal(ack.to.label, "root");
    assert.equal(ack.purpose, "Second purpose");
    assert.equal(ack.taskId, second.request.taskId);
    assert.match(ack.preview, /follow-up one/u);
    const prompt = await readChildHistoryBody(root, meshId, { kind: "task-prompt", id: second.request.taskId, taskId: second.request.taskId });
    const result = await readChildHistoryBody(root, meshId, { kind: "task-result", id: first.request.taskId, taskId: first.request.taskId });
    const priorResult = await readChildHistoryBody(root, meshId, { kind: "task-result", id: prior.request.taskId, taskId: prior.request.taskId });
    const eventBody = await readChildHistoryBody(root, meshId, { kind: "event", id: interventionId, taskId: second.request.taskId });
    const ackBody = await readChildHistoryBody(root, meshId, { kind: "event", id: ackId, taskId: second.request.taskId });
    const reportBody = await readChildHistoryBody(root, meshId, { kind: "event", id: reportId, taskId: first.request.taskId });
    const afterRead = await snapshotMeshFiles(root, meshId);
    assert.deepEqual([...afterRead.entries()].sort(byPath), [...before.entries()].sort(byPath));
    assert.equal(prompt, "second prompt body");
    assert.equal(result, "first result body");
    assert.equal(priorResult, "prior result body");
    assert.match(eventBody, /line three/u);
    assert.match(ackBody, /follow-up one/u);
    assert.match(ackBody, new RegExp(interventionId, "u"));
    assert.equal(reportBody, "injected report body");
}));

// Admission: missing referenced files must not masquerade as empty successful bodies. Schemas
// validate surviving records, not their filesystem joins; the UI reader owns this distinction.
// Given an ack with a lost original and a terminal task with a lost result, readable task
// metadata survives, unavailable records are counted, and full-body loading reports failure.
void test("history retains task metadata for orphan acknowledgments and rejects missing result bodies", async () => withRoot("mesh-history-missing-", async root => {
    const { mesh, agentId, endpoint } = await historyFixture(root);
    const task = await createTask(root, mesh.meshId, agentId, { prompt: "request survives", purpose: "Known purpose" }, endpoint.endpointId);
    await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "lost output" });
    await rm(taskPaths(root, mesh.meshId, task.request.taskId).result);
    const ackId = randomUUID();
    await writeEvent(root, mesh.meshId, eventRecord(mesh.meshId, {
        eventId: ackId, endpointId: endpoint.endpointId, senderEndpointId: `agent:${agentId}`, kind: "delivery-ack", state: "pending",
        payload: { ackId, agentId, taskId: task.request.taskId, acknowledgedThrough: 1, messageIds: [randomUUID()] },
    }));
    const before = await snapshotMeshFiles(root, mesh.meshId);
    const history = await listChildHistory(root, mesh.meshId, agentId);
    assert.equal(history.loadFailed, false);
    assert.equal(history.unavailableCount, 2);
    assert.equal(history.items.find(item => item.kind === "delivery-ack")?.purpose, "Known purpose");
    await assert.rejects(readChildHistoryBody(root, mesh.meshId, { kind: "task-result", id: task.request.taskId }), /unavailable/u);
    assert.deepEqual(await snapshotMeshFiles(root, mesh.meshId), before);
}));

// Admission: join of output+error, ack purpose from original follow-up, per-task signal purpose, unrelated-signal omission, filename/eventId mismatch, and missing results are consumer-visible and not owned by schemas.
// Given a failed task with partial output, an ack whose payload task differs from the original follow-up, a multi-task signal, an unrelated signal, a mismatched event filename, and missing/malformed records, the reader keeps those associations, omits undeterminable signals, and counts unavailable records.
void test("history reader preserves partial output, original ack association, signal purposes, and unavailable counts", async () => withRoot("mesh-history-join-", async root => {
    const fixture = await historyFixture(root);
    const meshId = fixture.mesh.meshId;
    const child = fixture.agentId;
    const failed = await createTask(root, meshId, child, { prompt: "failed prompt", purpose: "Failed purpose" }, fixture.endpoint.endpointId);
    await finishTask(root, meshId, failed.request.taskId, { outcome: "failed", output: "partial output kept", error: "failed with remainder" });
    const alpha = await createTask(root, meshId, child, { prompt: "alpha prompt", purpose: "Alpha purpose" }, fixture.endpoint.endpointId);
    await finishTask(root, meshId, alpha.request.taskId, { outcome: "succeeded", output: "alpha result" });
    const beta = await createTask(root, meshId, child, { prompt: "beta prompt", purpose: "Beta purpose" }, fixture.endpoint.endpointId);
    await finishTask(root, meshId, beta.request.taskId, { outcome: "succeeded", output: "beta result" });
    const followupId = randomUUID();
    const ackId = randomUUID();
    const signalId = randomUUID();
    const mismatchId = randomUUID();
    const mismatchName = randomUUID();
    await writeEvent(root, meshId, eventRecord(meshId, {
        eventId: followupId, endpointId: `agent:${child}`, senderEndpointId: fixture.endpoint.endpointId, kind: "intervention", state: "acknowledged",
        payload: { messageId: followupId, agentId: child, taskId: beta.request.taskId, sequence: 1, message: "beta follow-up body" }, createdAt: "2026-01-01T00:04:00Z",
    }));
    await writeEvent(root, meshId, eventRecord(meshId, {
        eventId: ackId, endpointId: fixture.endpoint.endpointId, senderEndpointId: `agent:${child}`, kind: "delivery-ack", state: "acknowledged",
        payload: { ackId, agentId: child, taskId: alpha.request.taskId, acknowledgedThrough: 1, messageIds: [followupId] }, createdAt: "2026-01-01T00:04:01Z",
    }));
    await writeEvent(root, meshId, eventRecord(meshId, {
        eventId: signalId, endpointId: fixture.endpoint.endpointId, senderEndpointId: `agent:${child}`, kind: "signal", state: "pending",
        payload: { topic: "status", text: "shared signal", taskIds: [alpha.request.taskId, beta.request.taskId] }, createdAt: "2026-01-01T00:05:00Z",
    }));
    const foreignSignalId = randomUUID();
    const foreignTaskId = randomUUID();
    const foreignAgentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await writeEvent(root, meshId, eventRecord(meshId, {
        eventId: foreignSignalId, endpointId: fixture.endpoint.endpointId, senderEndpointId: `agent:${foreignAgentId}`, kind: "signal", state: "pending",
        payload: { topic: "other", text: "foreign signal body", taskIds: [foreignTaskId] }, createdAt: "2026-01-01T00:05:30Z",
    }));
    await writeEvent(root, meshId, eventRecord(meshId, {
        eventId: mismatchId, endpointId: `agent:${child}`, senderEndpointId: fixture.endpoint.endpointId, kind: "report", state: "pending",
        payload: { reportId: mismatchId, agentId: child, taskId: alpha.request.taskId, summary: "mismatched filename report" }, createdAt: "2026-01-01T00:06:00Z",
    }), `${mismatchName}.json`);
    const missing = await createTask(root, meshId, child, { prompt: "missing result prompt", purpose: "Missing result" }, fixture.endpoint.endpointId);
    await writeFile(taskPaths(root, meshId, missing.request.taskId).status, JSON.stringify({
        schemaVersion: 1, meshId, agentId: child, taskId: missing.request.taskId, state: "succeeded",
        createdAt: missing.request.createdAt, finishedAt: "2026-01-01T00:07:00Z",
    }));
    const malformedTaskId = randomUUID();
    await mkdir(taskPaths(root, meshId, malformedTaskId).directory, { recursive: true, mode: 0o700 });
    await writeFile(taskPaths(root, meshId, malformedTaskId).request, JSON.stringify({
        schemaVersion: 4, meshId, agentId: child, taskId: malformedTaskId, prompt: "malformed status", purpose: "Malformed task",
        requesterEndpointId: fixture.endpoint.endpointId, createdAt: "2026-01-01T00:08:00Z",
    }));
    await writeFile(taskPaths(root, meshId, malformedTaskId).status, "not-json");
    const unreadableTaskId = randomUUID();
    await mkdir(taskPaths(root, meshId, unreadableTaskId).directory, { recursive: true });
    await writeFile(taskPaths(root, meshId, unreadableTaskId).request, "not-json");
    const before = await snapshotMeshFiles(root, meshId);
    const listed = await listChildHistory(root, meshId, child, ["May"]);
    const after = await snapshotMeshFiles(root, meshId);
    const byPath = (left: readonly [string, string], right: readonly [string, string]) => left[0].localeCompare(right[0]);
    assert.deepEqual([...after.entries()].sort(byPath), [...before.entries()].sort(byPath));
    const failedBody = await readChildHistoryBody(root, meshId, { kind: "task-result", id: failed.request.taskId, taskId: failed.request.taskId });
    assert.match(failedBody, /partial output kept/u);
    assert.match(failedBody, /failed with remainder/u);
    const failedRow = listed.items.find(item => item.kind === "completion" && item.taskId === failed.request.taskId);
    assert.match(failedRow?.preview ?? "", /partial output kept/u);
    const ack = listed.items.find(item => item.kind === "delivery-ack");
    assert.equal(ack?.purpose, "Beta purpose");
    assert.equal(ack?.taskId, beta.request.taskId);
    assert.notEqual(ack?.purpose, "Alpha purpose");
    assert.match(ack?.preview ?? "", /beta follow-up body/u);
    const signals = listed.items.filter(item => item.kind === "signal");
    assert.equal(signals.length, 2);
    assert.equal(new Set(signals.map(item => item.purpose)).size, 2);
    assert.ok(signals.some(item => item.purpose === "Alpha purpose" && item.taskId === alpha.request.taskId));
    assert.ok(signals.some(item => item.purpose === "Beta purpose" && item.taskId === beta.request.taskId));
    assert.equal(listed.items.some(item => item.id === foreignSignalId || (item.preview ?? "").includes("foreign signal body")), false);
    assert.equal(listed.items.some(item => item.preview.includes("mismatched filename report")), false);
    assert.equal(listed.unavailableCount, 4);
    assert.equal(listed.items.some(item => item.kind === "request" && item.taskId === malformedTaskId), false);
    assert.equal(listed.items.some(item => item.kind === "completion" && item.taskId === missing.request.taskId && item.purpose === "Missing result"), true);
}));

// Admission: empty history vs unreadable state, and UUID handles after lost snapshots, are consumer-visible and not owned by schemas or delivery readers.
// Given no records, a non-mesh path, and an event for an unpublished agent, listChildHistory distinguishes empty from loadFailed and labels the unpublished agent with its UUID handle.
void test("child history distinguishes empty lists from load failure and lost snapshots keep uuid handles", async () => withRoot("mesh-history-empty-", async root => {
    const fixture = await historyFixture(root);
    const empty = await listChildHistory(root, fixture.mesh.meshId, fixture.agentId, ["May"]);
    assert.equal(empty.loadFailed, false);
    assert.equal(empty.items.length, 0);
    assert.equal(empty.unavailableCount, 0);
    const file = join(root, "not-a-mesh");
    await writeFile(file, "x");
    const failed = await listChildHistory(file, fixture.mesh.meshId, fixture.agentId, ["May"]);
    assert.equal(failed.loadFailed, true);
    assert.equal(failed.items.length, 0);
    const missing = await listChildHistory(root, fixture.mesh.meshId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", ["May"]);
    assert.equal(missing.loadFailed, false);
    const interventionId = randomUUID();
    await writeEvent(root, fixture.mesh.meshId, eventRecord(fixture.mesh.meshId, {
        eventId: interventionId, endpointId: "agent:cccccccc-cccc-4ccc-8ccc-cccccccccccc", senderEndpointId: fixture.endpoint.endpointId, kind: "intervention", state: "pending",
        payload: { messageId: interventionId, agentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", taskId: randomUUID(), sequence: 1, message: "orphan" },
    }));
    const orphan = await listChildHistory(root, fixture.mesh.meshId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", ["May"]);
    assert.equal(orphan.items[0]?.to.label, handleForAgentId("cccccccc-cccc-4ccc-8ccc-cccccccccccc", ["May"]));
    assert.doesNotMatch(orphan.items[0]?.to.label ?? "", /worker|unresolved/u);
}));
