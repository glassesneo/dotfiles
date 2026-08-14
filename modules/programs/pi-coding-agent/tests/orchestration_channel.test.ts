import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";
import { completionLedgerPath, createCompletionReceipt, flushCompletionChannelWithReceipt, inspectCompletionChannels, readCompletionLedger, reconcileCompletionReceipts, rollbackCompletionReceipt, settleCompletionDeliveriesUnlocked } from "../extensions_src/utilities/orchestration_channel.ts";
import { initializeMesh, readPersistedCompletionReceiptEvidence, taskPaths } from "../extensions_src/utilities/orchestration_store.ts";
import { bindMeshEndpoint, setMeshEndpointOffline } from "../extensions_src/utilities/orchestration_events.ts";
import { withMeshLock } from "../extensions_src/utilities/orchestration_lock.ts";
import { withTemporaryRoot as withRoot } from "./test_helpers.ts";

const budgets = { maxLiveAgents: 20, maxConcurrentTasks: 20, maxTasksPerMesh: 256 };
type TaskState = "created" | "succeeded" | "failed" | "stopped";

async function fixture(root: string) {
    const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: "/root.jsonl", recoverable: true, budgets });
    const endpointId = `root:${mesh.meshId}`;
    const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "root", harness: "pi", sessionId: "root", sessionFile: "/root.jsonl" });
    return { mesh, endpointId, endpoint };
}

async function persistTask(root: string, meshId: string, input: { endpointId: string; sessionFile?: string; channel?: "A" | "B"; state: TaskState; createdAt?: string }) {
    const taskId = randomUUID();
    const agentId = randomUUID();
    const paths = taskPaths(root, meshId, taskId);
    const createdAt = input.createdAt ?? new Date().toISOString();
    const completion = input.channel
        ? { endpointId: input.endpointId, endpointSessionFile: input.sessionFile ?? "/root.jsonl", mode: "channel", channel: input.channel }
        : { endpointId: input.endpointId, endpointSessionFile: input.sessionFile ?? "/root.jsonl", mode: "direct" };
    await mkdir(paths.directory, { recursive: true });
    await writeFile(paths.request, JSON.stringify({ schemaVersion: 2, meshId, agentId, taskId, prompt: "bounded", requesterEndpointId: input.endpointId, completion, createdAt }));
    await writeFile(paths.status, JSON.stringify({ schemaVersion: 1, meshId, agentId, taskId, state: input.state, createdAt, ...(input.state === "created" ? {} : { finishedAt: new Date().toISOString() }) }));
    return taskId;
}

function receiptInput(endpointId: string, taskIds: string[], overrides: Partial<Parameters<typeof createCompletionReceipt>[2]> = {}): Parameters<typeof createCompletionReceipt>[2] {
    return {
        endpointId,
        endpointSessionFile: "/root.jsonl",
        claimantSessionFile: "/root.jsonl",
        toolCallId: "get-call",
        toolName: "mesh_get",
        canonicalArguments: { taskIds },
        taskIds,
        maxTasksPerMesh: 256,
        ...overrides,
    };
}

// Given a v1 assignment ledger, receipt mutation preserves the assignment, upgrades the file to v2, and removes only received tasks from channel retrieval.
void test("v1 assignment normalizes on read and upgrades on receipt while assigned tasks remain retrievable", async () => withRoot("mesh-channel-v1-", async root => {
    const { mesh, endpointId } = await fixture(root);
    const assigned = await persistTask(root, mesh.meshId, { endpointId, channel: "A", state: "succeeded" });
    const running = await persistTask(root, mesh.meshId, { endpointId, channel: "A", state: "created" });
    const path = completionLedgerPath(root, mesh.meshId, endpointId, "/root.jsonl");
    const v1 = { schemaVersion: 1, meshId: mesh.meshId, endpointId, endpointSessionFile: "/root.jsonl", batches: [{ batchId: randomUUID(), disposition: "event", route: "channel", channel: "A", taskIds: [assigned], settledAt: new Date().toISOString(), eventId: randomUUID() }], updatedAt: new Date().toISOString() };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(v1));

    assert.equal((await readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl"))!.schemaVersion, 2);
    assert.equal((JSON.parse(await readFile(path, "utf8")) as { schemaVersion: number }).schemaVersion, 1);
    const before = (await inspectCompletionChannels(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl", channel: "A" }))[0]!;
    assert.deepEqual(before.tasks.map(task => task.taskId).sort(), [assigned, running].sort());

    const flushed = await flushCompletionChannelWithReceipt(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl", claimantSessionFile: "/root.jsonl", toolCallId: "flush-v1", canonicalArguments: { action: "flush", channel: "A" }, channel: "A", maxTasksPerMesh: 1 });
    assert.deepEqual(flushed.tasks.map(task => task.taskId), [assigned]);
    assert.deepEqual(flushed.receivedTaskIds, [assigned]);
    const ledger = await readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl");
    assert.equal(ledger!.schemaVersion, 2);
    assert.deepEqual(ledger!.batches[0]!.taskIds, [assigned]);
    assert.deepEqual(ledger!.receipts[0]!.taskIds, [assigned]);
    assert.deepEqual((await inspectCompletionChannels(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl", channel: "A" }))[0]!.tasks.map(task => task.taskId), [running]);
    const distinct = await persistTask(root, mesh.meshId, { endpointId, channel: "A", state: "succeeded" });
    await assert.rejects(createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [distinct], { toolCallId: "over-budget", maxTasksPerMesh: 1 })), /task budget/u);
    assert.deepEqual((await readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl"))!.receipts.flatMap(receipt => receipt.taskIds), [assigned]);
}));

// Given terminal tasks and canonical tool arguments, retries return the original receipt, changed arguments reject, and concurrent calls newly receive each task at most once.
void test("receipt creation is canonical-argument idempotent and task-level at-most-once", async () => withRoot("mesh-channel-receipt-", async root => {
    const { mesh, endpointId } = await fixture(root);
    const firstTask = await persistTask(root, mesh.meshId, { endpointId, channel: "A", state: "succeeded" });
    const secondTask = await persistTask(root, mesh.meshId, { endpointId, channel: "A", state: "failed" });
    const first = await createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [firstTask], { canonicalArguments: { debug: false, taskId: firstTask } }));
    const retry = await createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [firstTask], { canonicalArguments: { taskId: firstTask, debug: false } }));
    assert.equal(first.created, true);
    assert.deepEqual(retry, { receipt: first.receipt, created: false, receivedTaskIds: [] });
    await assert.rejects(createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [firstTask], { canonicalArguments: { taskId: firstTask, debug: true } })), /different arguments/u);

    const raced = await Promise.all([
        createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [secondTask], { toolCallId: "race-a" })),
        createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [secondTask], { toolCallId: "race-b" })),
    ]);
    assert.equal(raced.filter(result => result.created).length, 1);
    assert.deepEqual(raced.flatMap(result => result.receivedTaskIds), [secondTask]);
    const ledger = await readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl");
    assert.deepEqual(new Set(ledger!.receipts.flatMap(receipt => receipt.taskIds)), new Set([firstTask, secondTask]));
}));

// Given received and unreceived tasks in one terminal channel cohort, event settlement excludes the receipt but keeps the batch-assigned remainder retrievable.
void test("event assignment and retrieval use distinct projections", async () => withRoot("mesh-channel-projections-", async root => {
    const { mesh, endpointId } = await fixture(root);
    const received = await persistTask(root, mesh.meshId, { endpointId, channel: "A", state: "succeeded", createdAt: "2026-08-14T00:00:00.000Z" });
    const pendingRetrieval = await persistTask(root, mesh.meshId, { endpointId, channel: "A", state: "failed", createdAt: "2026-08-14T00:00:01.000Z" });
    await createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [received]));
    await withMeshLock(root, mesh.meshId, () => settleCompletionDeliveriesUnlocked(root, mesh.meshId, 256));
    const ledger = await readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl");
    assert.deepEqual(ledger!.batches.map(batch => batch.taskIds), [[pendingRetrieval]]);
    assert.deepEqual(ledger!.receipts.map(receipt => receipt.taskIds), [[received]]);
    assert.deepEqual((await inspectCompletionChannels(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl", channel: "A" }))[0]!.tasks.map(task => task.taskId), [pendingRetrieval]);
}));

// Given persisted mesh tool accounting, startup recovery accepts complete receipt evidence, ignores unrelated accounting, and rejects malformed evidence visibly.
void test("persisted receipt evidence is parsed strictly for mesh retrieval tools", async () => withRoot("mesh-channel-session-evidence-", async root => {
    const sessionFile = `${root}/session.jsonl`; const receiptId = randomUUID(); const lines: any[] = [{ type: "message", message: { role: "toolResult", toolName: "other", details: { accounting: "unrelated" } } }, { type: "message", message: { role: "toolResult", toolCallId: "wait-call", toolName: "mesh_wait", details: { accounting: { receiptIds: [receiptId], receivedTaskIds: [], claimedTaskIds: [] } } } }]; await writeFile(sessionFile, `${lines.map(line => JSON.stringify(line)).join("\n")}\n`); assert.deepEqual(await readPersistedCompletionReceiptEvidence(sessionFile), new Map([[receiptId, [{ toolCallId: "wait-call", toolName: "mesh_wait", receivedTaskIds: [], claimedTaskIds: [] }]]])); delete lines[1].message.details.accounting.receivedTaskIds; await writeFile(sessionFile, `${lines.map(line => JSON.stringify(line)).join("\n")}\n`); await assert.rejects(readPersistedCompletionReceiptEvidence(sessionFile), /Malformed completion receipt accounting/u);
}));

// Given a provisional receipt, rollback and startup reconciliation restore only receipts lacking persisted tool-result evidence.
void test("receipt rollback and reconciliation restore orphaned tasks without removing persisted receipts", async () => withRoot("mesh-channel-recovery-", async root => {
    const { mesh, endpointId } = await fixture(root);
    const rollbackTask = await persistTask(root, mesh.meshId, { endpointId, channel: "A", state: "succeeded" });
    const orphanTask = await persistTask(root, mesh.meshId, { endpointId, channel: "A", state: "failed" });
    const retainedTask = await persistTask(root, mesh.meshId, { endpointId, channel: "A", state: "stopped" });
    const provisional = await createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [rollbackTask], { toolCallId: "rollback" }));
    assert.equal(await rollbackCompletionReceipt(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl", receiptId: provisional.receipt!.receiptId }), true);
    assert.equal(await rollbackCompletionReceipt(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl", receiptId: provisional.receipt!.receiptId }), false);

    const orphan = await createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [orphanTask], { toolCallId: "orphan" }));
    const retained = await createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [retainedTask], { toolCallId: "retained" }));
    const repaired = await reconcileCompletionReceipts(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl", claimantSessionFile: "/root.jsonl", persistedReceipts: new Map([[retained.receipt!.receiptId, [{ toolCallId: "retained", toolName: "mesh_get", receivedTaskIds: [], claimedTaskIds: [] }]]]) });
    assert.deepEqual(repaired.removedReceiptIds, [orphan.receipt!.receiptId]);
    const projection = (await inspectCompletionChannels(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl", channel: "A" }))[0]!;
    assert.deepEqual(new Set(projection.tasks.map(task => task.taskId)), new Set([rollbackTask, orphanTask]));
    assert.deepEqual((await readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl"))!.receipts.map(receipt => receipt.taskIds), [[retainedTask]]);
}));

// Given more than one flush chunk plus unrelated tasks, each mutation returns the oldest bounded terminal slice and leaves the remainder inspectable.
void test("flush receipts the oldest 16 unreceived terminal tasks per channel", async () => withRoot("mesh-channel-chunks-", async root => {
    const { mesh, endpointId } = await fixture(root);
    const ordered: string[] = [];
    for (let index = 0; index < 17; index += 1) ordered.push(await persistTask(root, mesh.meshId, { endpointId, channel: "A", state: "succeeded", createdAt: `2026-08-14T00:00:${String(index).padStart(2, "0")}.000Z` }));
    const running = await persistTask(root, mesh.meshId, { endpointId, channel: "A", state: "created", createdAt: "2026-08-14T00:01:00.000Z" });
    const other = await persistTask(root, mesh.meshId, { endpointId, channel: "B", state: "failed", createdAt: "2026-08-14T00:01:01.000Z" });

    const firstInput = { endpointId, endpointSessionFile: "/root.jsonl", claimantSessionFile: "/root.jsonl", toolCallId: "flush-1", canonicalArguments: { action: "flush", channel: "A" }, channel: "A" as const, maxTasksPerMesh: 256 };
    const first = await flushCompletionChannelWithReceipt(root, mesh.meshId, firstInput);
    const retry = await flushCompletionChannelWithReceipt(root, mesh.meshId, firstInput);
    const second = await flushCompletionChannelWithReceipt(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl", claimantSessionFile: "/root.jsonl", toolCallId: "flush-2", canonicalArguments: { action: "flush", channel: "A" }, channel: "A", maxTasksPerMesh: 256 });
    assert.deepEqual(first.tasks.map(task => task.taskId), ordered.slice(0, 16));
    assert.deepEqual({ ids: retry.tasks.map(task => task.taskId), created: retry.created, receivedTaskIds: retry.receivedTaskIds }, { ids: ordered.slice(0, 16), created: false, receivedTaskIds: [] });
    assert.deepEqual(second.tasks.map(task => task.taskId), ordered.slice(16));
    const channelA = (await inspectCompletionChannels(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl", channel: "A" }))[0]!;
    const channelB = (await inspectCompletionChannels(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl", channel: "B" }))[0]!;
    assert.deepEqual(channelA.tasks.map(task => task.taskId), [running]);
    assert.deepEqual(channelB.tasks.map(task => task.taskId), [other]);
    assert.deepEqual((await readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl"))!.batches, []);
}));

// Given nonterminal or stale-binding targets, receipt attempts reject before mutating retrieval state.
void test("receipt creation revalidates terminal state and the live endpoint binding", async () => withRoot("mesh-channel-revalidation-", async root => {
    const { mesh, endpointId, endpoint } = await fixture(root);
    const running = await persistTask(root, mesh.meshId, { endpointId, channel: "A", state: "created" });
    await assert.rejects(createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [running])), /not terminal/u);
    const terminal = await persistTask(root, mesh.meshId, { endpointId, channel: "A", state: "succeeded" });
    await setMeshEndpointOffline(root, mesh.meshId, endpointId, endpoint);
    await assert.rejects(createCompletionReceipt(root, mesh.meshId, receiptInput(endpointId, [terminal])), /stale or offline/u);
    assert.equal(await readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl"), undefined);
}));

void test("historical v2 task requests without completion remain outside notification ledgers", async () => withRoot("mesh-channel-history-", async root => {
    const { mesh, endpointId } = await fixture(root);
    const taskId = randomUUID(); const agentId = randomUUID(); const paths = taskPaths(root, mesh.meshId, taskId); const createdAt = new Date().toISOString();
    await mkdir(paths.directory, { recursive: true });
    await writeFile(paths.request, JSON.stringify({ schemaVersion: 2, meshId: mesh.meshId, agentId, taskId, prompt: "historical", requesterEndpointId: endpointId, createdAt }));
    await writeFile(paths.status, JSON.stringify({ schemaVersion: 1, meshId: mesh.meshId, agentId, taskId, state: "succeeded", createdAt, finishedAt: createdAt }));
    assert.deepEqual(await inspectCompletionChannels(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl" }), []);
    assert.equal(await readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl"), undefined);
}));
