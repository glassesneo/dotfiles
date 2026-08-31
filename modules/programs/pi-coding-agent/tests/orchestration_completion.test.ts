import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { completionLedgerPath, createCompletionReceipt, readCompletionLedger, reconcileCompletionReceipts, rollbackCompletionReceipt, settleCompletionDeliveriesUnlocked, validateCompletionTarget } from "../extensions_src/utilities/orchestration_completion.ts";
import { indexTaskSubmission, indexTerminalTransition, orchestrationIndexPath } from "../extensions_src/utilities/orchestration_index.ts";
import { initializeMesh, readPersistedCompletionReceiptEvidence, readTask, taskPaths } from "../extensions_src/utilities/orchestration_store.ts";
import { meshDirectory, withMeshLock } from "../extensions_src/utilities/orchestration_lock.ts";
import { withTemporaryRoot as withRoot } from "./test_helpers.ts";

const budgets = { maxLiveAgents: 20, maxConcurrentTasks: 20, maxTasksPerMesh: 256 };
type TaskState = "created" | "succeeded" | "failed" | "stopped";

async function fixture(root: string) {
    const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: "/root.jsonl", recoverable: true, budgets });
    const endpointId = `root:${mesh.meshId}`;
    const key = createHash("sha256").update(endpointId).digest("hex");
    await writeFile(join(meshDirectory(root, mesh.meshId), "endpoints", `${key}.json`), JSON.stringify({ schemaVersion: 2, meshId: mesh.meshId, endpointId, bindingId: randomUUID(), kind: "root", harness: "pi", sessionId: "root", sessionFile: "/root.jsonl", online: true, updatedAt: new Date().toISOString() }));
    return { mesh, endpointId };
}

async function persistTask(root: string, meshId: string, input: { endpointId: string; state: TaskState; agentId?: string; createdAt?: string; schemaVersion?: number; completion?: Record<string, unknown> }) {
    const taskId = randomUUID();
    const agentId = input.agentId ?? randomUUID();
    const paths = taskPaths(root, meshId, taskId);
    const createdAt = input.createdAt ?? new Date().toISOString();
    const endpointKey = createHash("sha256").update(input.endpointId).digest("hex");
    const endpoint = JSON.parse(await readFile(join(meshDirectory(root, meshId), "endpoints", `${endpointKey}.json`), "utf8")) as { bindingId: string };
    const completion = input.completion ?? { endpointId: input.endpointId, endpointSessionFile: "/root.jsonl", bindingId: endpoint.bindingId };
    await mkdir(paths.directory, { recursive: true });
    await writeFile(paths.request, JSON.stringify({ schemaVersion: input.schemaVersion ?? 3, meshId, agentId, taskId, prompt: "bounded", requesterEndpointId: input.endpointId, completion, createdAt }));
    await writeFile(paths.status, JSON.stringify({ schemaVersion: 1, meshId, agentId, taskId, state: input.state, createdAt, ...(input.state === "created" ? {} : { finishedAt: new Date().toISOString() }) }));
    await indexTaskSubmission(root, meshId, { agentId, taskId, createdAt, completion: completion as { endpointId: string; endpointSessionFile: string; bindingId: string } });
    if (input.state !== "created") await indexTerminalTransition(root, meshId, { agentId, taskId, queuedAt: createdAt, completion: completion as { endpointId: string; endpointSessionFile: string; bindingId: string } });
    return taskId;
}

function receiptInput(endpointId: string, taskIds: string[], overrides: Partial<Parameters<typeof createCompletionReceipt>[2]> = {}): Parameters<typeof createCompletionReceipt>[2] {
    return { endpointId, endpointSessionFile: "/root.jsonl", claimantSessionFile: "/root.jsonl", toolCallId: "get-call", toolName: "mesh_get", canonicalArguments: { taskIds }, taskIds, maxTasksPerMesh: 256, ...overrides };
}

async function persistCancellation(root: string, meshId: string, taskId: string, agentId: string, requesterEndpointId: string) {
    await writeFile(taskPaths(root, meshId, taskId).cancel, JSON.stringify({ schemaVersion: 1, meshId, agentId, taskId, requesterEndpointId, requestedAt: new Date().toISOString(), reason: "Stopped by requester" }));
}

async function persistConfirmedStop(root: string, meshId: string, agentId: string, input: { source: "user" | "peer" | "gc-role"; requesterEndpointId: string; affectedTaskId: string }) {
    const now = new Date().toISOString();
    const path = join(meshDirectory(root, meshId), "agents", agentId, "stop.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ schemaVersion: 1, meshId, agentId, stopRequestId: randomUUID(), state: "confirmed", source: input.source, requesterEndpointId: input.requesterEndpointId, affectedTaskId: input.affectedTaskId, reason: "Stopped by requester", previousAgentState: "busy", requestedAt: now, updatedAt: now, confirmedAt: now }));
}

// Admitted: persistence ordering is not covered by types; the ledger owner must expose one deterministic endpoint batch and replay its frozen identity after a ledger-first interruption.
void test("one settlement pass durably batches all newly terminal endpoint tasks in deterministic order", async () => withRoot("mesh-completion-settlement-", async root => {
    const { mesh, endpointId } = await fixture(root);
    const later = await persistTask(root, mesh.meshId, { endpointId, state: "failed", createdAt: "2026-08-14T00:00:01.000Z" });
    const earlier = await persistTask(root, mesh.meshId, { endpointId, state: "succeeded", createdAt: "2026-08-14T00:00:00.000Z" });
    await persistTask(root, mesh.meshId, { endpointId, state: "created", createdAt: "2026-08-14T00:00:02.000Z" });

    const first = await withMeshLock(root, mesh.meshId, () => settleCompletionDeliveriesUnlocked(root, mesh.meshId, 256));
    assert.equal(first.eventBatches.length, 1);
    assert.deepEqual(first.eventBatches[0]!.batch.taskIds, [earlier, later]);
    const frozen = first.eventBatches[0]!.batch;

    const repaired = await withMeshLock(root, mesh.meshId, () => settleCompletionDeliveriesUnlocked(root, mesh.meshId, 256));
    assert.equal(repaired.ledgersPersisted, false);
    assert.deepEqual(repaired.eventBatches.map(item => item.batch), [frozen]);
    assert.equal((await readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl"))!.schemaVersion, 4);
}));

// Admitted: receipt-before-settlement loss and at-most-once reception cross the durable ledger boundary and are not mechanically detectable.
void test("receipts are canonical-argument idempotent and exclude received tasks from later settlement", async () => withRoot("mesh-completion-receipt-", async root => {
    const { mesh, endpointId } = await fixture(root);
    const received = await persistTask(root, mesh.meshId, { endpointId, state: "succeeded", createdAt: "2026-08-14T00:00:00.000Z" });
    const notified = await persistTask(root, mesh.meshId, { endpointId, state: "failed", createdAt: "2026-08-14T00:00:01.000Z" });
    const first = await createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [received], { canonicalArguments: { debug: false, taskId: received } }));
    const retry = await createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [received], { canonicalArguments: { taskId: received, debug: false } }));
    assert.deepEqual(retry, { receipt: first.receipt, created: false, receivedTaskIds: [] });
    await assert.rejects(createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [received], { canonicalArguments: { taskId: received, debug: true } })), /different arguments/u);

    await withMeshLock(root, mesh.meshId, () => settleCompletionDeliveriesUnlocked(root, mesh.meshId, 256));
    const ledger = await readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl");
    assert.deepEqual(ledger!.batches.flatMap(batch => batch.taskIds), [notified]);
    assert.deepEqual(ledger!.receipts.flatMap(receipt => receipt.taskIds), [received]);
}));

// Admitted: rollback and startup reconciliation are crash-recovery contracts observable only through durable receipt state.
void test("rollback and reconciliation remove only uncommitted provisional receipts", async () => withRoot("mesh-completion-recovery-", async root => {
    const { mesh, endpointId } = await fixture(root);
    const rollbackTask = await persistTask(root, mesh.meshId, { endpointId, state: "succeeded" });
    const orphanTask = await persistTask(root, mesh.meshId, { endpointId, state: "failed" });
    const retainedTask = await persistTask(root, mesh.meshId, { endpointId, state: "stopped" });
    const provisional = await createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [rollbackTask], { toolCallId: "rollback" }));
    assert.equal(await rollbackCompletionReceipt(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl", receiptId: provisional.receipt!.receiptId }), true);
    const orphan = await createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [orphanTask], { toolCallId: "orphan" }));
    const retained = await createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [retainedTask], { toolCallId: "retained" }));

    const result = await reconcileCompletionReceipts(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl", claimantSessionFile: "/root.jsonl", persistedReceipts: new Map([[retained.receipt!.receiptId, [{ toolCallId: "retained", toolName: "mesh_get", receivedTaskIds: [], claimedTaskIds: [] }]]]) });
    assert.deepEqual(result.removedReceiptIds, [orphan.receipt!.receiptId]);
    assert.deepEqual((await readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl"))!.receipts.map(receipt => receipt.taskIds), [[retainedTask]]);
    const endpointKey = createHash("sha256").update(endpointId).digest("hex"); const endpoint = JSON.parse(await readFile(join(meshDirectory(root, mesh.meshId), "endpoints", `${endpointKey}.json`), "utf8")) as { bindingId: string }; const reference = (taskId: string) => orchestrationIndexPath(root, mesh.meshId, "completion-queue", { endpointId, endpointSessionFile: "/root.jsonl", bindingId: endpoint.bindingId, taskId });
    await Promise.all([access(reference(rollbackTask)), access(reference(orphanTask))]); await assert.rejects(access(reference(retainedTask)), error => (error as NodeJS.ErrnoException).code === "ENOENT");
}));

// Admission: completion suppression is durable routing behavior; schemas cannot determine whether a stopped task was stopped by its own completion endpoint through an explicit task or agent stop.
// Given self-requested task and matching explicit agent stops, when stopped tasks settle, the completion endpoint observes no completion batch.
void test("self task stops and matching explicit agent stops suppress completion delivery", async () => withRoot("mesh-completion-stop-suppression-", async root => {
    const { mesh, endpointId } = await fixture(root);
    const taskStopAgent = randomUUID();
    const taskStop = await persistTask(root, mesh.meshId, { endpointId, agentId: taskStopAgent, state: "stopped", createdAt: "2026-08-14T00:00:00.000Z" });
    await persistCancellation(root, mesh.meshId, taskStop, taskStopAgent, endpointId);
    const agentStopAgent = randomUUID();
    const agentStop = await persistTask(root, mesh.meshId, { endpointId, agentId: agentStopAgent, state: "stopped", createdAt: "2026-08-14T00:00:01.000Z" });
    await persistConfirmedStop(root, mesh.meshId, agentStopAgent, { source: "peer", requesterEndpointId: endpointId, affectedTaskId: agentStop });

    const settled = await withMeshLock(root, mesh.meshId, () => settleCompletionDeliveriesUnlocked(root, mesh.meshId, budgets.maxTasksPerMesh));
    assert.deepEqual(settled.eventBatches, []);
    assert.equal(await readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl"), undefined);
}));

// Admission: only self explicit stops suppress completion; overbroad suppression would lose a consumer-visible completion for externally stopped, non-explicit, successful, or failed tasks.
// Given terminal tasks outside the matching self-stop boundary, when completions settle, the endpoint receives every terminal task once.
void test("other-endpoint and non-explicit stops, successes, and failures retain completion delivery", async () => withRoot("mesh-completion-stop-preservation-", async root => {
    const { mesh, endpointId } = await fixture(root);
    const otherEndpointStopAgent = randomUUID();
    const otherEndpointStop = await persistTask(root, mesh.meshId, { endpointId, agentId: otherEndpointStopAgent, state: "stopped", createdAt: "2026-08-14T00:00:00.000Z" });
    await persistCancellation(root, mesh.meshId, otherEndpointStop, otherEndpointStopAgent, "root:other-endpoint");
    const nonExplicitStopAgent = randomUUID();
    const nonExplicitStop = await persistTask(root, mesh.meshId, { endpointId, agentId: nonExplicitStopAgent, state: "stopped", createdAt: "2026-08-14T00:00:01.000Z" });
    await persistConfirmedStop(root, mesh.meshId, nonExplicitStopAgent, { source: "gc-role", requesterEndpointId: endpointId, affectedTaskId: nonExplicitStop });
    const succeeded = await persistTask(root, mesh.meshId, { endpointId, state: "succeeded", createdAt: "2026-08-14T00:00:02.000Z" });
    const failed = await persistTask(root, mesh.meshId, { endpointId, state: "failed", createdAt: "2026-08-14T00:00:03.000Z" });

    const settled = await withMeshLock(root, mesh.meshId, () => settleCompletionDeliveriesUnlocked(root, mesh.meshId, budgets.maxTasksPerMesh));
    assert.deepEqual(settled.eventBatches[0]!.batch.taskIds, [otherEndpointStop, nonExplicitStop, succeeded, failed]);
    assert.deepEqual(settled.eventBatches[0]!.tasks.map(task => task.state), ["stopped", "stopped", "succeeded", "failed"]);
}));

// Mechanical protocol validation: exact keys and generation checks reject channel-bearing targets and pre-v3 persisted records without migration.
void test("completion target, task request, and ledger reject old channel protocol generations", async () => withRoot("mesh-completion-generation-", async root => {
    const { mesh, endpointId } = await fixture(root);
    assert.deepEqual(validateCompletionTarget({ endpointId, endpointSessionFile: "/root.jsonl" }, endpointId), { endpointId, endpointSessionFile: "/root.jsonl" });
    assert.throws(() => validateCompletionTarget({ endpointId, endpointSessionFile: "/root.jsonl", mode: "channel", channel: "A" }, endpointId), /invalid keys/u);

    const oldTask = await persistTask(root, mesh.meshId, { endpointId, state: "succeeded", schemaVersion: 2 });
    await assert.rejects(readTask(root, mesh.meshId, oldTask), /Unsupported task request schemaVersion/u);
    await assert.rejects(withMeshLock(root, mesh.meshId, () => settleCompletionDeliveriesUnlocked(root, mesh.meshId, 256)), /Unsupported task request schemaVersion/u);

    const endpointKey = createHash("sha256").update(endpointId).digest("hex"); const endpoint = JSON.parse(await readFile(join(meshDirectory(root, mesh.meshId), "endpoints", `${endpointKey}.json`), "utf8")) as { bindingId: string };
    const path = completionLedgerPath(root, mesh.meshId, endpointId, "/root.jsonl", endpoint.bindingId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ schemaVersion: 3, meshId: mesh.meshId, endpointId, endpointSessionFile: "/root.jsonl", bindingId: endpoint.bindingId, batches: [], receipts: [], updatedAt: new Date().toISOString() }));
    await assert.rejects(readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl"), /Unsupported completion ledger schemaVersion/u);
    await writeFile(path, JSON.stringify({ schemaVersion: 4, meshId: mesh.meshId, endpointId, endpointSessionFile: "/root.jsonl", bindingId: endpoint.bindingId, batches: [{ batchId: randomUUID(), disposition: "event", route: "channel", channel: "A", taskIds: [oldTask], settledAt: new Date().toISOString(), eventId: randomUUID() }], receipts: [], updatedAt: new Date().toISOString() }));
    await assert.rejects(readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl"), /invalid keys/u);
}));

// Mechanical parser validation: only receipt-owning v3 retrieval tools contribute startup evidence.
void test("persisted receipt evidence accepts mesh_get and mesh_wait but ignores removed channel tools", async () => withRoot("mesh-completion-evidence-", async root => {
    const receiptId = randomUUID();
    const sessionFile = `${root}/session.jsonl`;
    const accounting = { receiptIds: [receiptId], receivedTaskIds: [], claimedTaskIds: [] };
    await writeFile(sessionFile, `${JSON.stringify({ type: "message", message: { role: "toolResult", toolCallId: "channel-call", toolName: "mesh_channel", details: { accounting } } })}\n${JSON.stringify({ type: "message", message: { role: "toolResult", toolCallId: "wait-call", toolName: "mesh_wait", details: { accounting } } })}\n`);
    assert.deepEqual(await readPersistedCompletionReceiptEvidence(sessionFile), new Map([[receiptId, [{ toolCallId: "wait-call", toolName: "mesh_wait", receivedTaskIds: [], claimedTaskIds: [] }]]]));
}));
