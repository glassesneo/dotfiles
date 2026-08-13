import assert from "node:assert/strict";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { buildLaunchEnvelope } from "../extensions_src/utilities/agent_types.ts";
import { availableContext, publishAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { bindAgentRuntime } from "../extensions_src/utilities/orchestration_runtime.ts";
import { acknowledgeMeshEvents, bindMeshEndpoint, markMeshEventInjected, pollMeshEvents, registerMeshSignal, registerMeshWatch, setMeshEndpointOffline } from "../extensions_src/utilities/orchestration_events.ts";
import { createTask, ensurePolicyEpoch, finishTask, initializeMesh, meshPaths, patchAgentStatus, prepareAgent, publishAgent, readPolicyEpoch, reserveMeshCapacity } from "../extensions_src/utilities/orchestration_store.ts";
import { withTemporaryRoot as withRoot } from "./test_helpers.ts";

const syntheticRole = (name = "worker") => ({ description: `Synthetic ${name}`, tools: [], skillOptIns: [], instructions: "Return the bounded result.", defaultProfile: "pi-medium", contextPolicy: "project" as const, childExtensionContributions: [] });
const syntheticProfile = { model: "provider/model", thinkingLevel: "medium" as const, harness: "pi" as const };
const syntheticCatalog = (roles: Record<string, ReturnType<typeof syntheticRole>>) => ({ schemaVersion: 2 as const, roles });
const syntheticEpochInput = (mode: string, roles: Record<string, ReturnType<typeof syntheticRole>>) => ({
    mode,
    catalog: syntheticCatalog(roles),
    profiles: { schemaVersion: 1 as const, profiles: { "pi-medium": syntheticProfile } },
    callPolicy: { modes: { [mode]: { roles: Object.keys(roles) } }, roles: {} },
});

const budgets = { maxLiveAgents: 2, maxConcurrentTasks: 3, maxTasksPerMesh: 8 };
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };
const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" };

async function eventFixture(root: string) {
    const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: "/root.jsonl", recoverable: true, budgets });
    const roles = { worker: syntheticRole("worker") };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, syntheticEpochInput("ops", roles));
    const reservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task");
    const definition = roles.worker;
    const prepared = await prepareAgent(root, mesh.meshId, { reservationId: reservation.reservationId, role: "worker", selectedProfile: "pi-medium", harness: "pi", cwd: root, roleSnapshot: definition, profileSnapshot: syntheticProfile, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { creatorSessionId: "root" }, capabilities });
    const persistedEpoch = await readPolicyEpoch(root, mesh.meshId, epoch.epochId);
    const envelope = buildLaunchEnvelope({ meshId: mesh.meshId, agentId: prepared.agentId, epochId: epoch.epochId, role: "worker", snapshot: epoch, childExtensions: Object.fromEntries(persistedEpoch.roleSet.map(name => [name, ["/popup.ts", "/orchestration.ts", "/bridge.ts"]])) });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(envelope), { mode: 0o600 });
    await publishAgent(root, mesh.meshId, prepared.paths, { agentId: prepared.agentId, epochId: epoch.epochId, role: "worker", selectedProfile: "pi-medium", harness: "pi", cwd: root, roleSnapshot: definition, profileSnapshot: syntheticProfile, launchEnvelope: envelopePath, tmux, capabilities, creatorSessionId: "root" });
    await patchAgentStatus(root, mesh.meshId, prepared.agentId, { state: "idle", bridgeReady: true });
    await bindAgentRuntime(root, mesh.meshId, prepared.agentId, { runtimeId: prepared.agentId, kind: "external" }); const now = new Date().toISOString(); await publishAgentActivity(root, mesh.meshId, prepared.agentId, { runtimeId: prepared.agentId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: now, observedAt: now, heartbeatAt: now, context: availableContext(10, 100_000, 100) });
    const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile: "/root.jsonl" });
    return { mesh, agentId: prepared.agentId, endpoint };
}

void test("an any watch freezes one approved completion payload when the first watched task is terminal", async () => withRoot("mesh-watch-freeze-", async root => {
    const fixture = await eventFixture(root);
    const first = await createTask(root, fixture.mesh.meshId, fixture.agentId, "first prompt", `root:${fixture.mesh.meshId}`);
    await finishTask(root, fixture.mesh.meshId, first.request.taskId, { outcome: "succeeded", output: "secret output" });
    const second = await createTask(root, fixture.mesh.meshId, fixture.agentId, "second prompt", `root:${fixture.mesh.meshId}`);
    const route = await registerMeshWatch(root, fixture.mesh.meshId, { callerEndpointId: "agent:sender", toolCallId: "watch-any", endpoint: fixture.endpoint, delivery: "followUp", taskIds: [first.request.taskId, second.request.taskId], condition: "any", canonicalArguments: { action: "watch", receiver: "root", delivery: "followUp", taskIds: [first.request.taskId, second.request.taskId], condition: "any" } });
    assert.ok(route.eventId);
    const [event] = await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint);
    const frozen = event!.payload.tasks as Array<Record<string, unknown>>;
    assert.deepEqual(frozen.map(task => task.state), ["succeeded", "created"]);
    for (const task of frozen) assert.deepEqual(Object.keys(task).sort(), ["createdAt", "elapsedMs", ...(task.state === "succeeded" ? ["finishedAt"] : []), "state", "taskId"].sort());
    assert.equal(JSON.stringify(event!.payload).includes(fixture.agentId), false);
    assert.doesNotMatch(JSON.stringify(event!.payload), /prompt|output|error|usage/u);
    await finishTask(root, fixture.mesh.meshId, second.request.taskId, { outcome: "failed", error: "later failure" });
    const [after] = await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint);
    assert.deepEqual(after!.payload, event!.payload);
}));

void test("a pre-completion all watch creates one logical event under concurrent polling", async () => withRoot("mesh-watch-race-", async root => {
    const fixture = await eventFixture(root);
    const task = await createTask(root, fixture.mesh.meshId, fixture.agentId, "finish later", `root:${fixture.mesh.meshId}`);
    const watch = await registerMeshWatch(root, fixture.mesh.meshId, { callerEndpointId: "agent:sender", toolCallId: "watch-all", endpoint: fixture.endpoint, delivery: "steer", taskIds: [task.request.taskId], condition: "all", canonicalArguments: { action: "watch", receiver: "root", delivery: "steer", taskIds: [task.request.taskId], condition: "all" } });
    assert.equal(watch.eventId, undefined);
    assert.deepEqual(await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint), []);
    await finishTask(root, fixture.mesh.meshId, task.request.taskId, { outcome: "stopped" });
    const polls = await Promise.all([pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint), pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint)]);
    assert.equal(polls[0]?.length, 1, JSON.stringify(polls));
    assert.equal(polls[1]?.length, 1, JSON.stringify(polls));
    assert.equal(polls[0]![0]!.eventId, polls[1]![0]!.eventId);
    const eventFiles = (await readdir(meshPaths(root, fixture.mesh.meshId).events)).filter(name => !name.startsWith("retry-"));
    assert.equal(eventFiles.length, 1);
}));

void test("signal retries return one frozen event for equal arguments and reject a changed retry", async () => withRoot("mesh-signal-", async root => {
    const fixture = await eventFixture(root);
    const task = await createTask(root, fixture.mesh.meshId, fixture.agentId, "sender remains active", `root:${fixture.mesh.meshId}`);
    const canonicalArguments = { action: "signal", receiver: "root", delivery: "steer", topic: "validation", text: "Contract mismatch", taskIds: [task.request.taskId] };
    const input = { callerEndpointId: "agent:sender", toolCallId: "signal-call", endpoint: fixture.endpoint, delivery: "steer" as const, topic: "validation", text: "Contract mismatch", taskIds: [task.request.taskId], canonicalArguments };
    const first = await registerMeshSignal(root, fixture.mesh.meshId, input);
    const retry = await registerMeshSignal(root, fixture.mesh.meshId, input);
    assert.equal(retry.eventId, first.eventId);
    await assert.rejects(registerMeshSignal(root, fixture.mesh.meshId, { ...input, text: "Different", canonicalArguments: { ...canonicalArguments, text: "Different" } }), /different arguments/u);
    const [event] = await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint);
    assert.deepEqual(event!.payload, { eventId: first.eventId, topic: "validation", text: "Contract mismatch", taskIds: [task.request.taskId] });
}));

void test("polling delivers only while the durable endpoint still matches the caller session identity and remains online", async () => withRoot("mesh-endpoint-recheck-", async root => {
    const fixture = await eventFixture(root); await registerMeshSignal(root, fixture.mesh.meshId, { callerEndpointId: "agent:sender", toolCallId: "endpoint-call", endpoint: fixture.endpoint, delivery: "steer", topic: "status", text: "Ready", canonicalArguments: { action: "signal", receiver: "root", delivery: "steer", topic: "status", text: "Ready" } });
    await bindMeshEndpoint(root, fixture.mesh.meshId, { endpointId: fixture.endpoint.endpointId, kind: "root", harness: "pi", sessionId: "replacement", sessionFile: fixture.endpoint.sessionFile });
    assert.deepEqual(await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint), []);
    const replacement = await bindMeshEndpoint(root, fixture.mesh.meshId, { endpointId: fixture.endpoint.endpointId, kind: "root", harness: "pi", sessionId: "replacement", sessionFile: fixture.endpoint.sessionFile });
    assert.equal((await pollMeshEvents(root, fixture.mesh.meshId, replacement)).length, 1);
    await setMeshEndpointOffline(root, fixture.mesh.meshId, replacement.endpointId);
    assert.deepEqual(await pollMeshEvents(root, fixture.mesh.meshId, replacement), []);
}));

void test("event delivery advances pending to injected to acknowledged without timestamp churn or state regression", async () => withRoot("mesh-event-state-", async root => {
    const fixture = await eventFixture(root);
    const signal = await registerMeshSignal(root, fixture.mesh.meshId, { callerEndpointId: "agent:sender", toolCallId: "state-call", endpoint: fixture.endpoint, delivery: "followUp", topic: "status", text: "Ready", canonicalArguments: { action: "signal", receiver: "root", delivery: "followUp", topic: "status", text: "Ready" } });
    assert.equal((await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint))[0]!.state, "pending");
    await markMeshEventInjected(root, fixture.mesh.meshId, signal.eventId);
    const injected = (await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint))[0]!;
    assert.equal(injected.state, "injected");
    await markMeshEventInjected(root, fixture.mesh.meshId, signal.eventId);
    assert.equal((await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint))[0]!.injectedAt, injected.injectedAt);
    await acknowledgeMeshEvents(root, fixture.mesh.meshId, [signal.eventId, signal.eventId]);
    await markMeshEventInjected(root, fixture.mesh.meshId, signal.eventId);
    await acknowledgeMeshEvents(root, fixture.mesh.meshId, [signal.eventId]);
    assert.deepEqual(await pollMeshEvents(root, fixture.mesh.meshId, fixture.endpoint), []);
    const path = join(meshPaths(root, fixture.mesh.meshId).events, `${signal.eventId}.json`);
    const persisted = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    assert.equal(persisted.state, "acknowledged");
    assert.deepEqual(Object.keys(persisted).sort(), ["acknowledgedAt", "createdAt", "delivery", "endpointId", "endpointSessionFile", "eventId", "injectedAt", "kind", "meshId", "payload", "schemaVersion", "senderEndpointId", "state"].sort());
    assert.equal((await stat(path)).mode & 0o777, 0o600);
}));
