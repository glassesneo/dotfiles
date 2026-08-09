import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Value } from "typebox/value";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createMeshEnableTool, createMeshGetTool, createMeshRunTool, createMeshStopTool, createMeshSubmitTool, createMeshWaitTool, registerOrchestration, stopPaletteMeshAgent, type ActiveCaller, type OrchestrationDependencies } from "../extensions_src/orchestration.ts";
import { AGENT_ARTIFACT_EXTENSION, WEB_FETCH_EXTENSION, WEB_SEARCH_EXTENSION, buildLaunchEnvelope, settledAgentCatalog, settledAgentDefinition, settledMeshGcConfig, settledMeshRoleSets, validateOrchestrationConfig, type AgentLaunchEnvelope, type OrchestrationConfig } from "../extensions_src/utilities/agent_types.ts";
import { availableContext, publishAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { bindAgentRuntime, readAgentRuntimeBinding } from "../extensions_src/utilities/orchestration_runtime.ts";
import { bindMeshEndpoint, readMeshEndpoint, registerMeshSignal, registerMeshWatch, setMeshEndpointOffline } from "../extensions_src/utilities/orchestration_events.ts";
import { createExplicitStopNotice, listPendingTuiNotices } from "../extensions_src/utilities/orchestration_notices.ts";
import { readPressureAdmission, requestPressureAdmission } from "../extensions_src/utilities/orchestration_admission.ts";
import { ACTIVE_MODE_EVENT } from "../extensions_src/utilities/mode_events.ts";
import { withMeshLock } from "../extensions_src/utilities/orchestration_lock.ts";
import { MESH_BOOTSTRAP_TOOL_NAME, MESH_PEER_TOOL_NAMES, piLaunchDescriptor } from "../extensions_src/utilities/orchestration_pi.ts";
import { claimTaskUsage, createTask, ensurePolicyEpoch, finishTask, initializeMesh, meshPaths, patchAgentStatus, prepareAgent, publishAgent, readAgentSnapshot, readPolicyEpoch, reserveMeshCapacity } from "../extensions_src/utilities/orchestration_store.ts";

const MESH_TOOLS = [...MESH_PEER_TOOL_NAMES];
const REQUIRED_PEER_CAPABILITIES = ["mesh_run", "mesh_submit", "mesh_get", "mesh_wait", "mesh_stop", "mesh_route"] as const;
const budgets = { maxLiveAgents: 4, maxConcurrentTasks: 4, maxTasksPerMesh: 16 };
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };
const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" };

async function withRoot(prefix: string, run: (root: string) => Promise<void>): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), prefix));
    try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function runtimeConfig(stateRoot: string): OrchestrationConfig {
    return { schemaVersion: 2, stateRoot, tmux: "/tmux", returnParentCommand: "/parent", parentNavigationHint: "parent", historyViewerExtension: "/history.ts", popupExtension: "/popup.ts", orchestrationExtension: "/orchestration.ts", childBridgeExtension: "/bridge.ts", harnesses: { pi: { adapter: "pi-native", command: "/pi" } }, natureHandleWords: ["May"], roleSets: settledMeshRoleSets(), budgets, gc: settledMeshGcConfig() };
}

void test("schema-v2 orchestration policy accepts coherent role hysteresis and rejects unsafe thresholds", () => {
    const config = runtimeConfig("/state");
    assert.deepEqual(validateOrchestrationConfig(config).gc, config.gc);
    const unsafe = structuredClone(config);
    unsafe.gc.roles.worker!.pressureFloor = unsafe.gc.roles.worker!.retain + 1;
    assert.throws(() => validateOrchestrationConfig(unsafe), /collectAt >= retain >= pressureFloor/u);
    assert.throws(() => validateOrchestrationConfig({ ...config, schemaVersion: 1 }), /schemaVersion/u);
});

async function writeRuntimeFiles(root: string) {
    const configPath = join(root, "orchestration.json");
    const catalogPath = join(root, "catalog.json");
    await writeFile(configPath, JSON.stringify(runtimeConfig(root)));
    await writeFile(catalogPath, JSON.stringify(settledAgentCatalog()));
    return { configPath, catalogPath };
}

async function writeMeshKeybindings(root: string): Promise<string> {
    const current = JSON.parse(await readFile(join(import.meta.dirname, "fixtures/extension-keybindings.json"), "utf8")) as { schemaVersion: 1; features: Record<string, Record<string, string[]>> };
    current.features.meshNavigation = { parent: ["ctrl+o"] };
    const path = join(root, "keybindings.json");
    await writeFile(path, JSON.stringify(current));
    return path;
}

async function publishWorker(root: string, meshId: string, epochId: string, options: { activity?: boolean } = {}) {
    const definition = settledAgentDefinition("worker");
    const reservation = await reserveMeshCapacity(root, meshId, "new-agent-task");
    const prepared = await prepareAgent(root, meshId, { reservationId: reservation.reservationId, agent: "worker", harness: "pi", cwd: root, agentSnapshot: definition, launchEnvelope: "pending", epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    const epoch = await readPolicyEpoch(root, meshId, epochId);
    const childExtensions = Object.fromEntries(epoch.roleSet.map(name => [name, ["/popup.ts", "/orchestration.ts", ...epoch.roles[name]!.childExtensionContributions, "/bridge.ts"]]));
    const envelope = buildLaunchEnvelope({ meshId, agentId: prepared.agentId, epochId, agent: "worker", mode: epoch.mode, roleSet: epoch.roleSet, catalog: settledAgentCatalog(), childExtensions });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(envelope), { mode: 0o600 });
    await publishAgent(root, meshId, prepared.paths, { agentId: prepared.agentId, epochId, agent: "worker", harness: "pi", cwd: root, agentSnapshot: definition, launchEnvelope: envelopePath, tmux, capabilities, creatorSessionId: "creator" });
    await patchAgentStatus(root, meshId, prepared.agentId, { state: "idle", bridgeReady: true });
    if (options.activity !== false) { const runtimeId = randomUUID(); await bindAgentRuntime(root, meshId, prepared.agentId, { runtimeId, kind: "external" }); const now = new Date().toISOString(); await publishAgentActivity(root, meshId, prepared.agentId, { runtimeId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: now, observedAt: now, heartbeatAt: now, context: availableContext(10, 100_000, 100) }); }
    return { ...prepared, envelope, envelopePath };
}

function caller(meshId: string, epoch: ActiveCaller["epoch"], overrides: Partial<ActiveCaller> = {}): ActiveCaller {
    return { identity: "agent:explorer", meshId, epoch, catalog: settledAgentCatalog(), endpointId: "agent:caller", ...overrides };
}

const absentTmux = async () => ({ stdout: "", stderr: "no server running", code: 1 });

class PiMock {
    readonly tools = new Map<string, any>();
    readonly handlers = new Map<string, Array<(...args: any[]) => unknown>>();
    readonly eventHandlers = new Map<string, Array<(value: unknown) => unknown>>();
    readonly events = { on: (name: string, handler: (value: unknown) => unknown) => { const values = this.eventHandlers.get(name) ?? []; values.push(handler); this.eventHandlers.set(name, values); return () => {}; }, emit: (name: string, value: unknown) => { for (const handler of this.eventHandlers.get(name) ?? []) handler(value); return true; } };
    active: string[] = [];
    messages: Array<{ message: unknown; options: unknown }> = [];
    entries: Array<{ customType: string; data: unknown }> = [];
    entryRenderers = new Map<string, (...args: any[]) => unknown>();
    registerTool(tool: any) { this.tools.set(tool.name, tool); if (!this.active.includes(tool.name)) this.active.push(tool.name); }
    getAllTools() { return [...this.tools.values()]; }
    getActiveTools() { return [...this.active]; }
    setActiveTools(names: string[]) { this.active = [...names]; }
    registerCommand() {}
    registerEntryRenderer(customType: string, renderer: (...args: any[]) => unknown) { this.entryRenderers.set(customType, renderer); }
    appendEntry(customType: string, data: unknown) { this.entries.push({ customType, data }); }
    sendMessage(message: unknown, options: unknown) { this.messages.push({ message, options }); }
    exec = async () => ({ stdout: "", stderr: "", code: 1 });
    on(name: string, handler: (...args: any[]) => unknown) { const values = this.handlers.get(name) ?? []; values.push(handler); this.handlers.set(name, values); }
}

void test("core tool schemas and execution require exactly one selector at each single-target boundary", async () => {
    const targets = { worker: settledAgentDefinition("worker") };
    const inactive = () => undefined;
    const deps = { configPath: "/missing", env: {}, exec: absentTmux, activeCaller: inactive } as OrchestrationDependencies;
    const run = createMeshRunTool(deps, targets);
    const submit = createMeshSubmitTool(deps, targets);
    assert.equal(Value.Check(run.parameters, { agent: "worker", prompt: "work" }), true);
    assert.equal(Value.Check(submit.parameters, { agentId: "agent-id", prompt: "work" }), true);
    assert.equal(Value.Check(run.parameters, { agent: "unknown", prompt: "work" }), false);
    await assert.rejects(run.execute("call", { agent: "worker", agentId: "id", prompt: "work" }, undefined, undefined, {} as never), /exactly one/u);
    await assert.rejects(createMeshGetTool(deps).execute("call", { taskId: "task", agentId: "agent" }, undefined, undefined, {} as never), /exactly one/u);
    await assert.rejects(createMeshStopTool(deps).execute("call", {}, undefined, undefined, {} as never), /exactly one/u);
    await assert.rejects(createMeshStopTool(deps).execute("call", { taskId: "task", reason: "must not alter task-stop semantics" }, undefined, undefined, {} as never), /taskId rejects reason/u);
});

void test("same-mesh peers get and wait on tasks outside their epoch while reuse and stop remain epoch-bound", async () => withRoot("mesh-authority-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const workerEpoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
    const worker = await publishWorker(root, mesh.meshId, workerEpoch.epochId);
    const task = await createTask(root, mesh.meshId, worker.agentId, "mesh-wide observation");
    await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "observed" });
    const observerEpoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "recon", roleSet: ["explorer"], roles: { explorer: settledAgentDefinition("explorer") } });
    const files = await writeRuntimeFiles(root);
    const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, observerEpoch), sleep: async () => {} };
    const got = await createMeshGetTool(deps).execute("get", { taskId: task.request.taskId }, undefined, undefined, {} as never);
    assert.equal((got.details as any).task.result.output, "observed");
    const waited = await createMeshWaitTool(deps).execute("wait", { taskIds: [task.request.taskId], condition: "all" }, undefined, undefined, {} as never);
    assert.equal((waited.details as any).outcome, "completed");
    await assert.rejects(createMeshRunTool(deps, { explorer: settledAgentDefinition("explorer") }).execute("reuse", { agentId: worker.agentId, prompt: "not authorized" }, undefined, undefined, {} as never), /not allowed to reuse role worker/u);
    await assert.rejects(createMeshStopTool(deps).execute("stop", { agentId: worker.agentId }, undefined, undefined, {} as never), /not allowed to stop role worker/u);
}));

void test("existing-agent submit rejects conservative unknown activity without creating a task", async () => withRoot("mesh-reuse-activity-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId, { activity: false }); const files = await writeRuntimeFiles(root); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops" }) };
    await assert.rejects(createMeshSubmitTool(deps, { worker: settledAgentDefinition("worker") }).execute("submit", { agentId: worker.agentId, prompt: "must not reroute" }, undefined, undefined, { cwd: root } as never), /not accepting tasks.*activity=unknown/iu);
    assert.deepEqual(await readdir(meshPaths(root, mesh.meshId).tasks), []);
}));

void test("a child cannot wait on its own active task or stop its own agent process", async () => withRoot("mesh-self-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
    const worker = await publishWorker(root, mesh.meshId, epoch.epochId);
    const task = await createTask(root, mesh.meshId, worker.agentId, "active self task");
    const files = await writeRuntimeFiles(root);
    const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "agent:worker", agentId: worker.agentId }), sleep: async () => {} };
    await assert.rejects(createMeshWaitTool(deps).execute("wait", { taskIds: [task.request.taskId], condition: "all" }, undefined, undefined, {} as never), /own active task/u);
    await assert.rejects(createMeshStopTool(deps).execute("stop", { agentId: worker.agentId }, undefined, undefined, {} as never), /calling agent itself/u);
}));

void test("root and child registration expose peer capabilities while only children receive mesh_enable", async () => withRoot("mesh-registration-", async root => {
    const files = await writeRuntimeFiles(root);
    const keybindings = await writeMeshKeybindings(root);
    const previous = process.env.PI_EXTENSION_KEYBINDINGS_PATH;
    process.env.PI_EXTENSION_KEYBINDINGS_PATH = keybindings;
    try {
        const rootPi = new PiMock();
        await registerOrchestration(rootPi as never, { ...files, env: {} });
        for (const name of REQUIRED_PEER_CAPABILITIES) {
            assert.equal(rootPi.tools.has(name), true, `root registered ${name}`);
            assert.equal(rootPi.active.includes(name), true, `root activated ${name}`);
        }
        assert.equal(new Set(rootPi.active).size, rootPi.active.length);
        assert.equal(rootPi.tools.has("mesh_enable"), false);
        const childPi = new PiMock();
        await registerOrchestration(childPi as never, { ...files, env: { PI_MESH_AGENT_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } });
        for (const name of REQUIRED_PEER_CAPABILITIES) {
            assert.equal(childPi.tools.has(name), true, `child registered ${name}`);
            assert.equal(childPi.active.includes(name), true, `child activated ${name}`);
        }
        assert.equal(new Set(childPi.active).size, childPi.active.length);
        assert.equal(Value.Check(childPi.tools.get("mesh_enable").parameters, {}), true);
        assert.equal(childPi.active.includes("mesh_enable"), true);
        assert.equal(Value.Check(childPi.tools.get("mesh_enable").parameters, { legacy: true }), false);
    } finally { if (previous === undefined) delete process.env.PI_EXTENSION_KEYBINDINGS_PATH; else process.env.PI_EXTENSION_KEYBINDINGS_PATH = previous; }
}));

void test("a fresh root session silently ignores retained v1 state without modifying it", async () => withRoot("mesh-retained-v1-", async root => {
    const stateRoot = join(root, "orchestration-v2");
    const legacyRoot = join(root, "orchestration-v1");
    const marker = join(legacyRoot, "retained.json");
    await mkdir(legacyRoot, { recursive: true });
    await writeFile(marker, "retained");
    const configPath = join(root, "orchestration.json");
    const catalogPath = join(root, "catalog.json");
    const sessionFile = join(root, "session.jsonl");
    await writeFile(configPath, JSON.stringify(runtimeConfig(stateRoot)));
    await writeFile(catalogPath, JSON.stringify(settledAgentCatalog()));
    await writeFile(sessionFile, "");
    const keybindings = await writeMeshKeybindings(root);
    const previous = process.env.PI_EXTENSION_KEYBINDINGS_PATH;
    process.env.PI_EXTENSION_KEYBINDINGS_PATH = keybindings;
    const notifications: string[] = [];
    const ctx = { sessionManager: { getSessionId: () => "root-session", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { notify(text: string) { notifications.push(text); }, setStatus() {} }, isIdle: () => true } as never;
    try {
        const pi = new PiMock();
        await registerOrchestration(pi as never, { configPath, catalogPath, env: {}, setInterval() { return "timer"; }, clearInterval() {} });
        await pi.handlers.get("session_start")![0]!({}, ctx);
        assert.deepEqual(notifications, []);
        assert.equal(await readFile(marker, "utf8"), "retained");
        await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
    } finally { if (previous === undefined) delete process.env.PI_EXTENSION_KEYBINDINGS_PATH; else process.env.PI_EXTENSION_KEYBINDINGS_PATH = previous; }
}));

void test("a fresh Researcher bootstrap activates mesh_run additively and persists only complete activation", async () => {
    const pi = new PiMock();
    for (const name of MESH_TOOLS) pi.registerTool({ name });
    const bootstrapTools = [...settledAgentDefinition("researcher").tools, MESH_BOOTSTRAP_TOOL_NAME];
    pi.active = [...bootstrapTools];
    assert.equal(pi.active.includes(MESH_BOOTSTRAP_TOOL_NAME), true);
    assert.equal(pi.active.includes("mesh_run"), false);
    let persisted = 0;
    const epoch = { schemaVersion: 1, meshId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", epochId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", mode: "ops", roleSet: [], roles: {}, policyDigest: "", createdAt: "2026-01-01T00:00:00.000Z" } as const;
    const deps = { configPath: "/unused", env: {}, exec: absentTmux, activeCaller: () => caller(epoch.meshId, epoch as never, { agentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }) };
    const enable = createMeshEnableTool(pi as never, deps, async () => { persisted += 1; });
    const first = await enable.execute("enable", {}, undefined, undefined, {} as never);
    const second = await enable.execute("enable-again", {}, undefined, undefined, {} as never);
    assert.equal(pi.active.includes(MESH_BOOTSTRAP_TOOL_NAME), true);
    assert.equal(pi.active.includes("mesh_run"), true);
    assert.equal(new Set(pi.active).size, pi.active.length);
    assert.deepEqual((first.details as any).activeTools, pi.active);
    assert.deepEqual((second.details as any).activeTools, pi.active);
    assert.equal(persisted, 2);
    pi.tools.delete("mesh_route");
    await assert.rejects(enable.execute("incomplete", {}, undefined, undefined, {} as never), /not registered.*mesh_route/u);
    assert.equal(persisted, 2);
});

void test("post-start steer and followUp signals auto-enable a narrowed child and become durable injected custom messages", async () => withRoot("mesh-post-start-signals-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
    const worker = await publishWorker(root, mesh.meshId, epoch.epochId);
    const task = await createTask(root, mesh.meshId, worker.agentId, "active child task");
    const files = await writeRuntimeFiles(root); const sessionFile = join(root, "child-session.jsonl"); await writeFile(sessionFile, "");
    const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: worker.agentId, PI_AGENT_RESOLVED_AGENT: worker.envelopePath };
    const statuses: Array<[string, string | undefined]> = []; const notifications: string[] = [];
    const ctx = { sessionManager: { getSessionId: () => "child-session", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus(key: string, text: string | undefined) { statuses.push([key, text]); }, notify(text: string) { notifications.push(text); } }, isIdle: () => false } as never;
    let tick!: () => Promise<void>; const pi = new PiMock();
    await registerOrchestration(pi as never, { ...files, env, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} });
    await pi.handlers.get("session_start")![0]!({}, ctx);
    assert.equal(pi.active.includes(MESH_BOOTSTRAP_TOOL_NAME), true);
    assert.equal(pi.active.includes("mesh_run"), false);

    const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${worker.agentId}`, kind: "agent", agentId: worker.agentId, harness: "pi", sessionId: "child-session", sessionFile });
    for (const delivery of ["steer", "followUp"] as const) {
        const signal = await registerMeshSignal(root, mesh.meshId, { callerEndpointId: `root:${mesh.meshId}`, toolCallId: `inbound-${delivery}`, endpoint, delivery, topic: delivery, text: `Deliver ${delivery}`, canonicalArguments: { action: "signal", receiver: worker.agentId, delivery, topic: delivery, text: `Deliver ${delivery}` } });
        await tick();
        const received = pi.messages.at(-1)!;
        assert.equal((received.message as { customType: string }).customType, "mesh-event");
        assert.deepEqual(received.options, { deliverAs: delivery, triggerTurn: false });
        const persisted = JSON.parse(await readFile(join(meshPaths(root, mesh.meshId).events, `${signal.eventId}.json`), "utf8")) as { state: string };
        assert.equal(persisted.state, "injected");
    }
    assert.equal(pi.active.includes("mesh_run"), true);
    assert.equal(pi.active.includes("mesh_route"), true);
    assert.equal(new Set(pi.active).size, pi.active.length);
    assert.equal((await readAgentSnapshot(root, mesh.meshId, worker.agentId, task.request.taskId)).task?.interventions.length, 0);
    assert.equal((await readAgentSnapshot(root, mesh.meshId, worker.agentId)).status.meshToolsEnabled, true);
    assert.deepEqual(notifications, []); assert.equal(statuses.some(([key]) => key === "mesh-event-pump"), false);
    await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Given an offline endpoint-targeted notice, when a newly bound TUI session starts, the user observes a durable entry and notification without any model-visible message; non-TUI polling leaves later notices pending.
void test("the TUI notice pump validates the live binding and never injects model context", async () => withRoot("mesh-tui-notice-pump-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "notice-session.jsonl"); await writeFile(sessionFile, ""); const endpointId = `agent:${worker.agentId}`;
    await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "agent", agentId: worker.agentId, harness: "pi", sessionId: "offline-session", sessionFile: join(root, "offline.jsonl") }); await setMeshEndpointOffline(root, mesh.meshId, endpointId);
    const first = await createExplicitStopNotice(root, mesh.meshId, { endpointId, requesterEndpointId: `root:${mesh.meshId}`, payload: { stopRequestId: randomUUID(), agentId: randomUUID(), role: "reviewer", source: "peer", reason: "parent-visible stop" } }); assert.ok(first);
    const notifications: string[] = []; const ctx: any = { mode: "tui", sessionManager: { getSessionId: () => "notice-session", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify(text: string) { notifications.push(text); } }, isIdle: () => true };
    let tick!: () => Promise<void>; const pi = new PiMock(); const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: worker.agentId, PI_AGENT_RESOLVED_AGENT: worker.envelopePath }; await registerOrchestration(pi as never, { ...files, env, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx);
    assert.equal(pi.entries.length, 1); assert.equal(pi.entries[0]!.customType, "mesh-tui-notice"); assert.match(notifications.join("\n"), /parent-visible stop/u); assert.deepEqual(pi.messages, []); assert.deepEqual(await listPendingTuiNotices(root, mesh.meshId, { endpointId }), []);
    const renderer = pi.entryRenderers.get("mesh-tui-notice")!; const component = renderer({ data: pi.entries[0]!.data }, { expanded: true }, { fg: (_role: string, text: string) => text }); for (const line of (component as { render(width: number): string[] }).render(24)) assert.ok(visibleWidth(line) <= 24);
    const second = await createExplicitStopNotice(root, mesh.meshId, { endpointId, requesterEndpointId: `root:${mesh.meshId}`, payload: { stopRequestId: randomUUID(), agentId: randomUUID(), role: "worker", source: "peer", reason: "stay pending outside TUI" } }); assert.ok(second); ctx.mode = "rpc"; await tick(); assert.equal((await listPendingTuiNotices(root, mesh.meshId, { endpointId })).length, 1); assert.equal(pi.entries.length, 1); await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "agent", agentId: worker.agentId, harness: "pi", sessionId: "replacement-session", sessionFile: join(root, "replacement.jsonl") }); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" }); assert.equal((await readMeshEndpoint(root, mesh.meshId, endpointId)).online, true);
}));

// Given two orchestration extension generations for the same durable child session, when each session_start crosses runtime binding, the second rotates once and fences callbacks holding the first generation.
void test("same-session reload rotates the Pi runtime once and fences the old generation", async () => withRoot("mesh-runtime-reload-", async root => { const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "same-session.jsonl"); await writeFile(sessionFile, ""); const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: worker.agentId, PI_AGENT_RESOLVED_AGENT: worker.envelopePath }; const ctx = { sessionManager: { getSessionId: () => "same-session", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => true } as never; const firstPi = new PiMock(); await registerOrchestration(firstPi as never, { ...files, env, setInterval() { return "first"; }, clearInterval() {} }); await firstPi.handlers.get("session_start")![0]!({}, ctx); const first = await readAgentRuntimeBinding(root, mesh.meshId, worker.agentId); assert.ok(first); const secondPi = new PiMock(); await registerOrchestration(secondPi as never, { ...files, env, setInterval() { return "second"; }, clearInterval() {} }); await secondPi.handlers.get("session_start")![0]!({}, ctx); const second = await readAgentRuntimeBinding(root, mesh.meshId, worker.agentId); assert.ok(second); assert.notEqual(second.runtimeId, first.runtimeId); const now = new Date().toISOString(); await assert.rejects(publishAgentActivity(root, mesh.meshId, worker.agentId, { runtimeId: first.runtimeId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: now, observedAt: now, heartbeatAt: now, context: availableContext(1, 100, 10) }), /stale or unbound/u); await publishAgentActivity(root, mesh.meshId, worker.agentId, { runtimeId: second.runtimeId, phase: "starting", acceptingTask: false, pendingMessages: false, phaseSince: now, observedAt: now, heartbeatAt: now, context: availableContext(1, 100, 10) }); await Promise.all([firstPi.handlers.get("session_shutdown")![0]!({ reason: "reload" }), secondPi.handlers.get("session_shutdown")![0]!({ reason: "reload" })]); }));

// Given a notice whose UI notification fails, when timer polling retries, the timer remains contained, the notice stays pending, and already-rendered output is not duplicated before recovery acknowledges it.
void test("notice pump contains failures, deduplicates presentation, and retains pending delivery", async () => withRoot("mesh-notice-failure-", async root => { const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "notice-failure.jsonl"); await writeFile(sessionFile, ""); const endpointId = `agent:${worker.agentId}`; const notice = await createExplicitStopNotice(root, mesh.meshId, { endpointId, requesterEndpointId: `root:${mesh.meshId}`, payload: { stopRequestId: randomUUID(), agentId: randomUUID(), role: "worker", source: "peer", reason: "retry display" } }); assert.ok(notice); let fail = true; const diagnostics: string[] = []; const ctx: any = { mode: "tui", sessionManager: { getSessionId: () => "notice-failure", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify(text: string) { if (fail && text.includes("retry display")) throw new Error("notice UI unavailable"); diagnostics.push(text); } }, isIdle: () => true }; let tick!: () => Promise<void>; const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env: { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: worker.agentId, PI_AGENT_RESOLVED_AGENT: worker.envelopePath }, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); await tick(); assert.equal(pi.entries.length, 1); assert.equal((await listPendingTuiNotices(root, mesh.meshId, { endpointId })).length, 1); assert.equal(diagnostics.filter(text => text.includes("notice UI unavailable")).length, 1); fail = false; await tick(); assert.equal(pi.entries.length, 1); assert.deepEqual(await listPendingTuiNotices(root, mesh.meshId, { endpointId }), []); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" }); }));

void test("a post-start watch injects exactly one completion after its task becomes terminal", async () => withRoot("mesh-post-start-watch-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const task = await createTask(root, mesh.meshId, worker.agentId, "finish after watch"); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "watch-session.jsonl"); await writeFile(sessionFile, ""); const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: worker.agentId, PI_AGENT_RESOLVED_AGENT: worker.envelopePath }; const ctx = { sessionManager: { getSessionId: () => "watch-session", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => true } as never;
    let tick!: () => Promise<void>; const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx);
    const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${worker.agentId}`, kind: "agent", agentId: worker.agentId, harness: "pi", sessionId: "watch-session", sessionFile }); const watch = await registerMeshWatch(root, mesh.meshId, { callerEndpointId: `root:${mesh.meshId}`, toolCallId: "watch", endpoint, delivery: "followUp", taskIds: [task.request.taskId], condition: "all", canonicalArguments: { action: "watch", receiver: worker.agentId, delivery: "followUp", taskIds: [task.request.taskId], condition: "all" } }); assert.equal(watch.eventId, undefined); await tick(); assert.equal(pi.messages.length, 0);
    await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "done" }); await tick(); await tick(); assert.equal(pi.messages.length, 1); assert.equal((pi.messages[0]!.options as { deliverAs: string }).deliverAs, "followUp"); assert.match(JSON.stringify(pi.messages[0]!.message), /completion/u); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

void test("repeated activation failures retain pending events, deduplicate diagnostics, and clear status after recovery", async () => withRoot("mesh-pump-diagnostic-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "diagnostic-session.jsonl"); await writeFile(sessionFile, ""); const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: worker.agentId, PI_AGENT_RESOLVED_AGENT: worker.envelopePath }; const statuses: Array<[string, string | undefined]> = []; const notifications: string[] = []; const ctx = { sessionManager: { getSessionId: () => "diagnostic-session", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus(key: string, text: string | undefined) { statuses.push([key, text]); }, notify(text: string) { notifications.push(text); } }, isIdle: () => true } as never;
    let tick!: () => Promise<void>; const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); const routeTool = pi.tools.get("mesh_route"); pi.tools.delete("mesh_route"); const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${worker.agentId}`, kind: "agent", agentId: worker.agentId, harness: "pi", sessionId: "diagnostic-session", sessionFile }); const signal = await registerMeshSignal(root, mesh.meshId, { callerEndpointId: `root:${mesh.meshId}`, toolCallId: "diagnostic", endpoint, delivery: "steer", topic: "recover", text: "Retry later", canonicalArguments: { action: "signal", receiver: worker.agentId, delivery: "steer", topic: "recover", text: "Retry later" } });
    await tick(); await tick(); const eventPath = join(meshPaths(root, mesh.meshId).events, `${signal.eventId}.json`); assert.equal((JSON.parse(await readFile(eventPath, "utf8")) as { state: string }).state, "pending"); assert.equal(notifications.length, 1); assert.match(notifications[0]!, /mesh_route/u); assert.equal(statuses.filter(([key, text]) => key === "mesh-event-pump" && text !== undefined).length, 1);
    pi.tools.set("mesh_route", routeTool); await tick(); assert.equal((JSON.parse(await readFile(eventPath, "utf8")) as { state: string }).state, "injected"); assert.equal(pi.messages.length, 1); assert.deepEqual(statuses.at(-1), ["mesh-event-pump", undefined]); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

void test("session shutdown fences an in-flight event pump before message injection", async () => withRoot("mesh-pump-shutdown-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "shutdown-session.jsonl"); await writeFile(sessionFile, ""); const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: worker.agentId, PI_AGENT_RESOLVED_AGENT: worker.envelopePath }; const ctx = { sessionManager: { getSessionId: () => "shutdown-session", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => true } as never;
    let tick!: () => Promise<void>; const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${worker.agentId}`, kind: "agent", agentId: worker.agentId, harness: "pi", sessionId: "shutdown-session", sessionFile }); const signal = await registerMeshSignal(root, mesh.meshId, { callerEndpointId: `root:${mesh.meshId}`, toolCallId: "shutdown", endpoint, delivery: "steer", topic: "shutdown", text: "Do not inject after shutdown", canonicalArguments: { action: "signal", receiver: worker.agentId, delivery: "steer", topic: "shutdown", text: "Do not inject after shutdown" } });
    let unlock!: () => void; let acquired!: () => void; const acquiredPromise = new Promise<void>(resolve => { acquired = resolve; }); const gate = new Promise<void>(resolve => { unlock = resolve; }); const held = withMeshLock(root, mesh.meshId, async () => { acquired(); await gate; }); await acquiredPromise;
    const ticking = tick(); await Promise.resolve(); const shuttingDown = pi.handlers.get("session_shutdown")![0]!({ reason: "reload" }); unlock(); await Promise.all([held, ticking, shuttingDown]);
    assert.equal(pi.messages.length, 0); const eventPath = join(meshPaths(root, mesh.meshId).events, `${signal.eventId}.json`); assert.equal((JSON.parse(await readFile(eventPath, "utf8")) as { state: string }).state, "pending");
}));

// Given a root maintenance pass held across shutdown, when reload crosses the lifecycle boundary, shutdown aborts and awaits that pass before cancelling open admissions.
void test("root shutdown quiesces a held maintenance pass before admission cancellation", async () => withRoot("mesh-root-pass-shutdown-", async root => { const sessionFile = join(root, "root-session.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root-session", rootSessionFile: sessionFile, recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const requester = await publishWorker(root, mesh.meshId, epoch.epochId); const requesterRuntime = randomUUID(); await bindAgentRuntime(root, mesh.meshId, requester.agentId, { runtimeId: requesterRuntime, kind: "external" }); await patchAgentStatus(root, mesh.meshId, requester.agentId, { state: "busy" }); const requestId = randomUUID(); await requestPressureAdmission(root, mesh.meshId, { requestId, requesterAgentId: requester.agentId, requesterRuntimeId: requesterRuntime }); const files = await writeRuntimeFiles(root); const branch = [{ type: "custom", customType: "mesh-root-binding", data: { schemaVersion: 1, meshId: mesh.meshId } }]; const ctx = { sessionManager: { getSessionId: () => "root-session", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { notify() {}, setStatus() {} }, isIdle: () => true } as never; let tick!: () => Promise<void>; const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env: {}, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); let unlock!: () => void; let acquired!: () => void; const acquiredPromise = new Promise<void>(resolve => { acquired = resolve; }); const gate = new Promise<void>(resolve => { unlock = resolve; }); const held = withMeshLock(root, mesh.meshId, async () => { acquired(); await gate; }); await acquiredPromise;
    const ticking = tick(); await Promise.resolve(); let shutdownDone = false; const shutdown = Promise.resolve(pi.handlers.get("session_shutdown")![0]!({ reason: "reload" })).finally(() => { shutdownDone = true; }); await Promise.resolve(); assert.equal(shutdownDone, false); unlock(); await Promise.all([held, ticking, shutdown]); assert.equal((await readPressureAdmission(root, mesh.meshId, requestId)).state, "cancelled"); }));

void test("failed pre-publication cleanup retains prepared capacity when process death cannot be confirmed", async () => withRoot("mesh-launch-cleanup-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const files = await writeRuntimeFiles(root); let cleanupInspection = false;
    const exec = async (_command: string, args: string[]) => { if (args.includes("display-message") && args.at(-1)?.includes("#{session_id}")) return { stdout: "10\t$root\tmain\t@root\t%root\tclient\n", stderr: "", code: 0 }; if (args.at(-1) === "#{pid}") return cleanupInspection ? { stdout: "", stderr: "temporary inspection failure", code: 2 } : { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("has-session")) return { stdout: "", stderr: "missing", code: 1 }; if (args.includes("new-session")) return { stdout: "$hub\t@agent\t%agent\n", stderr: "", code: 0 }; if (args.includes("@pi_mesh_schema")) { cleanupInspection = true; return { stdout: "", stderr: "metadata write failed", code: 2 }; } return { stdout: "", stderr: "", code: 0 }; };
    const deps = { ...files, env: { TMUX: "/tmp/tmux,1,0" }, exec, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops" }) }; const ctx = { cwd: root, sessionManager: { getSessionId: () => "root", getSessionFile: () => undefined } } as never;
    await assert.rejects(createMeshSubmitTool(deps, { worker: settledAgentDefinition("worker") }).execute("launch", { agent: "worker", prompt: "work" }, undefined, undefined, ctx), /cleanup.*remains incomplete/iu);
    const paths = meshPaths(root, mesh.meshId); const reservations = await readdir(paths.reservations); const agents = await readdir(paths.agents); assert.equal(reservations.length, 1); assert.equal(agents.length, 1); const reservation = JSON.parse(await readFile(join(paths.reservations, reservations[0]!), "utf8")) as { state: string }; assert.equal(reservation.state, "committed");
}));

// Given a published launch whose bridge never becomes ready, when normal launch cleanup crosses durable stop and tmux termination, callers observe the launch error while recovery state records a confirmed failed lifecycle with that reason.
void test("published launch failure durably confirms a failed agent outcome", async () => withRoot("mesh-published-launch-failure-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const files = await writeRuntimeFiles(root); let clock = -6000;
    const exec = async (_command: string, args: string[]) => { if (args.includes("display-message") && args.at(-1)?.includes("#{session_id}")) return { stdout: "10\t$root\tmain\t@root\t%root\tclient\n", stderr: "", code: 0 }; if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("has-session")) return { stdout: "", stderr: "missing", code: 1 }; if (args.includes("new-session")) return { stdout: "$hub\t@agent\t%agent\n", stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; };
    const deps = { ...files, env: { TMUX: "/tmp/tmux,1,0" }, exec, now: () => clock += 6000, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops" }) }; const ctx = { cwd: root, sessionManager: { getSessionId: () => "root", getSessionFile: () => undefined } } as never;
    await assert.rejects(createMeshSubmitTool(deps, { worker: settledAgentDefinition("worker") }).execute("launch", { agent: "worker", prompt: "work" }, undefined, undefined, ctx), /bridge readiness timed out/iu);
    const agentIds = await readdir(meshPaths(root, mesh.meshId).agents); assert.equal(agentIds.length, 1); const failed = await readAgentSnapshot(root, mesh.meshId, agentIds[0]!); assert.deepEqual({ lifecycle: failed.status.state, reason: failed.status.exitReason, stop: failed.stop?.state, terminalState: failed.stop?.terminalState }, { lifecycle: "failed", reason: "Agent bridge readiness timed out", stop: "confirmed", terminalState: "failed" });
}));

void test("palette stop waits for the pending mode epoch before authorizing the mutation", async () => withRoot("mesh-palette-barrier-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const ops = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, ops.epochId); const recon = await ensurePolicyEpoch(root, mesh.meshId, { mode: "recon", roleSet: ["explorer"], roles: { explorer: settledAgentDefinition("explorer") } }); let current = caller(mesh.meshId, ops, { identity: "mode:ops" }); let release!: () => void; const barrier = new Promise<void>(resolve => { release = () => { current = caller(mesh.meshId, recon, { identity: "mode:recon" }); resolve(); }; }); let execCalls = 0; const deps = { configPath: "/unused", env: {}, exec: async () => { execCalls += 1; return { stdout: "", stderr: "", code: 1 }; }, activeCaller: () => current, authorityBarrier: () => barrier };
    const stopped = assert.rejects(stopPaletteMeshAgent(deps, runtimeConfig(root), { meshId: mesh.meshId, agentId: worker.agentId, reason: "mode-authorized stop" }), /not allowed to stop role worker/u); release(); await stopped; assert.equal(execCalls, 0);
}));

// Given a registered root orchestration runtime and an ops-authorized submit, when a real recon mode event crosses the pending epoch-commit boundary, the tool caller observes recon rejection without any pre-commit task mutation.
void test("a tool execution waits for the pending root mode epoch before applying mutation authority", async () => withRoot("mesh-mode-barrier-", async root => {
    const sessionFile = join(root, "root-session.jsonl");
    await writeFile(sessionFile, "");
    const mesh = await initializeMesh(root, { rootSessionId: "root-session", rootSessionFile: sessionFile, recoverable: true, budgets });
    const ops = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
    const worker = await publishWorker(root, mesh.meshId, ops.epochId);
    const files = await writeRuntimeFiles(root);
    const keybindings = await writeMeshKeybindings(root);
    const previous = process.env.PI_EXTENSION_KEYBINDINGS_PATH;
    process.env.PI_EXTENSION_KEYBINDINGS_PATH = keybindings;
    const branch = [{ type: "custom", customType: "mesh-root-binding", data: { schemaVersion: 1, meshId: mesh.meshId } }];
    const ctx = { cwd: root, sessionManager: { getSessionId: () => "root-session", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { notify() {}, setStatus() {} }, isIdle: () => true } as never;
    try {
        let signalAuthorityPending!: () => void;
        const authorityPending = new Promise<void>(resolve => { signalAuthorityPending = resolve; });
        const pi = new PiMock();
        await registerOrchestration(pi as never, { ...files, env: {}, onAuthorityWait: signalAuthorityPending });
        await pi.handlers.get("session_start")![0]!({}, ctx);

        let releaseCommit!: () => void;
        let commitHeld!: () => void;
        const commitHeldSignal = new Promise<void>(resolve => { commitHeld = resolve; });
        const commitRelease = new Promise<void>(resolve => { releaseCommit = resolve; });
        const heldCommit = withMeshLock(root, mesh.meshId, async () => { commitHeld(); await commitRelease; });
        await commitHeldSignal;

        pi.events.emit(ACTIVE_MODE_EVENT, { schemaVersion: 1, name: "recon", reason: "switch", mode: { model: "openai/recon", description: "Recon", thinkingLevel: "low", allowAllTools: false, tools: ["read"], skillOptIns: [], instructions: "Inspect." } });
        let settled = false;
        const execution = pi.tools.get("mesh_submit").execute("mode-race", { agentId: worker.agentId, prompt: "must use narrowed epoch" }, undefined, undefined, ctx).finally(() => { settled = true; });
        await authorityPending;

        assert.equal(settled, false);
        assert.deepEqual(await readdir(meshPaths(root, mesh.meshId).tasks), []);

        releaseCommit();
        await heldCommit;
        await assert.rejects(execution, /not allowed to reuse role worker/u);
        assert.deepEqual(await readdir(meshPaths(root, mesh.meshId).tasks), []);
        await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
    } finally {
        if (previous === undefined) delete process.env.PI_EXTENSION_KEYBINDINGS_PATH;
        else process.env.PI_EXTENSION_KEYBINDINGS_PATH = previous;
    }
}));

void test("persisted root startup reconciles an unpersisted usage claim before tools can observe it", async () => withRoot("mesh-root-usage-reconcile-", async root => {
    const sessionFile = join(root, "root-session.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root-session", rootSessionFile: sessionFile, recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const task = await createTask(root, mesh.meshId, worker.agentId, "account once"); await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "done" }); assert.equal((await claimTaskUsage(root, mesh.meshId, task.request.taskId, sessionFile, "lost-call", "mesh_get")).created, true);
    const files = await writeRuntimeFiles(root); const keybindings = await writeMeshKeybindings(root); const previous = process.env.PI_EXTENSION_KEYBINDINGS_PATH; process.env.PI_EXTENSION_KEYBINDINGS_PATH = keybindings; const branch = [{ type: "custom", customType: "mesh-root-binding", data: { schemaVersion: 1, meshId: mesh.meshId } }]; const ctx = { sessionManager: { getSessionId: () => "root-session", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { notify() {}, setStatus() {} }, isIdle: () => true } as never;
    try { const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env: {} }); await pi.handlers.get("session_start")![0]!({}, ctx); assert.equal((await claimTaskUsage(root, mesh.meshId, task.request.taskId, sessionFile, "recovered-call", "mesh_get")).created, true); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" }); }
    finally { if (previous === undefined) delete process.env.PI_EXTENSION_KEYBINDINGS_PATH; else process.env.PI_EXTENSION_KEYBINDINGS_PATH = previous; }
}));

void test("native child launch manifests order popup, orchestration, role contributions, and bridge", () => {
    const catalog = settledAgentCatalog();
    const meshId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const agentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const epochId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const roleSet = ["reviewer"];
    const manifest = ["/popup.ts", "/orchestration.ts", AGENT_ARTIFACT_EXTENSION, "/bridge.ts"];
    const envelope: AgentLaunchEnvelope = buildLaunchEnvelope({ meshId, agentId, epochId, agent: "reviewer", mode: "ops", roleSet, catalog, childExtensions: { reviewer: manifest } });
    const launchFor = (tools: string[]) => piLaunchDescriptor(runtimeConfig("/state"), { meshId, agentId, agentDirectory: `/state/meshes/${meshId}/agents/${agentId}`, agent: "reviewer", taskPath: "/task", launchEnvelope: "/envelope.json", epochSnapshot: { ...envelope, self: { ...envelope.self, tools } } });
    const launch = launchFor([]);
    assert.deepEqual(launch.args.filter((value, index) => launch.args[index - 1] === "-e"), manifest);
    assert.ok(!launch.args.includes("--mode") && !launch.args.includes("--profile") && !launch.args.includes("--no-tools"));
    const launchTools = (value: ReturnType<typeof launchFor>) => value.args[value.args.indexOf("--tools") + 1]!.split(",");
    const bootstrap = launchTools(launch);
    assert.equal(bootstrap.includes(MESH_BOOTSTRAP_TOOL_NAME), true);
    for (const name of REQUIRED_PEER_CAPABILITIES) assert.equal(bootstrap.includes(name), true, `bootstrap includes ${name}`);
    assert.equal(new Set(bootstrap).size, bootstrap.length);
    const union = launchTools(launchFor(["read", "mesh_route", "read", MESH_BOOTSTRAP_TOOL_NAME]));
    assert.equal(union.includes("read"), true);
    assert.equal(union.includes(MESH_BOOTSTRAP_TOOL_NAME), true);
    for (const name of REQUIRED_PEER_CAPABILITIES) assert.equal(union.includes(name), true, `tool union includes ${name}`);
    assert.equal(new Set(union).size, union.length);
});

void test("researcher catalog and native launch project retrieval capabilities without expanding another child", () => {
    const catalog = settledAgentCatalog();
    const researcher = settledAgentDefinition("researcher");
    assert.equal(researcher.tools.includes("web_search"), true);
    assert.equal(researcher.tools.includes("web_fetch"), true);
    assert.equal(researcher.skillOptIns.includes("web-research"), true);
    for (const roles of Object.values(settledMeshRoleSets())) assert.ok(roles.includes("researcher"));

    const meshId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const agentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const epochId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const roleSet = ["researcher", "worker"];
    const childExtensions = {
        researcher: ["/popup.ts", "/orchestration.ts", WEB_SEARCH_EXTENSION, WEB_FETCH_EXTENSION, "/bridge.ts"],
        worker: ["/popup.ts", "/orchestration.ts", "/bridge.ts"],
    };
    const launch = (agent: "researcher" | "worker") => {
        const envelope = buildLaunchEnvelope({ meshId, agentId, epochId, agent, mode: "ops", roleSet, catalog, childExtensions });
        return piLaunchDescriptor(runtimeConfig("/state"), { meshId, agentId, agentDirectory: `/state/meshes/${meshId}/agents/${agentId}`, agent, taskPath: "/task", launchEnvelope: "/envelope.json", epochSnapshot: envelope });
    };
    const researcherLaunch = launch("researcher");
    const researcherLaunchTools = researcherLaunch.args[researcherLaunch.args.indexOf("--tools") + 1]!.split(",");
    assert.deepEqual(researcherLaunch.args.filter((value, index) => researcherLaunch.args[index - 1] === "-e"), childExtensions.researcher);
    assert.equal(researcherLaunchTools.includes("web_search"), true);
    assert.equal(researcherLaunchTools.includes("web_fetch"), true);
    assert.equal(researcherLaunchTools.includes(MESH_BOOTSTRAP_TOOL_NAME), true);
    assert.deepEqual(launch("worker").args.filter((value, index, args) => args[index - 1] === "-e"), childExtensions.worker);
});
