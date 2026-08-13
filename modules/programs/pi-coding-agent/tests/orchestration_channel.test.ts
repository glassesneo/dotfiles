import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import test from "node:test";
import { flushCompletionChannel, inspectCompletionChannels, readCompletionLedger } from "../extensions_src/utilities/orchestration_channel.ts";
import { initializeMesh, taskPaths } from "../extensions_src/utilities/orchestration_store.ts";
import { bindMeshEndpoint, setMeshEndpointOffline } from "../extensions_src/utilities/orchestration_events.ts";
import { withTemporaryRoot as withRoot } from "./test_helpers.ts";

const budgets = { maxLiveAgents: 20, maxConcurrentTasks: 20, maxTasksPerMesh: 256 };

async function persistTask(root: string, meshId: string, input: { endpointId: string; sessionFile: string; channel: "A" | "B"; state: "created" | "succeeded" | "failed" | "stopped" }) {
    const taskId = randomUUID(); const agentId = randomUUID(); const paths = taskPaths(root, meshId, taskId); const createdAt = new Date().toISOString();
    await mkdir(paths.directory, { recursive: true });
    await writeFile(paths.request, JSON.stringify({ schemaVersion: 2, meshId, agentId, taskId, prompt: "bounded", requesterEndpointId: input.endpointId, completion: { endpointId: input.endpointId, endpointSessionFile: input.sessionFile, mode: "channel", channel: input.channel }, createdAt }));
    await writeFile(paths.status, JSON.stringify({ schemaVersion: 1, meshId, agentId, taskId, state: input.state, createdAt, ...(input.state === "created" ? {} : { finishedAt: new Date().toISOString() }) }));
    return taskId;
}

void test("flush settles only the terminal subset and scopes identical channels by endpoint session", async () => withRoot("mesh-channel-flush-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: "/root.jsonl", recoverable: true, budgets });
    const endpointId = `root:${mesh.meshId}`;
    await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "root", harness: "pi", sessionId: "root", sessionFile: "/root.jsonl" });
    const terminal = await persistTask(root, mesh.meshId, { endpointId, sessionFile: "/root.jsonl", channel: "A", state: "succeeded" });
    const running = await persistTask(root, mesh.meshId, { endpointId, sessionFile: "/root.jsonl", channel: "A", state: "created" });
    await persistTask(root, mesh.meshId, { endpointId, sessionFile: "/other.jsonl", channel: "A", state: "failed" });
    assert.deepEqual((await flushCompletionChannel(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl", channel: "A", maxTasksPerMesh: 256 })).map(task => task.taskId), [terminal]);
    assert.deepEqual(await flushCompletionChannel(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl", channel: "A", maxTasksPerMesh: 256 }), []);
    const [projection] = await inspectCompletionChannels(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl", channel: "A" });
    assert.deepEqual({ ids: projection!.tasks.map(task => task.taskId), terminal: projection!.terminal, total: projection!.total }, { ids: [running], terminal: 0, total: 1 });
    const ledger = await readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl");
    assert.deepEqual(ledger!.batches.map(batch => ({ disposition: batch.disposition, taskIds: batch.taskIds })), [{ disposition: "flush", taskIds: [terminal] }]);
}));

// Given a terminal channel task whose caller binding goes offline, flush observes rejection and no delivery-ledger mutation.
void test("offline channel flush has zero settlement mutation", async () => withRoot("mesh-channel-stale-flush-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: "/root.jsonl", recoverable: true, budgets });
    const endpointId = `root:${mesh.meshId}`;
    const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "root", harness: "pi", sessionId: "root", sessionFile: "/root.jsonl" });
    await persistTask(root, mesh.meshId, { endpointId, sessionFile: endpoint.sessionFile, channel: "A", state: "succeeded" });
    await setMeshEndpointOffline(root, mesh.meshId, endpointId, endpoint);
    await assert.rejects(flushCompletionChannel(root, mesh.meshId, { endpointId, endpointSessionFile: endpoint.sessionFile, channel: "A", maxTasksPerMesh: 256 }), /stale or offline/u);
    assert.equal(await readCompletionLedger(root, mesh.meshId, endpointId, endpoint.sessionFile), undefined);
}));

void test("historical v2 task requests without completion remain outside notification ledgers", async () => withRoot("mesh-channel-history-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: "/root.jsonl", recoverable: true, budgets });
    const endpointId = `root:${mesh.meshId}`; const taskId = randomUUID(); const agentId = randomUUID(); const paths = taskPaths(root, mesh.meshId, taskId); const createdAt = new Date().toISOString();
    await mkdir(paths.directory, { recursive: true });
    await writeFile(paths.request, JSON.stringify({ schemaVersion: 2, meshId: mesh.meshId, agentId, taskId, prompt: "historical", requesterEndpointId: endpointId, createdAt }));
    await writeFile(paths.status, JSON.stringify({ schemaVersion: 1, meshId: mesh.meshId, agentId, taskId, state: "succeeded", createdAt, finishedAt: createdAt }));
    assert.deepEqual(await inspectCompletionChannels(root, mesh.meshId, { endpointId, endpointSessionFile: "/root.jsonl" }), []);
    assert.equal(await readCompletionLedger(root, mesh.meshId, endpointId, "/root.jsonl"), undefined);
}));
