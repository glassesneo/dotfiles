import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { externalTaskPrompt, externalWorkerHeading, runExternalWorker } from "../extensions_src/orchestration_external_worker.ts";
import { buildLaunchEnvelope, type AgentLaunchEnvelope, type ChildDefinition } from "../extensions_src/utilities/agent_types.ts";
import type { ExecutionConfig } from "../extensions_src/utilities/mode_types.ts";
import { externalContext, publishAgentActivity, readAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { bindAgentRuntime } from "../extensions_src/utilities/orchestration_runtime.ts";
import { CursorAcpDriver } from "../extensions_src/utilities/orchestration_cursor_acp.ts";
import { UnconfirmedTerminationError, resolveExternalDriver, validateExternalWorkerConfig, type ExternalDriver, type ExternalWorkerConfig } from "../extensions_src/utilities/orchestration_external_driver.ts";
import { resolveHarnessAdapter } from "../extensions_src/utilities/orchestration_harness.ts";
import { piLaunchDescriptor } from "../extensions_src/utilities/orchestration_pi.ts";
import { projectDebugSnapshot } from "../extensions_src/utilities/orchestration_projection.ts";
import { claimPendingTask, createTask, ensurePolicyEpoch, failAgentStop, finishTask, initializeMesh, markAgentStopping, patchAgentStatus, prepareAgent, publishAgent, readAgentSnapshot, readAgentStatus, readAgentStopRequest, requestAgentStop, requestTaskCancellation, reserveMeshCapacity, taskPaths } from "../extensions_src/utilities/orchestration_store.ts";
import { handleForAgentId } from "../extensions_src/utilities/orchestration_identity.ts";
import { withTemporaryRoot, yieldToIO } from "./test_helpers.ts";

const meshId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const epochId = "33333333-3333-4333-8333-333333333333";
const SYNTHETIC_CURSOR_ALIAS = "synthetic-cli-alias";
const SYNTHETIC_ACP_MODEL_ID = "synthetic-acp-model";
const runtime = { stateRoot: "/state", harnesses: { pi: { adapter: "pi-native", command: "/pi" }, "cursor-agent": { adapter: "cursor-acp", command: "/cursor", workerCommand: "/node", workerEntrypoint: "/worker.ts", modelIds: { [SYNTHETIC_CURSOR_ALIAS]: SYNTHETIC_ACP_MODEL_ID } }, codex: { adapter: "codex-acp", command: "/codex-acp", workerCommand: "/node", workerEntrypoint: "/worker.ts" } } } as never;

const childGc = { collectAt: 2, retain: 1, pressureFloor: 0 };
function child(overrides: Partial<ChildDefinition> = {}): ChildDefinition {
    return { selector: { agent: "standard", access: "read" }, description: "purpose", tools: [], instructions: "Own this purpose.", contextPolicy: "project", childExtensionContributions: [], execution: { models: ["openai-codex/gpt-5.6-terra"], thinkingLevel: "high", harness: "pi" }, targets: [], gc: childGc, ...overrides };
}
function envelope(input: { childId: string; self: ChildDefinition; extra?: Record<string, ChildDefinition>; extensions?: string[] }): AgentLaunchEnvelope {
    const children = { [input.childId]: input.self, ...input.extra };
    const snapshot = { mode: "ops", directTargets: [input.childId], children };
    const defaultExtensions = input.extensions ?? ["/popup.ts", "/orchestration.ts", "/role-contribution.ts", "/orchestration_child_bridge.ts"];
    const childExtensions = Object.fromEntries(Object.keys(children).map(name => [name, defaultExtensions]));
    return buildLaunchEnvelope({ meshId, agentId, epochId, childId: input.childId, snapshot, childExtensions });
}
function launchInput(childId: string, snapshot: AgentLaunchEnvelope) {
    return { meshId, agentId, agentDirectory: `/state/meshes/${meshId}/agents/${agentId}`, childId, taskPath: `/state/meshes/${meshId}/tasks/task`, launchEnvelope: "/envelope.json", epochSnapshot: snapshot, cwd: "/work", ...(snapshot.self.execution.harness === "cursor-agent" ? { resolvedCursorAcpModelId: SYNTHETIC_ACP_MODEL_ID } : {}) };
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
const cursorExecution: ExecutionConfig = { models: [`cursor/${SYNTHETIC_CURSOR_ALIAS}`], harness: "cursor-agent", harnessOptions: { mode: "agent", permissionPolicy: "allow-always", sandbox: "disabled", trustWorkspace: true, worktree: false } };
const externalConfig: ExternalWorkerConfig = { adapter: "cursor-acp", command: "/cursor", cwd: "/work", expectedAcpModelId: SYNTHETIC_ACP_MODEL_ID, mode: "agent", permissionPolicy: "allow-always" };

async function externalFixture(root: string, input: { execution?: ExecutionConfig; config?: ExternalWorkerConfig } = {}) {
    const execution = input.execution ?? cursorExecution;
    const config = input.config ?? externalConfig;
    const general = child({ instructions: "Independently own one problem through exploration, implementation, and validation.", tools: [], execution });
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: false, budgets: externalBudgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", catalog: { schemaVersion: 1, children: { general } }, callPolicy: { modes: { ops: { targets: ["general"] } } } });
    const reservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task");
    const prepared = await prepareAgent(root, mesh.meshId, { reservationId: reservation.reservationId, childId: "general", harness: execution.harness, cwd: "/work", definitionSnapshot: general, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { creatorSessionId: "parent" }, capabilities: externalCapabilities });
    const launchEnvelope = buildLaunchEnvelope({ meshId: mesh.meshId, agentId: prepared.agentId, epochId: epoch.epochId, childId: "general", snapshot: epoch, childExtensions: { general: [] } });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(launchEnvelope));
    await publishAgent(root, mesh.meshId, prepared.paths, { agentId: prepared.agentId, epochId: epoch.epochId, childId: "general", harness: execution.harness, ...(config.adapter === "cursor-acp" ? { cursorAcpModelId: config.expectedAcpModelId } : {}), cwd: "/work", definitionSnapshot: general, launchEnvelope: envelopePath, creatorSessionId: "parent", tmux: externalTmux, capabilities: externalCapabilities });
    const taskId = randomUUID();
    const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: prepared.agentId, PI_MESH_AGENT_DIR: prepared.paths.directory, PI_MESH_EPOCH_ID: epoch.epochId, PI_MESH_TASK_PATH: taskPaths(root, mesh.meshId, taskId).directory, PI_AGENT_RESOLVED_AGENT: envelopePath, PI_MESH_EXTERNAL_CONFIG: JSON.stringify(config) };
    return { root, meshId: mesh.meshId, agentId: prepared.agentId, epochId: epoch.epochId, general, launchEnvelope, envelopePath, env };
}

// Admission: usual terminal heading is the user-visible identity for external workers; types cannot detect leaked diagnostics or an internal childId such as role: general.
// Given a public selector and current purpose, the heading keeps handle, public agent/access, purpose, and textual state without model, harness, agentId, role, or profile.
void test("usual external heading omits diagnostics and internal role", () => {
    const handle = handleForAgentId(agentId);
    const heading = externalWorkerHeading({
        agentId,
        handle,
        publicAgent: "general",
        access: "read",
        purpose: "Own this purpose",
        status: "idle-reusable",
    });
    assert.match(heading, new RegExp(handle, "u"));
    assert.match(heading, /general\/read/u);
    assert.match(heading, /Own this purpose/u);
    assert.match(heading, /Idle/u);
    assert.doesNotMatch(heading, /agentId:/u);
    assert.doesNotMatch(heading, /harness:/u);
    assert.doesNotMatch(heading, /model:/u);
    assert.doesNotMatch(heading, /role:/u);
    assert.doesNotMatch(heading, /profile:/u);
});

function captureStdout(): { text: () => string; restore: () => void } {
    const chunks: string[] = [];
    const stdout = process.stdout;
    const originalWrite = stdout.write.bind(stdout);
    stdout.write = ((chunk: unknown, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
        chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString());
        if (typeof encoding === "function") encoding();
        else callback?.();
        return true;
    }) as typeof stdout.write;
    return { text: () => chunks.join(""), restore: () => { stdout.write = originalWrite; } };
}

function usualHeadingLines(text: string): string[] {
    return text.replaceAll("\u001b[2J", "").replaceAll("\u001b[H", "").split("\n").map(line => line.trim()).filter(line => / · \S+\/(?:read|write)(?: · |$)/u.test(line));
}

// Admission: reused external work keeps a live heading; store reuse tests do not observe the terminal consumer, and a startup-only heading leaves the first purpose/state in place.
// Given two successive tasks with distinct purposes, when claim and completion cross the worker, stdout shows the current purpose and textual agent state without diagnostic fields.
void test("external usual heading follows current purpose and state across reuse", async () => withTemporaryRoot("orchestration-external-heading-reuse-", async root => {
    const fixture = await externalFixture(root);
    const captured = captureStdout();
    const driver: ExternalDriver = {
        async start() {},
        async runTask() { return { output: "done", stopReason: "end_turn" }; },
        async cancel() {},
        async shutdown() {},
        waitForClose: () => new Promise(() => {}),
        fatalError: () => undefined,
        exitObserved: () => false,
    };
    const worker = runExternalWorker(fixture.env, { createDriver: () => driver, sleep: yieldToIO, activityHeartbeatMs: 1, idleClaimIntervalMs: 1 });
    let workerStopped = false;
    try {
        await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId)).activity.phase === "idle");
        const first = await createTask(root, fixture.meshId, fixture.agentId, { prompt: "first", purpose: "first purpose" }, { requesterEndpointId: `root:${fixture.meshId}` });
        await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId, first.request.taskId)).task?.status.state === "succeeded");
        await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId)).activity.acceptingTask);
        await waitUntil(() => {
            const latest = usualHeadingLines(captured.text()).at(-1) ?? "";
            return latest.includes("first purpose") && latest.includes("Idle");
        });
        const afterFirst = usualHeadingLines(captured.text()).at(-1) ?? "";
        assert.match(afterFirst, /first purpose/u);
        assert.match(afterFirst, /Idle/u);
        assert.doesNotMatch(afterFirst, /agentId:|harness:|model:/u);

        const second = await createTask(root, fixture.meshId, fixture.agentId, { prompt: "second", purpose: "second purpose" }, { requesterEndpointId: `root:${fixture.meshId}` });
        await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId, second.request.taskId)).task?.status.state === "succeeded");
        await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId)).activity.acceptingTask);
        await waitUntil(() => {
            const latest = usualHeadingLines(captured.text()).at(-1) ?? "";
            return latest.includes("second purpose") && latest.includes("Idle");
        });
        const afterSecond = usualHeadingLines(captured.text()).at(-1) ?? "";
        assert.match(afterSecond, /second purpose/u);
        assert.doesNotMatch(afterSecond, /first purpose/u);
        assert.match(afterSecond, /Idle/u);
        assert.doesNotMatch(captured.text(), /agentId:|harness:|model:/u);
        assert.ok(usualHeadingLines(captured.text()).some(line => line.includes("second purpose") && line.includes("Running")));

        await markAgentStopping(root, fixture.meshId, fixture.agentId);
        await worker;
        workerStopped = true;
    } finally {
        captured.restore();
        if (!workerStopped) {
            await markAgentStopping(root, fixture.meshId, fixture.agentId).catch(() => {});
            await worker.catch(() => {});
        }
    }
}));

// Admission: launch isolation is repository-owned, a leaked context/tool/resource flag materially violates the role boundary, and neither types nor schema validation observes the final Pi argv.
// Given project, outbound, and prompt-only role envelopes, when they cross the native launch-descriptor boundary, the Pi process observes only the selected profile and tools authorized for that context.
void test("Pi launch descriptors isolate prompt-only roles and expose outbound or report-only mesh tools", () => {
    const piExecution: ExecutionConfig = { models: ["openai-codex/gpt-5.6-terra"], thinkingLevel: "high", harness: "pi" };
    const promptOnly = envelope({ childId: "prompt-only", self: child({ contextPolicy: "prompt-only", tools: [], execution: piExecution }) });
    const isolated = piLaunchDescriptor(runtime, launchInput("prompt-only", promptOnly));
    assert.equal(option(isolated.args, "--model"), piExecution.models[0]);
    assert.equal(option(isolated.args, "--thinking"), piExecution.thinkingLevel);
    assert.equal(isolated.args.includes("--no-extensions"), true);
    assert.deepEqual(extensions(isolated.args), ["/orchestration.ts", "/orchestration_child_bridge.ts"]);
    for (const flag of ["--no-context-files", "--no-skills", "--no-prompt-templates", "--no-tools"]) assert.equal(isolated.args.includes(flag), true, flag);
    assert.equal(isolated.args.includes("--tools"), false);

    const reviewLens = child({ selector: { agent: "review-lens", access: "read" }, execution: piExecution });
    const caller = envelope({ childId: "reviewer", self: child({ tools: ["read", "save_agent_artifact"], execution: { models: ["openai-codex/gpt-5.6-sol"], thinkingLevel: "high", harness: "pi" }, targets: ["review-lens"] }), extra: { "review-lens": reviewLens } });
    const callerTools = option(piLaunchDescriptor(runtime, launchInput("reviewer", caller)).args, "--tools")!.split(",");
    assert.deepEqual(callerTools, ["read", "save_agent_artifact", "mesh_send", "mesh_get", "mesh_wait", "mesh_stop", "mesh_report"]);

    const leaf = envelope({ childId: "validator", self: child({ tools: ["read", "bash"], execution: { models: ["openai-codex/gpt-5.6-luna"], thinkingLevel: "xhigh", harness: "pi" } }) });
    assert.deepEqual(option(piLaunchDescriptor(runtime, launchInput("validator", leaf)).args, "--tools")!.split(","), ["read", "bash", "mesh_report"]);
});

// Admission: selected-profile misrouting changes the actual model/harness while preserving an apparently correct purpose identity; final worker config and prompt composition are not guaranteed by envelope validation alone.
// Given general/cursor-standard and searcher/codex-search envelopes, when they cross harness and external-driver routing, each worker observes the selected execution profile while retaining the role-owned instructions and caller task.
void test("external routing consumes selected profiles without turning profiles into purpose identities", () => {
    const general = child({ instructions: "Independently own one problem through exploration, implementation, and validation.", tools: [], execution: cursorExecution });
    const generalEnvelope = envelope({ childId: "general", self: general });
    const cursor = resolveHarnessAdapter(runtime, cursorExecution.harness, cursorExecution);
    const cursorLaunch = cursor.adapter.launch(runtime, cursor.harness, launchInput("general", generalEnvelope));
    assert.deepEqual(validateExternalWorkerConfig(JSON.parse(cursorLaunch.env.PI_MESH_EXTERNAL_CONFIG!)), { adapter: "cursor-acp", command: "/cursor", cwd: "/work", expectedAcpModelId: SYNTHETIC_ACP_MODEL_ID, mode: "agent", permissionPolicy: "allow-always" });
    assert.equal(resolveExternalDriver(validateExternalWorkerConfig(JSON.parse(cursorLaunch.env.PI_MESH_EXTERNAL_CONFIG!)), cursorExecution).display, "cursor-agent");
    assert.equal(generalEnvelope.childId, "general");
    assert.equal(externalTaskPrompt(generalEnvelope.self.instructions, "Repair file A."), "Independently own one problem through exploration, implementation, and validation.\n\nDelegated task:\nRepair file A.");

    const searcher = child({ instructions: "Answer one bounded external question." });
    const codexExecution: ExecutionConfig = { models: ["codex/gpt-5.6-luna"], thinkingLevel: "high", harness: "codex", harnessOptions: { mode: "read-only", permissionPolicy: "reject", webSearch: "cached" } };
    const searcherEnvelope = envelope({ childId: "searcher", self: { ...searcher, execution: codexExecution } });
    const codex = resolveHarnessAdapter(runtime, codexExecution.harness, codexExecution);
    const codexLaunch = codex.adapter.launch(runtime, codex.harness, launchInput("searcher", searcherEnvelope));
    assert.deepEqual(validateExternalWorkerConfig(JSON.parse(codexLaunch.env.PI_MESH_EXTERNAL_CONFIG!)), { adapter: "codex-acp", command: "/codex-acp", cwd: "/work", mode: "read-only", permissionPolicy: "reject", webSearch: "cached" });
    assert.equal(resolveExternalDriver(validateExternalWorkerConfig(JSON.parse(codexLaunch.env.PI_MESH_EXTERNAL_CONFIG!)), codexExecution).display, "codex");
    assert.equal(searcherEnvelope.childId, "searcher");
    assert.throws(() => resolveExternalDriver(validateExternalWorkerConfig(JSON.parse(codexLaunch.env.PI_MESH_EXTERNAL_CONFIG!)), cursorExecution), /Codex selected execution profile/u);
    assert.throws(() => resolveExternalDriver(externalConfig, codexExecution), /Cursor selected execution profile/u);
});

// Given launch metadata that disagrees with a valid selected-profile envelope, when the external worker parses its immutable launch identity, it rejects before starting a driver.
void test("external worker rejects mismatched immutable envelope identity before readiness", async () => withTemporaryRoot("orchestration-external-identity-", async root => {
    const fixture = await externalFixture(root);
    let starts = 0;
    const driver: ExternalDriver = { async start() { starts += 1; }, async runTask() { return { output: "", stopReason: "end_turn" }; }, async cancel() {}, async shutdown() {}, waitForClose: () => new Promise(() => {}), fatalError: () => undefined, exitObserved: () => false };
    await assert.rejects(runExternalWorker({ ...fixture.env, PI_MESH_EPOCH_ID: randomUUID() }, { createDriver: () => driver, sleep: yieldToIO }), /immutable epoch snapshot/u);
    assert.equal(starts, 0);
}));

// Admission: a worker/config mismatch can route the model differently from the immutable agent record, and schemas validate each value but not their equality at the process boundary.
// Given a persisted Cursor ACP model ID and a different worker config ID, the worker rejects before creating or starting the driver and cannot send a prompt.
void test("external worker rejects a Cursor ACP model ID mismatch before driver startup", async () => withTemporaryRoot("orchestration-external-model-id-", async root => {
    const fixture = await externalFixture(root);
    const config = { ...externalConfig, expectedAcpModelId: "different-acp-model" };
    let created = 0;
    await assert.rejects(runExternalWorker({ ...fixture.env, PI_MESH_EXTERNAL_CONFIG: JSON.stringify(config) }, { createDriver: () => { created += 1; throw new Error("driver must not be created"); }, sleep: yieldToIO }), /does not match the persisted agent record/u);
    assert.equal(created, 0);
}));

// Admission: external adapter startup persists raw diagnostics for the TUI, but model-facing projection is the only stable public boundary; types and ACP capability checks cannot observe both outcomes.
// Given configured Cursor and Codex profiles whose external startup fails with their configured full, alias, or ACP model identifiers, when the worker persists the failure and it crosses debug projection, the model observes route_unavailable while the raw diagnostic remains available to operators.
void test("external startup diagnostics preserve operator details while hiding configured Cursor and Codex identities", async () => withTemporaryRoot("orchestration-external-projection-", async root => {
    const codexExecution: ExecutionConfig = { models: ["codex/gpt-5.6-luna"], thinkingLevel: "high", harness: "codex", harnessOptions: { mode: "read-only", permissionPolicy: "reject", webSearch: "cached" } };
    const codexConfig: ExternalWorkerConfig = { adapter: "codex-acp", command: "/codex", cwd: "/work", mode: "read-only", permissionPolicy: "reject", webSearch: "cached" };
    const cases = [
        { execution: cursorExecution, config: externalConfig, diagnostic: `Cursor ACP rejected cursor/${SYNTHETIC_CURSOR_ALIAS} alias ${SYNTHETIC_CURSOR_ALIAS} as ${SYNTHETIC_ACP_MODEL_ID}`, names: [`cursor/${SYNTHETIC_CURSOR_ALIAS}`, SYNTHETIC_CURSOR_ALIAS, SYNTHETIC_ACP_MODEL_ID] },
        { execution: codexExecution, config: codexConfig, diagnostic: "Codex ACP does not advertise required model gpt-5.6-luna from codex/gpt-5.6-luna", names: ["codex/gpt-5.6-luna", "gpt-5.6-luna"] },
    ] as const;
    for (const scenario of cases) {
        const fixture = await externalFixture(root, { execution: scenario.execution, config: scenario.config });
        const driver: ExternalDriver = { async start() { throw new Error(scenario.diagnostic); }, async runTask() { return { output: "", stopReason: "end_turn" }; }, async cancel() {}, async shutdown() {}, waitForClose: () => new Promise(() => {}), fatalError: () => undefined, exitObserved: () => false };
        await assert.rejects(runExternalWorker(fixture.env, { createDriver: () => driver, sleep: yieldToIO }), new RegExp(scenario.names[0]!.replace(/[.[\]\\]/gu, "\\$&"), "u"));
        const persisted = await readAgentSnapshot(root, fixture.meshId, fixture.agentId);
        assert.equal(persisted.status.exitReason, scenario.diagnostic);
        const projected = JSON.stringify(projectDebugSnapshot(persisted));
        assert.match(projected, /route_unavailable/u);
        for (const name of scenario.names) assert.doesNotMatch(projected, new RegExp(name.replace(/[.[\]\\]/gu, "\\$&"), "u"));
    }
}));

// Admission: external idle claiming is repository-owned process behavior; schemas cannot detect repeated full task scans hidden behind stop probes.
// Given an idle external worker, when stop probes cross the worker loop, full task claims occur only at the three-second deadline.
void test("external worker separates idle stop probes from full task claims", async () => withTemporaryRoot("orchestration-external-cadence-", async root => {
    const fixture = await externalFixture(root);
    let now = 0;
    const claimTimes: number[] = []; const probeTimes: number[] = []; const suppressedWatcher = { close() {}, on() { return suppressedWatcher; }, unref() {} };
    const driver: ExternalDriver = { async start() {}, async runTask() { return { output: "", stopReason: "end_turn" }; }, async cancel() {}, async shutdown() {}, waitForClose: () => new Promise(() => {}), fatalError: () => undefined, exitObserved: () => false };
    await runExternalWorker(fixture.env, {
        createDriver: () => driver,
        now: () => now,
        sleep: async milliseconds => { now += milliseconds; },
        readAgentStatus: async (...args) => { probeTimes.push(now); return readAgentStatus(...args); },
        claimPendingTask: async (...args) => { claimTimes.push(now); const task = await claimPendingTask(...args); if (claimTimes.length === 2) await markAgentStopping(root, fixture.meshId, fixture.agentId); return task; },
        wake: { watch: () => suppressedWatcher },
    });
    assert.deepEqual(claimTimes, [0, 3000]);
    assert.deepEqual(probeTimes.slice(0, 31), Array.from({ length: 31 }, (_value, index) => index * 100));
}));

// Admission: external active cancellation cadence is process-owned behavior not established by schemas or the idle-claim test.
// Given a published general role under cursor-standard, when the external worker crosses readiness and successive task boundaries, durable state records completion, recoverable failure, 50 ms cancellation monitoring, and later reuse under the same role/profile identity.
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
        exitObserved: () => false,
    };
    const sleepRequests: number[] = []; const workerSleep = (milliseconds: number) => { sleepRequests.push(milliseconds); return milliseconds === 50 ? new Promise<void>(resolve => setTimeout(resolve, 1)) : yieldToIO(); };
    const worker = runExternalWorker(fixture.env, { createDriver: () => driver, sleep: workerSleep, activityHeartbeatMs: 1, idleClaimIntervalMs: 1 });
    let workerStopped = false;
    try {
    await waitUntil(async () => { const snapshot = await readAgentSnapshot(root, fixture.meshId, fixture.agentId); return snapshot.status.bridgeReady && snapshot.activity.phase === "idle"; });
    const ready = await readAgentSnapshot(root, fixture.meshId, fixture.agentId);
    assert.deepEqual({ childId: ready.agent.childId, harness: ready.agent.harness, usage: ready.agent.capabilities.usage, context: ready.activity.context.state, accepting: ready.activity.acceptingTask }, { childId: "general", harness: "cursor-agent", usage: false, context: "unsupported", accepting: true });

    const submit = (prompt: string) => createTask(root, fixture.meshId, fixture.agentId, { prompt, purpose: "synthetic purpose" }, { requesterEndpointId: `root:${fixture.meshId}` });
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
    assert.ok((await readAgentActivity(root, fixture.meshId, fixture.agentId))!.sequence > 0); assert.equal(sleepRequests.includes(50), true);

    await markAgentStopping(root, fixture.meshId, fixture.agentId);
    await worker;
    workerStopped = true;
    assert.equal((await readAgentSnapshot(root, fixture.meshId, fixture.agentId)).status.state, "stopping");
    assert.deepEqual(prompts, ["complete", "fail", "reuse", "cancel"].map(prompt => externalTaskPrompt(fixture.general.instructions, prompt)));
    } finally {
        if (!workerStopped) {
            await markAgentStopping(root, fixture.meshId, fixture.agentId).catch(() => {});
            await worker.catch(() => {});
        }
    }
}));

const blockingHoldPeer = `#!/usr/bin/env node
const fs=require("fs"); const readline=require("readline");
const send=m=>process.stdout.write(JSON.stringify(m)+"\\n");
process.on("SIGTERM",()=>{ setTimeout(()=>process.exit(1), 150); });
const input=readline.createInterface({input:process.stdin});
input.on("line",line=>{const message=JSON.parse(line);
 if(message.method==="initialize") send({jsonrpc:"2.0",id:message.id,result:{protocolVersion:1}});
 else if(message.method==="session/new") send({jsonrpc:"2.0",id:message.id,result:{sessionId:"session-1",modes:{availableModes:[{id:"ask"},{id:"agent"}]},models:{currentModelId:"synthetic-acp-model",availableModels:[{modelId:"synthetic-acp-model"}]},configOptions:[{id:"model",currentValue:"synthetic-acp-model",options:[{value:"synthetic-acp-model"}]}]}});
 else if(message.method==="session/set_mode") send({jsonrpc:"2.0",id:message.id,result:{}});
 else if(message.method==="session/prompt"){
  send({jsonrpc:"2.0",method:"session/update",params:{sessionId:"session-1",update:{sessionUpdate:"agent_message_chunk",content:{text:"still running"}}}});
  send({jsonrpc:"2.0",id:"blocking-1",method:"cursor/blocking_request",params:{sessionId:"session-1"}});
  setInterval(()=>send({jsonrpc:"2.0",method:"session/update",params:{sessionId:"session-1",update:{sessionUpdate:"agent_message_chunk",content:{text:"+"}}}}), 30);
 }
});`;

// Admission: finishTask otherwise writes idle before failAgent, so a caller can reuse an agent whose process is still live; types cannot observe that status write.
// Given a busy task, when finishTask crosses the store with retireAgent, the mesh caller observes failed/not-accepting and cannot submit another task.
void test("finishTask retireAgent fails the agent without publishing idle", async () => withTemporaryRoot("orchestration-external-retire-", async root => {
    const fixture = await externalFixture(root);
    const runtimeId = randomUUID();
    await bindAgentRuntime(root, fixture.meshId, fixture.agentId, { runtimeId, kind: "external" });
    await patchAgentStatus(root, fixture.meshId, fixture.agentId, { state: "idle", bridgeReady: true });
    const now = new Date().toISOString();
    await publishAgentActivity(root, fixture.meshId, fixture.agentId, { runtimeId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: now, observedAt: now, heartbeatAt: now, context: externalContext() });
    const task = await createTask(root, fixture.meshId, fixture.agentId, { prompt: "retire without idle", purpose: "synthetic purpose" }, { requesterEndpointId: `root:${fixture.meshId}` });
    await finishTask(root, fixture.meshId, task.request.taskId, { outcome: "failed", error: "unconfirmed termination", retireAgent: "failed" }, runtimeId);
    const snapshot = await readAgentSnapshot(root, fixture.meshId, fixture.agentId, task.request.taskId);
    assert.equal(snapshot.task?.result?.outcome, "failed");
    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.status.activeTaskId, undefined);
    assert.equal(snapshot.activity.acceptingTask, false);
    await assert.rejects(createTask(root, fixture.meshId, fixture.agentId, { prompt: "must not reuse", purpose: "synthetic purpose" }, { requesterEndpointId: `root:${fixture.meshId}` }), /failed|not accepting|busy/iu);
}));

// Admission: a local ACP failure can reject runTask while the child process is still alive; schemas cannot observe accepting/task/exit order.
// Given an unconfirmed driver error, when the worker crosses activity publication then shutdown, callers observe confirming-stop and a non-terminal task before exit, then failed retirement after exit, never idle reuse.
void test("unconfirmed termination stays non-accepting until process exit then retires", async () => withTemporaryRoot("orchestration-external-unconfirmed-", async root => {
    const fixture = await externalFixture(root);
    let releaseExit!: () => void;
    const exitGate = new Promise<void>(resolve => { releaseExit = resolve; });
    let shutdownStarted = false;
    let exited = false;
    const driver: ExternalDriver = {
        async start() {},
        async runTask() { throw new UnconfirmedTerminationError("Unsupported blocking ACP request: cursor/blocking_request"); },
        async cancel() {},
        async shutdown() { shutdownStarted = true; await exitGate; exited = true; },
        waitForClose: () => new Promise(() => {}),
        fatalError: () => undefined,
        exitObserved: () => exited,
    };
    const worker = runExternalWorker(fixture.env, { createDriver: () => driver, sleep: yieldToIO, activityHeartbeatMs: 1, idleClaimIntervalMs: 1 });
    let workerStopped = false;
    try {
        await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId)).activity.phase === "idle");
        const task = await createTask(root, fixture.meshId, fixture.agentId, { prompt: "blocking", purpose: "synthetic purpose" }, { requesterEndpointId: `root:${fixture.meshId}` });
        await waitUntil(() => shutdownStarted);
        const during = await readAgentSnapshot(root, fixture.meshId, fixture.agentId, task.request.taskId);
        assert.equal(during.activity.phase, "confirming-stop");
        assert.equal(during.activity.acceptingTask, false);
        assert.equal(during.status.state, "stopping");
        assert.ok(during.task && !["succeeded", "failed", "stopped"].includes(during.task.status.state));
        const stop = await readAgentStopRequest(root, fixture.meshId, fixture.agentId);
        assert.equal(stop?.source, "recovery");
        assert.equal(stop?.state, "requested");
        assert.equal(stop?.terminalState, "failed");
        await assert.rejects(createTask(root, fixture.meshId, fixture.agentId, { prompt: "must not reuse yet", purpose: "synthetic purpose" }, { requesterEndpointId: `root:${fixture.meshId}` }), /stopping|busy|not accepting|stop request/iu);
        releaseExit();
        await worker;
        workerStopped = true;
        const after = await readAgentSnapshot(root, fixture.meshId, fixture.agentId, task.request.taskId);
        assert.equal(after.task?.result?.outcome, "failed");
        assert.match(after.task?.result?.error ?? "", /Unsupported blocking ACP request/u);
        assert.equal(after.status.state, "failed");
        assert.equal(after.activity.acceptingTask, false);
        await assert.rejects(createTask(root, fixture.meshId, fixture.agentId, { prompt: "must not reuse retired", purpose: "synthetic purpose" }, { requesterEndpointId: `root:${fixture.meshId}` }), /failed|not accepting|busy|stop request/iu);
    } finally {
        if (!workerStopped) {
            releaseExit();
            await worker.catch(() => {});
        }
    }
}));

// Admission: shutdown can fail to observe OS exit; treating that as success would publish IDLE or a terminal completion while the child may still run.
// Given unconfirmed termination whose shutdown rejects, the worker leaves the task non-terminal, not idle, and a stop request for recovery rather than a succeeded completion.
void test("unconfirmed stop-confirmation failure does not publish idle or succeeded completion", async () => withTemporaryRoot("orchestration-external-confirm-fail-", async root => {
    const fixture = await externalFixture(root);
    let shutdownStarted = false;
    let exited = false;
    let releaseExit!: () => void;
    const exitGate = new Promise<Error>(resolve => { releaseExit = () => { exited = true; resolve(new Error("ACP process exited (later)")); }; });
    const driver: ExternalDriver = {
        async start() {},
        async runTask() { throw new UnconfirmedTerminationError("ACP request timed out: session/prompt"); },
        async cancel() {},
        async shutdown() { shutdownStarted = true; throw new Error("ACP process exit was not confirmed"); },
        waitForClose: () => exitGate,
        fatalError: () => undefined,
        exitObserved: () => exited,
    };
    const worker = runExternalWorker(fixture.env, { createDriver: () => driver, sleep: yieldToIO, activityHeartbeatMs: 1, idleClaimIntervalMs: 1 });
    let workerStopped = false;
    try {
        await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId)).activity.phase === "idle");
        const task = await createTask(root, fixture.meshId, fixture.agentId, { prompt: "timeout", purpose: "synthetic purpose" }, { requesterEndpointId: `root:${fixture.meshId}` });
        await waitUntil(() => shutdownStarted);
        await waitUntil(async () => (await readAgentStopRequest(root, fixture.meshId, fixture.agentId))?.state === "requested");
        const raced = await Promise.race([worker.then(() => "settled" as const), new Promise<"pending">(resolve => setTimeout(() => resolve("pending"), 40))]);
        assert.equal(raced, "pending");
        const snapshot = await readAgentSnapshot(root, fixture.meshId, fixture.agentId, task.request.taskId);
        assert.notEqual(snapshot.task?.status.state, "succeeded");
        assert.ok(snapshot.task && !["succeeded", "failed", "stopped"].includes(snapshot.task.status.state));
        assert.equal(snapshot.status.state, "stopping");
        assert.equal(snapshot.activity.acceptingTask, false);
        const stop = await readAgentStopRequest(root, fixture.meshId, fixture.agentId);
        assert.ok(stop);
        assert.equal(stop?.state, "requested");
        assert.equal(stop?.terminalState, "failed");
        // A failed recovery attempt must not restore idle/busy or disable future recovery.
        await failAgentStop(root, fixture.meshId, fixture.agentId, stop!.stopRequestId, "pane-remained-alive");
        const retryPending = await readAgentSnapshot(root, fixture.meshId, fixture.agentId, task.request.taskId);
        assert.equal(retryPending.status.state, "stopping");
        assert.equal(retryPending.stop?.state, "terminating");
        assert.equal(retryPending.stop?.failureCategory, "pane-remained-alive");
        assert.equal(retryPending.activity.acceptingTask, false);
        await assert.rejects(createTask(root, fixture.meshId, fixture.agentId, { prompt: "must not reuse", purpose: "synthetic purpose" }, { requesterEndpointId: `root:${fixture.meshId}` }), /stopping|not accepting|busy|stop request/iu);
        releaseExit();
        await worker;
        workerStopped = true;
        const after = await readAgentSnapshot(root, fixture.meshId, fixture.agentId, task.request.taskId);
        assert.equal(after.task?.result?.outcome, "failed");
        assert.equal(after.status.state, "failed");
    } finally {
        if (!workerStopped) {
            releaseExit();
            await worker.catch(() => {});
        }
    }
}));

// Admission: a fake ACP peer can fail a blocking request while prompt stays open; worker/store order is not established by the driver unit test that shuts down immediately after reject.
// Given a live Cursor ACP peer that keeps sending updates after an unsupported blocking request, the worker observes confirming-stop and a non-terminal task before process exit, then failed retirement.
void test("Cursor ACP blocking failure retires only after the fake peer process exits", async () => withTemporaryRoot("orchestration-external-cursor-peer-", async root => {
    const fixture = await externalFixture(root);
    const directory = await mkdtemp(join(tmpdir(), "orchestration-cursor-hold-"));
    const command = join(directory, "peer.cjs");
    await writeFile(command, blockingHoldPeer);
    await chmod(command, 0o755);
    const events: Array<{ type: string; text: string }> = [];
    const driver = new CursorAcpDriver({
        command,
        cwd: directory,
        model: SYNTHETIC_CURSOR_ALIAS,
        expectedAcpModelId: SYNTHETIC_ACP_MODEL_ID,
        mode: "agent",
        permissionPolicy: "allow-always",
        event: event => events.push(event),
    });
    const worker = runExternalWorker(fixture.env, { createDriver: () => driver, sleep: yieldToIO, activityHeartbeatMs: 1, idleClaimIntervalMs: 1 });
    let workerStopped = false;
    try {
        await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId)).activity.phase === "idle");
        const task = await createTask(root, fixture.meshId, fixture.agentId, { prompt: "hold", purpose: "synthetic purpose" }, { requesterEndpointId: `root:${fixture.meshId}` });
        await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId)).activity.phase === "confirming-stop");
        const during = await readAgentSnapshot(root, fixture.meshId, fixture.agentId, task.request.taskId);
        assert.equal(during.activity.acceptingTask, false);
        assert.equal(driver.exitObserved(), false);
        assert.ok(during.task && !["succeeded", "failed", "stopped"].includes(during.task.status.state));
        await waitUntil(() => driver.exitObserved());
        await worker;
        workerStopped = true;
        const after = await readAgentSnapshot(root, fixture.meshId, fixture.agentId, task.request.taskId);
        assert.equal(after.task?.result?.outcome, "failed");
        assert.match(after.task?.result?.error ?? "", /Unsupported blocking ACP request/u);
        assert.equal(after.status.state, "failed");
        assert.ok(events.some(event => event.type === "text"));
    } finally {
        if (!workerStopped) {
            await driver.shutdown().catch(() => {});
            await worker.catch(() => {});
        }
    }
}));

// Admission: a cancelled turn can still lose its prompt without a confirmed stopReason; finishing stopped then idle would reuse that child.
// Given a cancellation that the driver reports as unconfirmed termination, the worker retires failed/not-accepting instead of publishing idle.
void test("unconfirmed termination after task cancellation retires instead of publishing idle", async () => withTemporaryRoot("orchestration-external-cancel-unconfirmed-", async root => {
    const fixture = await externalFixture(root);
    let rejectTurn!: (error: Error) => void;
    const hung = new Promise<never>((_resolve, reject) => { rejectTurn = reject; });
    const driver: ExternalDriver = {
        async start() {},
        async runTask() { return hung; },
        async cancel() { rejectTurn(new UnconfirmedTerminationError("unconfirmed after cancel")); },
        async shutdown() {},
        waitForClose: () => new Promise(() => {}),
        fatalError: () => undefined,
        exitObserved: () => true,
    };
    const worker = runExternalWorker(fixture.env, { createDriver: () => driver, sleep: yieldToIO, activityHeartbeatMs: 1, idleClaimIntervalMs: 1 });
    let workerStopped = false;
    try {
        await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId)).activity.phase === "idle");
        const task = await createTask(root, fixture.meshId, fixture.agentId, { prompt: "cancel-unconfirmed", purpose: "synthetic purpose" }, { requesterEndpointId: `root:${fixture.meshId}` });
        await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId, task.request.taskId)).task?.status.state === "running");
        await requestTaskCancellation(root, fixture.meshId, task.request.taskId, "caller cancelled");
        await worker;
        workerStopped = true;
        const after = await readAgentSnapshot(root, fixture.meshId, fixture.agentId, task.request.taskId);
        assert.equal(after.task?.result?.outcome, "failed");
        assert.equal(after.status.state, "failed");
        assert.equal(after.activity.acceptingTask, false);
        await assert.rejects(createTask(root, fixture.meshId, fixture.agentId, { prompt: "must not reuse", purpose: "synthetic purpose" }, { requesterEndpointId: `root:${fixture.meshId}` }), /failed|not accepting|busy|stop request/iu);
    } finally {
        if (!workerStopped) {
            rejectTurn(new Error("test cleanup"));
            await worker.catch(() => {});
        }
    }
}));

// Admission: driver unit tests prove end_turn plus reuse-block, but they shut down immediately and cannot observe worker idle/admission; treating that fatal as AC9 unconfirmed drops a confirmed result and opens reuse.
// Given a matching end_turn while fatalError reports foreign/missing/late reuse-block, the caller observes the current task succeeded, no idle admission, and a retired child with the diagnostic.
void test("end_turn with reuse-block succeeds the task then retires without idle", async () => withTemporaryRoot("orchestration-external-end-turn-reuse-block-", async root => {
    const fixture = await externalFixture(root);
    let releaseExit!: () => void;
    const exitGate = new Promise<void>(resolve => { releaseExit = resolve; });
    let shutdownStarted = false;
    let exited = false;
    let runCount = 0;
    let reuseBlocked: Error | undefined;
    const diagnostic = "ACP session/update sessionId does not match the active session";
    const driver: ExternalDriver = {
        async start() {},
        async runTask() {
            runCount += 1;
            reuseBlocked = new UnconfirmedTerminationError(diagnostic);
            return { output: "cursor answer", stopReason: "end_turn" };
        },
        async cancel() {},
        async shutdown() { shutdownStarted = true; await exitGate; exited = true; },
        waitForClose: () => new Promise(() => {}),
        fatalError: () => reuseBlocked,
        exitObserved: () => exited,
    };
    const worker = runExternalWorker(fixture.env, { createDriver: () => driver, sleep: yieldToIO, activityHeartbeatMs: 1, idleClaimIntervalMs: 1 });
    let workerStopped = false;
    try {
        await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId)).activity.phase === "idle");
        const task = await createTask(root, fixture.meshId, fixture.agentId, { prompt: "complete", purpose: "synthetic purpose" }, { requesterEndpointId: `root:${fixture.meshId}` });
        await waitUntil(() => shutdownStarted);
        const during = await readAgentSnapshot(root, fixture.meshId, fixture.agentId, task.request.taskId);
        assert.equal(during.task?.result?.outcome, "succeeded");
        assert.equal(during.task?.result?.output, "cursor answer");
        assert.equal(during.task?.result?.error, undefined);
        assert.equal(during.status.state, "failed");
        assert.match(during.status.exitReason ?? "", /sessionId does not match/u);
        assert.equal(during.activity.acceptingTask, false);
        assert.notEqual(during.activity.phase, "idle");
        assert.equal(runCount, 1);
        await assert.rejects(createTask(root, fixture.meshId, fixture.agentId, { prompt: "must not reuse", purpose: "synthetic purpose" }, { requesterEndpointId: `root:${fixture.meshId}` }), /failed|not accepting|busy|stop request/iu);
        releaseExit();
        await worker;
        workerStopped = true;
        const after = await readAgentSnapshot(root, fixture.meshId, fixture.agentId, task.request.taskId);
        assert.equal(after.task?.result?.outcome, "succeeded");
        assert.equal(after.task?.result?.error, undefined);
        assert.equal(after.status.state, "failed");
        assert.match(after.status.exitReason ?? "", /sessionId does not match/u);
        assert.equal(after.activity.acceptingTask, false);
        assert.equal(after.activity.phase, "offline");
        assert.equal(runCount, 1);
        await assert.rejects(createTask(root, fixture.meshId, fixture.agentId, { prompt: "must not reuse retired", purpose: "synthetic purpose" }, { requesterEndpointId: `root:${fixture.meshId}` }), /failed|not accepting|busy|stop request/iu);
    } finally {
        if (!workerStopped) {
            releaseExit();
            await worker.catch(() => {});
        }
    }
}));

// Admission: SIGTERM is not Cursor exit; finishing the task before shutdown would publish a terminal receipt while the child may still run.
// Given SIGTERM during claim, activity publication, or an active turn, callers observe no terminal task before exit,
// no stale running publication after retirement, and no new driver task after stop. Gates make the startup races deterministic.
for (const stopAt of ["claim", "activity", "turn"] as const) void test(`signal stop does not finalize the task before driver exit (${stopAt})`, { timeout: 10_000 }, async () => withTemporaryRoot("orchestration-external-signal-stop-", async root => {
    const fixture = await externalFixture(root);
    let releaseExit!: () => void;
    const exitGate = new Promise<void>(resolve => { releaseExit = resolve; });
    let shutdownStarted = false;
    let exited = false;
    const hung = new Promise<never>(() => {});
    let releaseStart!: () => void;
    const startGate = new Promise<void>(resolve => { releaseStart = resolve; });
    let startPaused = false;
    let taskStarted = false;
    const driver: ExternalDriver = {
        async start() {},
        async runTask() { taskStarted = true; return hung; },
        async cancel() {},
        async shutdown() { shutdownStarted = true; await exitGate; exited = true; },
        waitForClose: () => new Promise(() => {}),
        fatalError: () => undefined,
        exitObserved: () => exited,
    };
    const worker = runExternalWorker(fixture.env, {
        createDriver: () => driver, sleep: yieldToIO, activityHeartbeatMs: 1, idleClaimIntervalMs: 1,
        claimPendingTask: async (...args) => {
            const task = await claimPendingTask(...args);
            if (task && stopAt === "claim") { startPaused = true; await startGate; }
            return task;
        },
        publishAgentActivity: async (...args) => {
            if (args[3].phase === "running" && stopAt === "activity") { startPaused = true; await startGate; }
            return publishAgentActivity(...args);
        },
    });
    // Attach immediately so a rejection while a gate is held is reported by this test, not as an unhandled rejection.
    void worker.catch(() => {});
    let workerStopped = false;
    try {
        await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId)).activity.phase === "idle");
        const task = await createTask(root, fixture.meshId, fixture.agentId, { prompt: "signal-stop", purpose: "synthetic purpose" }, { requesterEndpointId: `root:${fixture.meshId}` });
        await waitUntil(() => stopAt === "turn" ? taskStarted : startPaused);
        process.emit("SIGTERM");
        if (stopAt === "activity") {
            await yieldToIO();
            assert.equal(shutdownStarted, false, "stop drains the in-flight activity publication");
            releaseStart();
        }
        await waitUntil(() => shutdownStarted);
        const during = await readAgentSnapshot(root, fixture.meshId, fixture.agentId, task.request.taskId);
        assert.ok(during.task && !["succeeded", "failed", "stopped"].includes(during.task.status.state));
        assert.equal(during.activity.acceptingTask, false);
        releaseExit();
        if (stopAt === "claim") {
            await waitUntil(async () => (await readAgentSnapshot(root, fixture.meshId, fixture.agentId)).status.state === "failed");
            releaseStart();
        }
        await worker;
        workerStopped = true;
        assert.equal(taskStarted, stopAt === "turn");
        const after = await readAgentSnapshot(root, fixture.meshId, fixture.agentId, task.request.taskId);
        assert.equal(after.activity.phase, "offline");
        assert.ok(after.task && ["failed", "stopped"].includes(after.task.status.state));
        assert.notEqual(after.status.state, "busy");
        assert.notEqual(after.status.state, "idle");
    } finally {
        releaseStart();
        if (!workerStopped) {
            releaseExit();
            await worker.catch(() => {});
        }
    }
}));

// Admission: a replaced runtime must not persist a stop for the current child; types cannot observe the runtimeId guard.
void test("requestAgentStop expectedRuntimeId rejects a stale runtime before writing stop", async () => withTemporaryRoot("orchestration-external-stop-runtime-", async root => {
    const fixture = await externalFixture(root);
    const runtimeId = randomUUID();
    await bindAgentRuntime(root, fixture.meshId, fixture.agentId, { runtimeId, kind: "external" });
    await patchAgentStatus(root, fixture.meshId, fixture.agentId, { state: "idle", bridgeReady: true });
    await assert.rejects(requestAgentStop(root, fixture.meshId, fixture.agentId, { source: "recovery", reason: "stale runtime stop", expectedRuntimeId: randomUUID() }), /stale or unbound/u);
    assert.equal(await readAgentStopRequest(root, fixture.meshId, fixture.agentId), undefined);
    const created = await requestAgentStop(root, fixture.meshId, fixture.agentId, { source: "recovery", reason: "current runtime stop", expectedRuntimeId: runtimeId, terminalState: "failed" });
    assert.equal(created.created, true);
    assert.equal(created.status.state, "stopping");
    assert.equal(created.request.terminalState, "failed");
}));
