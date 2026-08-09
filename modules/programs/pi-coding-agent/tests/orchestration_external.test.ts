import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runExternalWorker } from "../extensions_src/orchestration_external_worker.ts";
import { readAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { buildLaunchEnvelope, settledAgentDefinition } from "../extensions_src/utilities/agent_types.ts";
import { resolveExternalDriver, validateExternalWorkerConfig, type ExternalDriver, type ExternalWorkerConfig } from "../extensions_src/utilities/orchestration_external_driver.ts";
import { resolveHarnessAdapter } from "../extensions_src/utilities/orchestration_harness.ts";
import { createTask, ensurePolicyEpoch, initializeMesh, markAgentStopping, prepareAgent, publishAgent, readAgentSnapshot, requestTaskCancellation, reserveMeshCapacity, taskPaths } from "../extensions_src/utilities/orchestration_store.ts";

const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: false, interactiveInterventions: false, terminalHistory: false };
const tmux = { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "main", windowId: "@1", paneId: "%1", windowName: "external" };
const budgets = { maxLiveAgents: 4, maxConcurrentTasks: 4, maxTasksPerMesh: 20 };
const yieldToIO = () => new Promise<void>(resolve => setImmediate(resolve));
async function eventually(predicate: () => Promise<boolean>): Promise<void> { for (let n = 0; n < 500; n += 1) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 1)); } throw new Error("condition did not settle"); }

type ExternalCase = { agent: "fast-worker" | "codex"; harness: "cursor-agent" | "codex"; config: ExternalWorkerConfig };
const cases: ExternalCase[] = [
    { agent: "fast-worker", harness: "cursor-agent", config: { adapter: "cursor-acp", command: "/cursor", cwd: "/work", permissionPolicy: "allow-always" } },
    { agent: "codex", harness: "codex", config: { adapter: "codex-acp", command: "/codex-acp", cwd: "/work", mode: "read-only", permissionPolicy: "reject", webSearch: "cached" } },
];

async function externalFixture(item: ExternalCase) {
    const root = await mkdtemp(join(tmpdir(), "orchestration-external-"));
    const definition = settledAgentDefinition(item.agent);
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: false, budgets });
    const roles = { [item.agent]: definition };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: [item.agent], roles });
    const reservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task");
    const agentId = randomUUID();
    const taskId = randomUUID();
    const envelope = buildLaunchEnvelope({ meshId: mesh.meshId, agentId, epochId: epoch.epochId, agent: item.agent, mode: "ops", roleSet: [item.agent], catalog: { schemaVersion: 1, agents: roles }, childExtensions: { [item.agent]: ["/popup", "/orchestration", "/bridge"] } });
    const prepared = await prepareAgent(root, mesh.meshId, { reservationId: reservation.reservationId, agentId, agent: item.agent, harness: item.harness, cwd: "/work", agentSnapshot: definition, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { creatorSessionId: "parent" }, capabilities });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(envelope));
    await publishAgent(root, mesh.meshId, prepared.paths, { agentId, epochId: epoch.epochId, agent: item.agent, harness: item.harness, cwd: "/work", agentSnapshot: definition, launchEnvelope: envelopePath, creatorSessionId: "parent", tmux, capabilities });
    const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: agentId, PI_MESH_AGENT_DIR: prepared.paths.directory, PI_MESH_EPOCH_ID: epoch.epochId, PI_MESH_TASK_PATH: taskPaths(root, mesh.meshId, taskId).directory, PI_AGENT_RESOLVED_AGENT: envelopePath, PI_MESH_EXTERNAL_CONFIG: JSON.stringify(item.config) };
    return { root, meshId: mesh.meshId, agentId, definition, envelope, envelopePath, prepared, env };
}

void test("external adapter routing accepts exact configs and rejects non-leaf capabilities", () => {
    const cursorConfig = validateExternalWorkerConfig(cases[0]!.config);
    const codexConfig = validateExternalWorkerConfig(cases[1]!.config);
    const cursorDefinition = settledAgentDefinition("fast-worker");
    const codexDefinition = settledAgentDefinition("codex");
    assert.equal(resolveExternalDriver(cursorConfig, cursorDefinition).display, "cursor-agent");
    assert.equal(resolveExternalDriver(codexConfig, codexDefinition).display, "codex");
    assert.throws(() => validateExternalWorkerConfig({ ...codexConfig, permissionPolicy: "allow-always" }), /permissionPolicy/u);
    assert.throws(() => resolveExternalDriver(codexConfig, cursorDefinition), /Codex launch envelope/u);
    assert.throws(() => resolveExternalDriver(cursorConfig, { ...cursorDefinition, tools: ["read"] }), /leaf-only/u);
    assert.throws(() => resolveExternalDriver(codexConfig, { ...codexDefinition, childExtensionContributions: ["/mesh-tool"] }), /leaf-only/u);
});

void test("Pi, Cursor, and Codex launches expose mesh identity without legacy launch metadata", () => {
    const meshId = "11111111-1111-4111-8111-111111111111";
    const agentId = "22222222-2222-4222-8222-222222222222";
    const epochId = "33333333-3333-4333-8333-333333333333";
    const taskPath = `/state/meshes/${meshId}/tasks/44444444-4444-4444-8444-444444444444`;
    for (const item of [{ agent: "worker" as const, harness: "pi" }, ...cases]) {
        const definition = settledAgentDefinition(item.agent);
        const envelope = buildLaunchEnvelope({ meshId, agentId, epochId, agent: item.agent, mode: "ops", roleSet: [item.agent], catalog: { schemaVersion: 1, agents: { [item.agent]: definition } }, childExtensions: { [item.agent]: ["/popup", "/orchestration", "/bridge"] } });
        const runtime = { stateRoot: "/state", harnesses: { pi: { adapter: "pi-native", command: "/pi" }, "cursor-agent": { adapter: "cursor-acp", command: "/cursor", workerCommand: "/node", workerEntrypoint: "/worker.ts" }, codex: { adapter: "codex-acp", command: "/codex-acp", workerCommand: "/node", workerEntrypoint: "/worker.ts" } } } as never;
        const resolved = resolveHarnessAdapter(runtime, item.harness, definition);
        const launch = resolved.adapter.launch(runtime, resolved.harness, { meshId, agentId, agentDirectory: `/state/meshes/${meshId}/agents/${agentId}`, agent: item.agent, taskPath, launchEnvelope: "/envelope.json", epochSnapshot: envelope, cwd: "/work" });
        assert.deepEqual({ meshId: launch.env.PI_MESH_ID, agentId: launch.env.PI_MESH_AGENT_ID, epochId: launch.env.PI_MESH_EPOCH_ID, taskPath: launch.env.PI_MESH_TASK_PATH }, { meshId, agentId, epochId, taskPath });
        assert.equal(Object.keys(launch.env).some(key => key.startsWith("PI_SUBAGENT_")), false);
        if (item.harness !== "pi") assert.equal(typeof launch.env.PI_MESH_EXTERNAL_CONFIG, "string");
    }
});

void test("external readiness rejects epoch metadata or snapshots that differ from publication", async () => {
    const metadata = await externalFixture(cases[0]!);
    let starts = 0;
    const driver: ExternalDriver = { async start() { starts += 1; }, async runTask() { return { output: "", stopReason: "end_turn" }; }, async cancel() {}, async shutdown() {}, waitForClose: () => new Promise(() => {}), fatalError: () => undefined };
    await assert.rejects(runExternalWorker({ ...metadata.env, PI_MESH_EPOCH_ID: randomUUID() }, { createDriver: () => driver, sleep: yieldToIO }), /immutable epoch snapshot/u);
    assert.equal(starts, 0);

    const snapshot = await externalFixture(cases[0]!);
    const changed = structuredClone(snapshot.envelope);
    changed.catalog["fast-worker"]!.instructions = "Changed reachable behavior.";
    changed.self.instructions = "Changed reachable behavior.";
    await writeFile(snapshot.envelopePath, JSON.stringify(changed));
    await assert.rejects(runExternalWorker(snapshot.env, { createDriver: () => driver, sleep: yieldToIO }), /settled fast-worker capability/u);
    assert.equal(starts, 0);
});

void test("Cursor and Codex workers preserve completion, cancellation, and failure lifecycle parity", async () => {
    for (const item of cases) {
        const fixture = await externalFixture(item);
        let rejectCancelled!: (error: Error) => void;
        const cancelledTurn = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
        let cancels = 0;
        const prompts: string[] = [];
        const driver: ExternalDriver = {
            async start() {},
            async runTask(prompt) { prompts.push(prompt); if (prompt.endsWith("complete")) return { output: "done", stopReason: "end_turn" }; if (prompt.endsWith("cancel")) return cancelledTurn; throw new Error("driver task failed"); },
            async cancel() { cancels += 1; },
            partialOutput: () => "partial",
            async shutdown() {},
            waitForClose: () => new Promise(() => {}),
            fatalError: () => undefined,
        };
        const worker = runExternalWorker(fixture.env, { createDriver: () => driver, sleep: yieldToIO, activityHeartbeatMs: 1 });
        await eventually(async () => { const snapshot = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId); return snapshot.status.bridgeReady && snapshot.activity.phase === "idle"; });
        const ready = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId);
        assert.deepEqual({ phase: ready.activity.phase, context: ready.activity.context.state, accepting: ready.activity.acceptingTask }, { phase: "idle", context: "unsupported", accepting: true });

        const complete = await createTask(fixture.root, fixture.meshId, fixture.agentId, "complete");
        await eventually(async () => (await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, complete.request.taskId)).task?.status.state === "succeeded");
        assert.equal((await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, complete.request.taskId)).task?.result?.output, "done");
        await eventually(async () => (await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId)).activity.acceptingTask);

        const cancel = await createTask(fixture.root, fixture.meshId, fixture.agentId, "cancel");
        await eventually(async () => (await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, cancel.request.taskId)).task?.status.state === "running");
        const runningSequence = (await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))!.sequence; await eventually(async () => ((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.sequence ?? 0) > runningSequence);
        await requestTaskCancellation(fixture.root, fixture.meshId, cancel.request.taskId, "caller cancelled");
        await eventually(async () => cancels > 0);
        rejectCancelled(new Error("cancelled"));
        await eventually(async () => (await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, cancel.request.taskId)).task?.status.state === "stopped");
        assert.equal((await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, cancel.request.taskId)).task?.result?.output, "partial");
        await eventually(async () => (await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId)).activity.acceptingTask);

        const failure = await createTask(fixture.root, fixture.meshId, fixture.agentId, "fail");
        await eventually(async () => (await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, failure.request.taskId)).task?.status.state === "failed");
        assert.match((await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, failure.request.taskId)).task?.result?.error ?? "", /driver task failed/u);

        await markAgentStopping(fixture.root, fixture.meshId, fixture.agentId);
        await worker;
        assert.equal((await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId)).status.state, "stopping");
        assert.deepEqual(prompts, ["complete", "cancel", "fail"].map(prompt => `${fixture.definition.instructions}\n\nDelegated task:\n${prompt}`));
    }
});
