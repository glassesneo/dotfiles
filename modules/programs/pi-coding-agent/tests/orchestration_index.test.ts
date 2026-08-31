import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bindMeshEndpoint, registerMeshSignal } from "../extensions_src/utilities/orchestration_events.ts";
import { collectRetiredOrchestrationIndexReferences, endpointBindingInboxDirectory, endpointInboxKey, indexEventCreation, indexTaskSubmission, indexTerminalTransition, orchestrationIndexPath, readCompletionQueueReferences, reconcileOrchestrationIndexes, rootCompletionQueueDirectory, validateOrchestrationIndexReference, workerTaskInboxDirectory } from "../extensions_src/utilities/orchestration_index.ts";
import { initializeMesh, meshPaths, taskPaths } from "../extensions_src/utilities/orchestration_store.ts";
import { withTemporaryRoot as withRoot } from "./test_helpers.ts";

const budgets = { maxLiveAgents: 4, maxConcurrentTasks: 4, maxTasksPerMesh: 16 };
const createdAt = "2026-08-20T00:00:00.000Z";
const queuedAt = "2026-08-20T00:01:00.000Z";
function target(bindingId = randomUUID()) { return { endpointId: "root:synthetic", endpointSessionFile: "/root.jsonl", bindingId }; }
async function json(path: string): Promise<Record<string, unknown>> { return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>; }
async function authoritativeTask(root: string, meshId: string, input: { taskId: string; agentId: string; state: "created" | "running" | "succeeded"; completion: { endpointId: string; endpointSessionFile: string; bindingId: string } }) {
    const paths = taskPaths(root, meshId, input.taskId); await mkdir(paths.directory, { recursive: true });
    await writeFile(paths.request, JSON.stringify({ schemaVersion: 3, meshId, agentId: input.agentId, taskId: input.taskId, prompt: "bounded", requesterEndpointId: input.completion.endpointId, completion: input.completion, createdAt }));
    await writeFile(paths.status, JSON.stringify({ schemaVersion: 1, meshId, agentId: input.agentId, taskId: input.taskId, state: input.state, createdAt, ...(input.state === "succeeded" ? { finishedAt: queuedAt } : {}) }));
}

// Admission: index records are a durable machine protocol; types cannot enforce exact JSON keys, path placement, or endpoint-only hashing on disk.
// Given stable task, endpoint, and binding identities, when writers cross the index persistence boundary, watchers observe the approved layout and exact reference schema.
void test("index layout uses endpoint-only hash, binding directories, and queued completion records", async () => withRoot("mesh-index-layout-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const agentId = randomUUID(); const taskId = randomUUID(); const queuedTaskId = randomUUID(); const eventId = randomUUID(); const first = target(); const second = target();
    await indexTaskSubmission(root, mesh.meshId, { agentId, taskId, createdAt, completion: first }); await indexTerminalTransition(root, mesh.meshId, { agentId, taskId: queuedTaskId, queuedAt, completion: first }); await indexEventCreation(root, mesh.meshId, { ...first, eventId, createdAt });
    const endpointKey = createHash("sha256").update(first.endpointId).digest("hex");
    const inbox = orchestrationIndexPath(root, mesh.meshId, "agent-task-inbox", { agentId, taskId }); const completion = orchestrationIndexPath(root, mesh.meshId, "completion-queue", { ...first, taskId: queuedTaskId }); const endpointTask = orchestrationIndexPath(root, mesh.meshId, "endpoint-tasks", { ...first, taskId }); const event = orchestrationIndexPath(root, mesh.meshId, "endpoint-events", { ...first, eventId });
    assert.equal(endpointInboxKey(first.endpointId), endpointKey);
    assert.equal(inbox, join(meshPaths(root, mesh.meshId).agents, agentId, "task-inbox", `${taskId}.json`));
    assert.equal(completion, join(meshPaths(root, mesh.meshId).directory, "completion-queue", `${queuedTaskId}.json`));
    assert.equal(endpointTask, join(meshPaths(root, mesh.meshId).directory, "endpoint-inboxes", endpointKey, first.bindingId, "tasks", `${taskId}.json`));
    assert.equal(event, join(meshPaths(root, mesh.meshId).directory, "endpoint-inboxes", endpointKey, first.bindingId, "events", `${eventId}.json`));
    assert.equal(workerTaskInboxDirectory(root, mesh.meshId, agentId), join(meshPaths(root, mesh.meshId).agents, agentId, "task-inbox"));
    assert.equal(rootCompletionQueueDirectory(root, mesh.meshId), join(meshPaths(root, mesh.meshId).directory, "completion-queue"));
    assert.equal(endpointBindingInboxDirectory(root, mesh.meshId, first), join(meshPaths(root, mesh.meshId).directory, "endpoint-inboxes", endpointKey, first.bindingId));
    assert.equal(endpointBindingInboxDirectory(root, mesh.meshId, second).split("/").at(-2), endpointKey);
    assert.notEqual(endpointBindingInboxDirectory(root, mesh.meshId, first), endpointBindingInboxDirectory(root, mesh.meshId, second));
    assert.deepEqual(Object.keys(await json(completion)).sort(), ["agentId", "bindingId", "endpointId", "endpointSessionFile", "meshId", "queuedAt", "schemaVersion", "taskId"]);
    assert.equal((await json(completion)).queuedAt, queuedAt);
    await assert.rejects(async () => validateOrchestrationIndexReference("completion-queue", { ...(await json(completion)), createdAt }, { meshId: mesh.meshId, ...first, agentId, taskId: queuedTaskId }), /invalid keys/u);
}));

// Admission: queue order is consumer-visible settlement input; types do not guarantee that a flat on-disk queue is ordered by its queue timestamp.
// Given queued completions with opposite task-ID and queue-time order, when the root reads the queue, settlement observes queuedAt order with taskId as the deterministic tie-breaker.
void test("completion queue reads order by queuedAt then taskId", async () => withRoot("mesh-index-order-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const agentId = randomUUID(); const first = randomUUID(); const second = randomUUID(); const completion = target();
    await indexTerminalTransition(root, mesh.meshId, { agentId, taskId: first, queuedAt: "2026-08-20T00:02:00.000Z", completion }); await indexTerminalTransition(root, mesh.meshId, { agentId, taskId: second, queuedAt: "2026-08-20T00:01:00.000Z", completion });
    assert.deepEqual((await readCompletionQueueReferences(root, mesh.meshId)).map(reference => reference.taskId), [second, first]);
}));

// Admission: reconciliation owns recovery after index-first crashes and retirement of evidence that cannot route to a current endpoint binding.
// Given authoritative records, malformed or misplaced references, a replaced endpoint binding, and absent index-first records, when reconciliation runs, consumers retain recoverable work while invalid and retired-binding evidence disappears.
void test("reconciliation rebuilds all classes, removes invalid evidence, and preserves crash references", async () => withRoot("mesh-index-reconcile-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: "root:synthetic", kind: "root", harness: "pi", sessionId: "root", sessionFile: "/root.jsonl" }); const completion = { endpointId: endpoint.endpointId, endpointSessionFile: endpoint.sessionFile, bindingId: endpoint.bindingId }; const agentId = randomUUID(); const createdTask = randomUUID(); const terminalTask = randomUUID(); const eventId = randomUUID(); const crashTask = randomUUID(); const crashTerminal = randomUUID(); const crashEvent = randomUUID();
    await authoritativeTask(root, mesh.meshId, { taskId: createdTask, agentId, state: "created", completion }); await authoritativeTask(root, mesh.meshId, { taskId: terminalTask, agentId, state: "succeeded", completion });
    await writeFile(join(meshPaths(root, mesh.meshId).events, `${eventId}.json`), JSON.stringify({ schemaVersion: 1, meshId: mesh.meshId, eventId, endpointId: completion.endpointId, endpointSessionFile: completion.endpointSessionFile, endpointBindingId: completion.bindingId, senderEndpointId: completion.endpointId, delivery: "steer", state: "pending", kind: "signal", payload: {}, createdAt }));
    await indexTaskSubmission(root, mesh.meshId, { agentId, taskId: crashTask, createdAt, completion }); await indexTerminalTransition(root, mesh.meshId, { agentId, taskId: crashTerminal, queuedAt, completion }); await indexEventCreation(root, mesh.meshId, { ...completion, eventId: crashEvent, createdAt });
    const malformed = join(rootCompletionQueueDirectory(root, mesh.meshId), `${randomUUID()}.json`); await writeFile(malformed, "{}");
    const misplacedEvent = randomUUID(); const misplaced = join(meshPaths(root, mesh.meshId).directory, "endpoint-inboxes", createHash("sha256").update("wrong:endpoint").digest("hex"), completion.bindingId, "events", `${misplacedEvent}.json`); await mkdir(join(misplaced, ".."), { recursive: true }); await writeFile(misplaced, JSON.stringify({ schemaVersion: 1, meshId: mesh.meshId, ...completion, eventId: misplacedEvent, createdAt }));
    const old = await bindMeshEndpoint(root, mesh.meshId, { endpointId: "root:old", kind: "root", harness: "pi", sessionId: "old", sessionFile: "/old.jsonl" }); await indexEventCreation(root, mesh.meshId, { endpointId: old.endpointId, endpointSessionFile: old.sessionFile, bindingId: old.bindingId, eventId: randomUUID(), createdAt }); const replacement = await bindMeshEndpoint(root, mesh.meshId, { endpointId: old.endpointId, kind: "root", harness: "pi", sessionId: "replacement", sessionFile: "/replacement.jsonl" });
    await reconcileOrchestrationIndexes(root, mesh.meshId);
    for (const [kind, identity] of [["agent-task-inbox", { agentId, taskId: createdTask }], ["endpoint-tasks", { ...completion, taskId: createdTask }], ["completion-queue", { ...completion, taskId: terminalTask }], ["endpoint-events", { ...completion, eventId }], ["agent-task-inbox", { agentId, taskId: crashTask }], ["completion-queue", { ...completion, taskId: crashTerminal }], ["endpoint-events", { ...completion, eventId: crashEvent }]] as const) await access(orchestrationIndexPath(root, mesh.meshId, kind, identity));
    assert.equal((await json(orchestrationIndexPath(root, mesh.meshId, "completion-queue", { ...completion, taskId: terminalTask }))).queuedAt, queuedAt);
    await assert.rejects(access(malformed), error => (error as NodeJS.ErrnoException).code === "ENOENT");
    await assert.rejects(access(misplaced), error => (error as NodeJS.ErrnoException).code === "ENOENT");
    await assert.rejects(access(endpointBindingInboxDirectory(root, mesh.meshId, { endpointId: old.endpointId, endpointSessionFile: old.sessionFile, bindingId: old.bindingId })), error => (error as NodeJS.ErrnoException).code === "ENOENT");
    assert.notEqual(replacement.bindingId, old.bindingId);
}));

// Admission: cleanup is an authoritative-retirement contract; deleting merely dangling references would turn crash recovery into task/event loss.
// Given retired authoritative records plus one dangling index-first reference, when index GC runs, only retired references disappear and dangling work remains retryable.
void test("index GC removes authoritative retirements and retains dangling crash references", async () => withRoot("mesh-index-gc-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const completion = target(); const agentId = randomUUID(); const taskId = randomUUID(); const eventId = randomUUID(); const dangling = randomUUID();
    await indexTaskSubmission(root, mesh.meshId, { agentId, taskId, createdAt, completion }); await indexTerminalTransition(root, mesh.meshId, { agentId, taskId, queuedAt, completion }); await indexEventCreation(root, mesh.meshId, { ...completion, eventId, createdAt }); await indexTaskSubmission(root, mesh.meshId, { agentId, taskId: dangling, createdAt, completion });
    await authoritativeTask(root, mesh.meshId, { taskId, agentId, state: "succeeded", completion }); const eventPath = join(meshPaths(root, mesh.meshId).events, `${eventId}.json`); await writeFile(eventPath, JSON.stringify({ schemaVersion: 1, meshId: mesh.meshId, eventId, endpointId: completion.endpointId, endpointSessionFile: completion.endpointSessionFile, endpointBindingId: completion.bindingId, senderEndpointId: completion.endpointId, delivery: "steer", state: "acknowledged", kind: "signal", payload: {}, createdAt }));
    const ledger = join(meshPaths(root, mesh.meshId).deliveries, `${"a".repeat(64)}.json`); await mkdir(join(ledger, ".."), { recursive: true }); await writeFile(ledger, JSON.stringify({ batches: [{ taskIds: [taskId] }], receipts: [] }));
    assert.equal(await collectRetiredOrchestrationIndexReferences(root, mesh.meshId), 4);
    assert.equal((await json(orchestrationIndexPath(root, mesh.meshId, "agent-task-inbox", { agentId, taskId: dangling }))).taskId, dangling);
}));

// Admission: event idempotency must survive the interval after its stable index reference but before the authoritative event file.
// Given a signal interrupted after index persistence, when the same tool call retries, the receiver observes the originally reserved event ID exactly once.
void test("event creation retry repairs its index-first crash point", async () => withRoot("mesh-event-index-crash-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile: "/root.jsonl" }); const input = { callerEndpointId: endpoint.endpointId, toolCallId: "signal-crash", endpoint, delivery: "steer" as const, topic: "bounded", text: "ready", canonicalArguments: { topic: "bounded", text: "ready" } };
    await assert.rejects(registerMeshSignal(root, mesh.meshId, { ...input, afterEventIndexPersisted: () => { throw new Error("event index crash"); } }), /event index crash/u);
    const [reference] = await readdir(join(endpointBindingInboxDirectory(root, mesh.meshId, { endpointId: endpoint.endpointId, endpointSessionFile: endpoint.sessionFile, bindingId: endpoint.bindingId }), "events")); const reservedId = reference!.replace(/\.json$/u, "");
    assert.deepEqual(await registerMeshSignal(root, mesh.meshId, input), { eventId: reservedId }); assert.equal((await readdir(meshPaths(root, mesh.meshId).events)).filter(name => name === `${reservedId}.json`).length, 1);
}));
