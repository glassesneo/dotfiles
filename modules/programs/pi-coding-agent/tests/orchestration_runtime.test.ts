import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Value } from "typebox/value";
import { createMeshEnableTool, createMeshGetTool, createMeshRunTool, createMeshStopTool, createMeshSubmitTool, createMeshWaitTool, registerOrchestration, stopPaletteMeshAgent, type ActiveCaller, type OrchestrationDependencies } from "../extensions_src/orchestration.ts";
import { AGENT_ARTIFACT_EXTENSION, buildLaunchEnvelope, settledAgentCatalog, settledAgentDefinition, settledMeshRoleSets, type AgentLaunchEnvelope, type OrchestrationConfig } from "../extensions_src/utilities/agent_types.ts";
import { bindMeshEndpoint, registerMeshSignal, registerMeshWatch } from "../extensions_src/utilities/orchestration_events.ts";
import { ACTIVE_MODE_EVENT } from "../extensions_src/utilities/mode_events.ts";
import { withMeshLock } from "../extensions_src/utilities/orchestration_lock.ts";
import { MESH_BOOTSTRAP_TOOL_NAME, MESH_PEER_TOOL_NAMES, piLaunchDescriptor } from "../extensions_src/utilities/orchestration_pi.ts";
import { claimTaskUsage, createTask, ensurePolicyEpoch, finishTask, initializeMesh, meshPaths, patchAgentStatus, prepareAgent, publishAgent, readAgentSnapshot, readPolicyEpoch, reserveMeshCapacity } from "../extensions_src/utilities/orchestration_store.ts";

const MESH_TOOLS = [...MESH_PEER_TOOL_NAMES];
const budgets = { maxLiveAgents: 4, maxConcurrentTasks: 4, maxTasksPerMesh: 16 };
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };
const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" };

async function withRoot(prefix: string, run: (root: string) => Promise<void>): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), prefix));
    try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function runtimeConfig(stateRoot: string): OrchestrationConfig {
    return { schemaVersion: 1, stateRoot, tmux: "/tmux", returnParentCommand: "/parent", parentNavigationHint: "parent", historyViewerExtension: "/history.ts", popupExtension: "/popup.ts", orchestrationExtension: "/orchestration.ts", childBridgeExtension: "/bridge.ts", harnesses: { pi: { adapter: "pi-native", command: "/pi" } }, natureHandleWords: ["May"], roleSets: settledMeshRoleSets(), budgets };
}

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

async function publishWorker(root: string, meshId: string, epochId: string) {
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
    registerTool(tool: any) { this.tools.set(tool.name, tool); if (!this.active.includes(tool.name)) this.active.push(tool.name); }
    getAllTools() { return [...this.tools.values()]; }
    getActiveTools() { return [...this.active]; }
    setActiveTools(names: string[]) { this.active = [...names]; }
    registerCommand() {}
    appendEntry() {}
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

void test("root registration exposes exactly six mesh tools while only child registration exposes mesh_enable", async () => withRoot("mesh-registration-", async root => {
    const files = await writeRuntimeFiles(root);
    const keybindings = await writeMeshKeybindings(root);
    const previous = process.env.PI_EXTENSION_KEYBINDINGS_PATH;
    process.env.PI_EXTENSION_KEYBINDINGS_PATH = keybindings;
    try {
        const rootPi = new PiMock();
        await registerOrchestration(rootPi as never, { ...files, env: {} });
        assert.deepEqual([...rootPi.tools.keys()].sort(), [...MESH_TOOLS].sort());
        assert.deepEqual(rootPi.active.sort(), [...MESH_TOOLS].sort());
        const childPi = new PiMock();
        await registerOrchestration(childPi as never, { ...files, env: { PI_MESH_AGENT_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } });
        assert.deepEqual([...childPi.tools.keys()].sort(), [...MESH_TOOLS, "mesh_enable"].sort());
        assert.equal(Value.Check(childPi.tools.get("mesh_enable").parameters, {}), true);
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

void test("manual mesh activation is additive and idempotent and persists success only after all six tools are active", async () => {
    const pi = new PiMock();
    for (const name of MESH_TOOLS) pi.registerTool({ name });
    pi.active = ["read", "save_agent_artifact"];
    let persisted = 0;
    const epoch = { schemaVersion: 1, meshId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", epochId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", mode: "ops", roleSet: [], roles: {}, policyDigest: "", createdAt: new Date().toISOString() } as const;
    const deps = { configPath: "/unused", env: {}, exec: absentTmux, activeCaller: () => caller(epoch.meshId, epoch as never, { agentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }) };
    const enable = createMeshEnableTool(pi as never, deps, async () => { persisted += 1; });
    const first = await enable.execute("enable", {}, undefined, undefined, {} as never);
    const second = await enable.execute("enable-again", {}, undefined, undefined, {} as never);
    assert.deepEqual(pi.active, ["read", "save_agent_artifact", ...MESH_TOOLS]);
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
    assert.deepEqual(pi.active, [...settledAgentDefinition("worker").tools, MESH_BOOTSTRAP_TOOL_NAME]);

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
    assert.deepEqual(pi.active, [...settledAgentDefinition("worker").tools, MESH_BOOTSTRAP_TOOL_NAME, ...MESH_TOOLS]);
    assert.equal((await readAgentSnapshot(root, mesh.meshId, worker.agentId, task.request.taskId)).task?.interventions.length, 0);
    assert.equal((await readAgentSnapshot(root, mesh.meshId, worker.agentId)).status.meshToolsEnabled, true);
    assert.deepEqual(notifications, []); assert.equal(statuses.some(([key]) => key === "mesh-event-pump"), false);
    await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

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

void test("failed pre-publication cleanup retains prepared capacity when process death cannot be confirmed", async () => withRoot("mesh-launch-cleanup-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const files = await writeRuntimeFiles(root); let cleanupInspection = false;
    const exec = async (_command: string, args: string[]) => { if (args.includes("display-message") && args.at(-1)?.includes("#{session_id}")) return { stdout: "10\t$root\tmain\t@root\t%root\tclient\n", stderr: "", code: 0 }; if (args.at(-1) === "#{pid}") return cleanupInspection ? { stdout: "", stderr: "temporary inspection failure", code: 2 } : { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("has-session")) return { stdout: "", stderr: "missing", code: 1 }; if (args.includes("new-session")) return { stdout: "$hub\t@agent\t%agent\n", stderr: "", code: 0 }; if (args.includes("@pi_mesh_schema")) { cleanupInspection = true; return { stdout: "", stderr: "metadata write failed", code: 2 }; } return { stdout: "", stderr: "", code: 0 }; };
    const deps = { ...files, env: { TMUX: "/tmp/tmux,1,0" }, exec, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops" }) }; const ctx = { cwd: root, sessionManager: { getSessionId: () => "root", getSessionFile: () => undefined } } as never;
    await assert.rejects(createMeshSubmitTool(deps, { worker: settledAgentDefinition("worker") }).execute("launch", { agent: "worker", prompt: "work" }, undefined, undefined, ctx), /cleanup.*remains incomplete/iu);
    const paths = meshPaths(root, mesh.meshId); const reservations = await readdir(paths.reservations); const agents = await readdir(paths.agents); assert.equal(reservations.length, 1); assert.equal(agents.length, 1); const reservation = JSON.parse(await readFile(join(paths.reservations, reservations[0]!), "utf8")) as { state: string }; assert.equal(reservation.state, "committed");
}));

void test("palette stop waits for the pending mode epoch before authorizing the mutation", async () => withRoot("mesh-palette-barrier-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const ops = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, ops.epochId); const recon = await ensurePolicyEpoch(root, mesh.meshId, { mode: "recon", roleSet: ["explorer"], roles: { explorer: settledAgentDefinition("explorer") } }); let current = caller(mesh.meshId, ops, { identity: "mode:ops" }); let release!: () => void; const barrier = new Promise<void>(resolve => { release = () => { current = caller(mesh.meshId, recon, { identity: "mode:recon" }); resolve(); }; }); let execCalls = 0; const deps = { configPath: "/unused", env: {}, exec: async () => { execCalls += 1; return { stdout: "", stderr: "", code: 1 }; }, activeCaller: () => current, authorityBarrier: () => barrier };
    const stopped = assert.rejects(stopPaletteMeshAgent(deps, runtimeConfig(root), { meshId: mesh.meshId, agentId: worker.agentId }), /not allowed to stop role worker/u); release(); await stopped; assert.equal(execCalls, 0);
}));

void test("a tool execution waits for the pending root mode epoch before applying mutation authority", async () => withRoot("mesh-mode-barrier-", async root => {
    const sessionFile = join(root, "root-session.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root-session", rootSessionFile: sessionFile, recoverable: true, budgets }); const ops = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, ops.epochId); const files = await writeRuntimeFiles(root); const keybindings = await writeMeshKeybindings(root); const previous = process.env.PI_EXTENSION_KEYBINDINGS_PATH; process.env.PI_EXTENSION_KEYBINDINGS_PATH = keybindings;
    const branch = [{ type: "custom", customType: "mesh-root-binding", data: { schemaVersion: 1, meshId: mesh.meshId } }]; const ctx = { cwd: root, sessionManager: { getSessionId: () => "root-session", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { notify() {}, setStatus() {} }, isIdle: () => true } as never;
    try {
        const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env: {} }); await pi.handlers.get("session_start")![0]!({}, ctx);
        let unlock!: () => void; let acquired!: () => void; const acquiredPromise = new Promise<void>(resolve => { acquired = resolve; }); const gate = new Promise<void>(resolve => { unlock = resolve; }); const held = withMeshLock(root, mesh.meshId, async () => { acquired(); await gate; }); await acquiredPromise;
        pi.events.emit(ACTIVE_MODE_EVENT, { schemaVersion: 1, name: "recon", reason: "switch", mode: { model: "openai/recon", description: "Recon", thinkingLevel: "low", allowAllTools: false, tools: ["read"], skillOptIns: [], instructions: "Inspect." } });
        let settled = false; const execution = pi.tools.get("mesh_submit").execute("mode-race", { agentId: worker.agentId, prompt: "must use narrowed epoch" }, undefined, undefined, ctx).finally(() => { settled = true; }); const rejected = assert.rejects(execution, /not allowed to reuse role worker/u); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(settled, false); unlock(); await held; await rejected; await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
    } finally { if (previous === undefined) delete process.env.PI_EXTENSION_KEYBINDINGS_PATH; else process.env.PI_EXTENSION_KEYBINDINGS_PATH = previous; }
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
    assert.deepEqual(launchTools(launch), [MESH_BOOTSTRAP_TOOL_NAME, ...MESH_TOOLS]);
    const union = launchTools(launchFor(["read", "mesh_route", "read", MESH_BOOTSTRAP_TOOL_NAME]));
    assert.deepEqual(union, ["read", "mesh_route", MESH_BOOTSTRAP_TOOL_NAME, ...MESH_TOOLS.filter(name => name !== "mesh_route")]);
    assert.equal(new Set(union).size, union.length);
});
