import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { externalTaskPrompt, runExternalWorker } from "../extensions_src/orchestration_external_worker.ts";
import { buildLaunchEnvelope, type AgentLaunchEnvelope, type CallerPolicy, type RoleDefinition } from "../extensions_src/utilities/agent_types.ts";
import type { ExecutionProfile, ExecutionProfileConfig } from "../extensions_src/utilities/mode_types.ts";
import { readAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { resolveExternalDriver, validateExternalWorkerConfig, type ExternalDriver, type ExternalWorkerConfig } from "../extensions_src/utilities/orchestration_external_driver.ts";
import { resolveHarnessAdapter } from "../extensions_src/utilities/orchestration_harness.ts";
import { MESH_PEER_TOOL_NAMES, piLaunchDescriptor } from "../extensions_src/utilities/orchestration_pi.ts";
import { createTask, ensurePolicyEpoch, initializeMesh, markAgentStopping, prepareAgent, publishAgent, readAgentSnapshot, requestTaskCancellation, reserveMeshCapacity, taskPaths } from "../extensions_src/utilities/orchestration_store.ts";
import { withTemporaryRoot, yieldToIO } from "./test_helpers.ts";

const meshId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const epochId = "33333333-3333-4333-8333-333333333333";
const runtime = { stateRoot: "/state", harnesses: { pi: { adapter: "pi-native", command: "/pi" }, "cursor-agent": { adapter: "cursor-acp", command: "/cursor", workerCommand: "/node", workerEntrypoint: "/worker.ts" }, codex: { adapter: "codex-acp", command: "/codex-acp", workerCommand: "/node", workerEntrypoint: "/worker.ts" } } } as never;

function role(overrides: Partial<RoleDefinition> = {}): RoleDefinition {
    return { description: "purpose", tools: [], instructions: "Own this purpose.", defaultProfile: "sol-medium", contextPolicy: "project", childExtensionContributions: [], ...overrides };
}
function envelope(input: { role: string; selfRole: RoleDefinition; selectedProfile: string; executionProfile: ExecutionProfile; policy?: CallerPolicy; extensions?: string[] }): AgentLaunchEnvelope {
    return {
        schemaVersion: 3,
        marker: "pi-mesh-role-launch-v3",
        meshId,
        agentId,
        epochId,
        role: input.role,
        selectedProfile: input.selectedProfile,
        selfRole: input.selfRole,
        executionProfile: input.executionProfile,
        roles: { [input.role]: input.selfRole },
        profiles: { [input.selectedProfile]: input.executionProfile },
        policies: { [input.role]: input.policy ?? { roles: [], profiles: [] } },
        policyDigest: "0".repeat(64),
        childExtensions: { [input.role]: input.extensions ?? ["/popup.ts", "/orchestration.ts", "/role-contribution.ts", "/orchestration_child_bridge.ts"] },
    } as unknown as AgentLaunchEnvelope;
}
function launchInput(roleName: string, snapshot: AgentLaunchEnvelope) {
    return { meshId, agentId, agentDirectory: `/state/meshes/${meshId}/agents/${agentId}`, role: roleName, taskPath: `/state/meshes/${meshId}/tasks/task`, launchEnvelope: "/envelope.json", epochSnapshot: snapshot, cwd: "/work" };
}
function option(args: string[], name: string): string | undefined { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; }
function extensions(args: string[]): string[] { return args.filter((_value, index) => args[index - 1] === "-e"); }
async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await Promise.resolve(check()).catch(() => false)) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail("Timed out waiting for external worker state");
}

const externalCapabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: false, interactiveInterventions: false, terminalHistory: false };
const externalTmux = { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "main", windowId: "@1", paneId: "%1", windowName: "worker" };
const externalBudgets = { maxLiveAgents: 4, maxConcurrentTasks: 4, maxTasksPerMesh: 20 };
const cursorProfile: ExecutionProfile = { model: "cursor/cursor-grok-4.5-high-fast", harness: "cursor-agent", harnessOptions: { mode: "agent", permissionPolicy: "allow-always", sandbox: "disabled", trustWorkspace: true, worktree: false } };
const externalConfig: ExternalWorkerConfig = { adapter: "cursor-acp", command: "/cursor", cwd: "/work", permissionPolicy: "allow-always" };

async function externalFixture(root: string) {
    const workerRole = role({ instructions: "Complete the bounded worker objective.", defaultProfile: "sol-medium", tools: ["read", "write"] });
    const profileConfig: ExecutionProfileConfig = { schemaVersion: 1, profiles: { "sol-medium": { model: "openai-codex/gpt-5.6-sol", thinkingLevel: "medium", harness: "pi" }, "cursor-fast": cursorProfile } };
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: false, budgets: externalBudgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", catalog: { schemaVersion: 3, roles: { worker: workerRole } }, profiles: profileConfig, callPolicy: { modes: { ops: { roles: ["worker"] } }, roles: { worker: { roles: [], profiles: ["cursor-fast"] } } } });
    const reservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task");
    const prepared = await prepareAgent(root, mesh.meshId, { reservationId: reservation.reservationId, role: "worker", selectedProfile: "cursor-fast", harness: "cursor-agent", cwd: "/work", roleSnapshot: workerRole, profileSnapshot: cursorProfile, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { creatorSessionId: "parent" }, capabilities: externalCapabilities });
    const launchEnvelope = buildLaunchEnvelope({ meshId: mesh.meshId, agentId: prepared.agentId, epochId: epoch.epochId, role: "worker", selectedProfile: "cursor-fast", snapshot: epoch, childExtensions: { worker: [] } });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(launchEnvelope));
    await publishAgent(root, mesh.meshId, prepared.paths, { agentId: prepared.agentId, epochId: epoch.epochId, role: "worker", selectedProfile: "cursor-fast", harness: "cursor-agent", cwd: "/work", roleSnapshot: workerRole, profileSnapshot: cursorProfile, launchEnvelope: envelopePath, creatorSessionId: "parent", tmux: externalTmux, capabilities: externalCapabilities });
    const taskId = randomUUID();
    const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: prepared.agentId, PI_MESH_AGENT_DIR: prepared.paths.directory, PI_MESH_EPOCH_ID: epoch.epochId, PI_MESH_TASK_PATH: taskPaths(root, mesh.meshId, taskId).directory, PI_AGENT_RESOLVED_AGENT: envelopePath, PI_MESH_EXTERNAL_CONFIG: JSON.stringify(externalConfig) };
    return { root, meshId: mesh.meshId, agentId: prepared.agentId, epochId: epoch.epochId, workerRole, launchEnvelope, envelopePath, env };
}

// Admission: launch isolation is repository-owned, a leaked context/tool/resource flag materially violates the gyaru boundary, and neither types nor schema validation observes the final Pi argv.
// Given project and prompt-only role envelopes, when they cross the native launch-descriptor boundary, the Pi process observes only the selected profile and resources authorized for that context/direct policy.
void test("Pi launch descriptors isolate prompt-only roles and configure peer tools only for direct callers", () => {
    const piProfile: ExecutionProfile = { model: "openai-codex/gpt-5.6-terra", thinkingLevel: "high", harness: "pi" };
    const promptOnly = envelope({ role: "gyaru", selfRole: role({ contextPolicy: "prompt-only", defaultProfile: "terra-high", tools: [] }), selectedProfile: "terra-high", executionProfile: piProfile });
    const isolated = piLaunchDescriptor(runtime, launchInput("gyaru", promptOnly));
    assert.equal(option(isolated.args, "--model"), piProfile.model);
    assert.equal(option(isolated.args, "--thinking"), piProfile.thinkingLevel);
    assert.deepEqual(extensions(isolated.args), ["/orchestration.ts", "/orchestration_child_bridge.ts"]);
    for (const flag of ["--no-context-files", "--no-skills", "--no-prompt-templates", "--no-tools"]) assert.equal(isolated.args.includes(flag), true, flag);
    assert.equal(isolated.args.includes("--tools"), false);

    const caller = envelope({ role: "reviewer", selfRole: role({ tools: ["read", "save_agent_artifact"], defaultProfile: "sol-high" }), selectedProfile: "sol-high", executionProfile: { model: "openai-codex/gpt-5.6-sol", thinkingLevel: "high", harness: "pi" }, policy: { roles: ["review-lens"], profiles: [] } });
    const callerTools = option(piLaunchDescriptor(runtime, launchInput("reviewer", caller)).args, "--tools")!.split(",");
    assert.deepEqual(callerTools, ["read", "save_agent_artifact", ...MESH_PEER_TOOL_NAMES]);

    const leaf = envelope({ role: "validator", selfRole: role({ tools: ["read", "bash"], defaultProfile: "luna-medium" }), selectedProfile: "luna-medium", executionProfile: { model: "openai-codex/gpt-5.6-luna", thinkingLevel: "medium", harness: "pi" } });
    assert.deepEqual(option(piLaunchDescriptor(runtime, launchInput("validator", leaf)).args, "--tools")!.split(","), ["read", "bash"]);
});

// Admission: selected-profile misrouting changes the actual model/harness while preserving an apparently correct purpose identity; final worker config and prompt composition are not guaranteed by envelope validation alone.
// Given worker/cursor-fast and searcher/codex-search envelopes, when they cross harness and external-driver routing, the worker observes the selected execution profile while retaining the role-owned instructions and caller task.
void test("external routing consumes selected profiles without turning profiles into purpose identities", () => {
    const workerRole = role({ instructions: "Complete the bounded worker objective.", defaultProfile: "sol-medium", tools: ["read", "write"] });
    const workerEnvelope = envelope({ role: "worker", selfRole: workerRole, selectedProfile: "cursor-fast", executionProfile: cursorProfile, policy: { roles: [], profiles: ["cursor-fast"] } });
    const cursor = resolveHarnessAdapter(runtime, cursorProfile.harness, cursorProfile);
    const cursorLaunch = cursor.adapter.launch(runtime, cursor.harness, launchInput("worker", workerEnvelope));
    assert.deepEqual(validateExternalWorkerConfig(JSON.parse(cursorLaunch.env.PI_MESH_EXTERNAL_CONFIG!)), { adapter: "cursor-acp", command: "/cursor", cwd: "/work", permissionPolicy: "allow-always" });
    assert.equal(resolveExternalDriver(validateExternalWorkerConfig(JSON.parse(cursorLaunch.env.PI_MESH_EXTERNAL_CONFIG!)), cursorProfile).display, "cursor-agent");
    assert.equal(workerEnvelope.role, "worker");
    assert.equal(externalTaskPrompt(workerEnvelope.selfRole.instructions, "Repair file A."), "Complete the bounded worker objective.\n\nDelegated task:\nRepair file A.");

    const searcherRole = role({ instructions: "Answer one bounded external question.", defaultProfile: "codex-search" });
    const codexProfile: ExecutionProfile = { model: "codex/gpt-5.6-luna", thinkingLevel: "high", harness: "codex", harnessOptions: { mode: "read-only", permissionPolicy: "reject", webSearch: "cached" } };
    const searcherEnvelope = envelope({ role: "searcher", selfRole: searcherRole, selectedProfile: "codex-search", executionProfile: codexProfile });
    const codex = resolveHarnessAdapter(runtime, codexProfile.harness, codexProfile);
    const codexLaunch = codex.adapter.launch(runtime, codex.harness, launchInput("searcher", searcherEnvelope));
    assert.deepEqual(validateExternalWorkerConfig(JSON.parse(codexLaunch.env.PI_MESH_EXTERNAL_CONFIG!)), { adapter: "codex-acp", command: "/codex-acp", cwd: "/work", mode: "read-only", permissionPolicy: "reject", webSearch: "cached" });
    assert.equal(resolveExternalDriver(validateExternalWorkerConfig(JSON.parse(codexLaunch.env.PI_MESH_EXTERNAL_CONFIG!)), codexProfile).display, "codex");
    assert.equal(searcherEnvelope.role, "searcher");
    assert.throws(() => resolveExternalDriver(validateExternalWorkerConfig(JSON.parse(codexLaunch.env.PI_MESH_EXTERNAL_CONFIG!)), cursorProfile), /Codex selected execution profile/u);
});

// Given launch metadata that disagrees with a valid selected-profile envelope, when the external worker parses its immutable launch identity, it rejects before starting a driver.
void test("external worker rejects mismatched immutable envelope identity before readiness", async () => withTemporaryRoot("orchestration-external-identity-", async root => {
    const fixture = await externalFixture(root);
    let starts = 0;
    const driver: ExternalDriver = { async start() { starts += 1; }, async runTask() { return { output: "", stopReason: "end_turn" }; }, async cancel() {}, async shutdown() {}, waitForClose: () => new Promise(() => {}), fatalError: () => undefined };
    await assert.rejects(runExternalWorker({ ...fixture.env, PI_MESH_EPOCH_ID: randomUUID() }, { createDriver: () => driver, sleep: yieldToIO }), /immutable epoch snapshot/u);
    assert.equal(starts, 0);
}));

// Given a published worker role under cursor-fast, when the external worker crosses readiness and successive task boundaries, durable state records completion, recoverable failure, cancellation, and later reuse under the same role/profile identity.
void test("external worker persists readiness and reusable completion, failure, and cancellation lifecycle", async () => withTemporaryRoot("orchestration-external-lifecycle-", async root => {
    const fixture = await externalFixture(root);
    const prompts: string[] = [];
    let cancels = 0;
    let rejectCancelled!: (error: Error) => void;
    const cancelledTurn = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
    const driver: ExternalDriver = {
        async start() {},
        async runTask(prompt) {
            prompts.push(prompt);
            if (prompt.endsWith("complete") || prompt.endsWith("reuse")) return { output: `done:${prompt.endsWith("reuse") ? "reuse" : "complete"}`, stopReason: "end_turn" };
            if (prompt.endsWith("cancel")) return cancelledTurn;
            throw new Error("driver task failed");
        },
        async cancel() { cancels += 1; },
        partialOutput: () => "partial cancellation output",
        async shutdown() {},
        waitForClose: () => new Promise(() => {}),
        fatalError: () => undefined,
    };
    const workerSleep = (milliseconds: number) => milliseconds === 50 ? new Promise<void>(resolve => setTimeout(resolve, 1)) : yieldToIO();
    const worker = runExternalWorker(fixture.env, { createDriver: () => driver, sleep: workerSleep, activityHeartbeatMs: 1 });
    let workerStopped = false;
    try {
    await waitUntil(async () => { const snapshot = await readAgentSnapshot(root, fixture.meshId, fixture.agentId); return snapshot.status.bridgeReady && snapshot.activity.phase === "idle"; });
    const ready = await readAgentSnapshot(root, fixture.meshId, fixture.agentId);
    assert.deepEqual({ role: ready.agent.role, selectedProfile: ready.agent.selectedProfile, harness: ready.agent.harness, context: ready.activity.context.state, accepting: ready.activity.acceptingTask }, { role: "worker", selectedProfile: "cursor-fast", harness: "cursor-agent", context: "unsupported", accepting: true });

    const submit = (prompt: string) => createTask(root, fixture.meshId, fixture.agentId, prompt, { requesterEndpointId: `root:${fixture.meshId}` });
    const complete = await submit("complete");
    await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId, complete.request.taskId)).task?.status.state === "succeeded");
    assert.equal((await readAgentSnapshot(root, fixture.meshId, fixture.agentId, complete.request.taskId)).task?.result?.output, "done:complete");
    await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId)).activity.acceptingTask);

    const failure = await submit("fail");
    await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId, failure.request.taskId)).task?.status.state === "failed");
    assert.match((await readAgentSnapshot(root, fixture.meshId, fixture.agentId, failure.request.taskId)).task?.result?.error ?? "", /driver task failed/u);
    await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId)).activity.acceptingTask);

    const reuse = await submit("reuse");
    await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId, reuse.request.taskId)).task?.status.state === "succeeded");
    assert.equal((await readAgentSnapshot(root, fixture.meshId, fixture.agentId, reuse.request.taskId)).task?.result?.output, "done:reuse");
    await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId)).activity.acceptingTask);

    const cancellation = await submit("cancel");
    await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId, cancellation.request.taskId)).task?.status.state === "running");
    await requestTaskCancellation(root, fixture.meshId, cancellation.request.taskId, "caller cancelled");
    await waitUntil(() => cancels >= 1);
    rejectCancelled(new Error("cancelled"));
    await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId, cancellation.request.taskId)).task?.status.state === "stopped");
    const cancelled = await readAgentSnapshot(root, fixture.meshId, fixture.agentId, cancellation.request.taskId);
    assert.equal(cancelled.task?.result?.output, "partial cancellation output");
    assert.match(cancelled.task?.result?.error ?? "", /cancelled/u);
    assert.ok((await readAgentActivity(root, fixture.meshId, fixture.agentId))!.sequence > 0);

    await markAgentStopping(root, fixture.meshId, fixture.agentId);
    await worker;
    workerStopped = true;
    assert.equal((await readAgentSnapshot(root, fixture.meshId, fixture.agentId)).status.state, "stopping");
    assert.deepEqual(prompts, ["complete", "fail", "reuse", "cancel"].map(prompt => externalTaskPrompt(fixture.workerRole.instructions, prompt)));
    } finally {
        if (!workerStopped) {
            await markAgentStopping(root, fixture.meshId, fixture.agentId).catch(() => {});
            await worker.catch(() => {});
        }
    }
}));
