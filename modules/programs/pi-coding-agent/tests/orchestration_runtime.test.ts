import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Value } from "typebox/value";
import { visibleWidth } from "@earendil-works/pi-tui";
import { activateMeshPeerToolsForSend, createMeshGetTool, createMeshReportTool, createMeshSendTool, createMeshStopTool, createMeshWaitTool, registerOrchestration, stopPaletteMeshAgent, type ActiveCaller, type OrchestrationDependencies } from "../extensions_src/orchestration.ts";
import { buildLaunchEnvelope as buildLaunchEnvelopeV4, buildPolicySnapshot, validateOrchestrationConfig, type AgentLaunchEnvelope, type CallPolicy, type OrchestrationConfig, type RoleCatalog, type RoleDefinition } from "../extensions_src/utilities/agent_types.ts";
import type { ExecutionProfileConfig } from "../extensions_src/utilities/mode_types.ts";
import { availableContext, publishAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { bindAgentRuntime, readAgentRuntimeBinding } from "../extensions_src/utilities/orchestration_runtime.ts";
import { bindMeshEndpoint, materializeMeshCompletionEvents, readEndpointDeliverySnapshot, readMeshEndpoint, resolveRouteEndpoint, setMeshEndpointOffline } from "../extensions_src/utilities/orchestration_events.ts";
import { createExplicitStopNotice, listPendingTuiNotices } from "../extensions_src/utilities/orchestration_notices.ts";
import { readPressureAdmission, requestPressureAdmission } from "../extensions_src/utilities/orchestration_admission.ts";
import { createCompletionReceipt, readCompletionLedger } from "../extensions_src/utilities/orchestration_completion.ts";
import { withMeshLock } from "../extensions_src/utilities/orchestration_lock.ts";
import { MESH_PEER_TOOL_NAMES, piLaunchDescriptor } from "../extensions_src/utilities/orchestration_pi.ts";
import { MAX_MODEL_VISIBLE_BYTES, MAX_MODEL_VISIBLE_LINES, projectMeshCompletionContext, receiptIdsFromToolResults, serializeModelVisibleJson } from "../extensions_src/utilities/orchestration_projection.ts";
import { attachRootMesh, claimTaskUsage, createTask as createTaskStore, ensurePolicyEpoch as ensurePolicyEpochStore, finishTask, initializeMesh, meshPaths, patchAgentStatus, prepareAgent, publishAgent, readAgentSnapshot, readPolicyEpoch, readTask, reconcileMeshUsageClaims, reserveMeshCapacity, taskPaths } from "../extensions_src/utilities/orchestration_store.ts";
import type { AgentSnapshot } from "../extensions_src/utilities/orchestration_types.ts";
import { FakeMonotonicTimers, eventually, withTemporaryRoot as withRoot } from "./test_helpers.ts";

const MESH_TOOLS = [...MESH_PEER_TOOL_NAMES];
const REQUIRED_PEER_CAPABILITIES = ["mesh_send", "mesh_get", "mesh_wait", "mesh_stop", "mesh_report"] as const;
const AGENT_ARTIFACT_EXTENSION = "/agent_artifact.ts";
const budgets = { maxLiveAgents: 4, maxConcurrentTasks: 4, maxTasksPerMesh: 16 };
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };
const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" };
const profiles: ExecutionProfileConfig = { schemaVersion: 1, profiles: { "pi-default": { model: "openai/test", thinkingLevel: "medium", harness: "pi" }, "cursor-write": { model: "cursor/test", harness: "cursor-agent", harnessOptions: { mode: "agent", permissionPolicy: "allow-always", sandbox: "disabled", trustWorkspace: true, worktree: false } } } };
const role = (name: string): RoleDefinition => ({ description: `Synthetic ${name}`, tools: ["read"], instructions: `Perform ${name}.`, contextPolicy: name === "gyaru" ? "prompt-only" : "project", childExtensionContributions: name === "reviewer" ? [AGENT_ARTIFACT_EXTENSION] : [] });
const catalog: RoleCatalog = { schemaVersion: 4, roles: Object.fromEntries(["explorer", "worker", "validator", "reviewer", "review-lens", "researcher", "searcher", "gyaru"].map(name => [name, role(name)])) };
const callPolicy: CallPolicy = {
    modes: {
        ops: { targets: { worker: { profiles: ["pi-default", "cursor-write"] }, reviewer: { profiles: ["pi-default"] }, researcher: { profiles: ["pi-default"] } } },
        recon: { targets: { explorer: { profiles: ["pi-default"] }, reviewer: { profiles: ["pi-default"] }, researcher: { profiles: ["pi-default"] } } },
    },
    roles: {
        reviewer: { targets: { "review-lens": { profiles: ["pi-default"] }, validator: { profiles: ["pi-default"] } } },
        researcher: { targets: { searcher: { profiles: ["pi-default"] } } },
    },
};
function settledAgentCatalog(): RoleCatalog { return structuredClone(catalog); }
function settledAgentDefinition(name: string): RoleDefinition { return structuredClone(catalog.roles[name] ?? role(name)); }
function settledMeshGcConfig() { return { contextHeadroomTokens: 32768, periodicIntervalMs: 5000, activityHeartbeatMs: 2000, activityStaleMs: 10000, roles: Object.fromEntries(Object.keys(catalog.roles).map(name => [name, { collectAt: 2, retain: 1, pressureFloor: 0 }])) }; }
async function ensurePolicyEpoch(stateRoot: string, meshId: string, input: { mode: string; roleSet: string[]; roles: Record<string, RoleDefinition> }) { const localCatalog = { schemaVersion: 4 as const, roles: input.roles }; const localPolicy: CallPolicy = { modes: { [input.mode]: { targets: Object.fromEntries(input.roleSet.map(name => [name, { profiles: ["pi-default"] }])) } }, roles: Object.fromEntries(Object.keys(input.roles).map(name => [name, callPolicy.roles[name] ?? { targets: {} }])) }; return ensurePolicyEpochStore(stateRoot, meshId, { mode: input.mode, catalog: localCatalog, profiles, callPolicy: localPolicy }); }
function createTask(stateRoot: string, meshId: string, agentId: string, message: string) { return createTaskStore(stateRoot, meshId, agentId, message, `root:${meshId}`); }
function buildLaunchEnvelope(input: { meshId: string; agentId: string; epochId: string; agent: string; mode: string; roleSet: string[]; catalog: RoleCatalog; childExtensions: Record<string, string[]> }): AgentLaunchEnvelope { const policy: CallPolicy = { modes: { [input.mode]: { targets: Object.fromEntries(input.roleSet.map(name => [name, { profiles: ["pi-default"] }])) } }, roles: Object.fromEntries(input.roleSet.map(name => [name, callPolicy.roles[name] ?? { targets: {} }])) }; const snapshot = buildPolicySnapshot({ mode: input.mode, catalog: input.catalog, profiles, callPolicy: policy }); const childExtensions = Object.fromEntries(Object.keys(snapshot.roles).map(name => [name, input.childExtensions[name] ?? []])); return buildLaunchEnvelopeV4({ meshId: input.meshId, agentId: input.agentId, epochId: input.epochId, role: input.agent, selectedProfile: "pi-default", snapshot, childExtensions }); }

function runtimeConfig(stateRoot: string): OrchestrationConfig {
    return { schemaVersion: 4, stateRoot, tmux: "/tmux", returnParentCommand: "/parent", parentNavigationHint: "parent", historyViewerExtension: "/history.ts", popupExtension: "/popup.ts", orchestrationExtension: "/orchestration.ts", childBridgeExtension: "/bridge.ts", harnesses: { pi: { adapter: "pi-native", command: "/pi" }, "cursor-agent": { adapter: "cursor-acp", command: "/cursor", workerCommand: "/node", workerEntrypoint: "/worker.ts" } }, natureHandleWords: ["May"], callPolicy, budgets, gc: settledMeshGcConfig() };
}

void test("schema-v4 orchestration policy accepts coherent role hysteresis and rejects unsafe thresholds", () => {
    const config = runtimeConfig("/state");
    assert.deepEqual(validateOrchestrationConfig(config).gc, config.gc);
    const unsafe = structuredClone(config);
    unsafe.gc.roles.worker!.pressureFloor = unsafe.gc.roles.worker!.retain + 1;
    assert.throws(() => validateOrchestrationConfig(unsafe), /hysteresis/u);
    assert.throws(() => validateOrchestrationConfig({ ...config, schemaVersion: 2 }), /schemaVersion/u);
});

// Admission: source-level completion projection is the model-visible exactly-once boundary; schemas cannot detect regrouped duplicates, stale frontiers, or partial receipt filtering.
// Given repeated sources in different bundles and a newer frontier, projection emits one canonical current view, filters received/completed pending IDs, and rejects conflicting source payloads.
void test("completion context projection deduplicates sources across bundles and keeps the newest frontier", () => {
    const firstEvent = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; const secondEvent = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const firstTask = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; const secondTask = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; const thirdTask = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const firstAgent = "11111111-1111-4111-8111-111111111111"; const secondAgent = "22222222-2222-4222-8222-222222222222"; const thirdAgent = "33333333-3333-4333-8333-333333333333";
    const sourceOne = { eventId: firstEvent, batchId: "44444444-4444-4444-8444-444444444444", settledAt: "2026-01-01T00:00:00.000Z", tasks: [{ taskId: firstTask, agentId: firstAgent, state: "succeeded" as const }] };
    const sourceTwo = { eventId: secondEvent, batchId: "55555555-5555-4555-8555-555555555555", settledAt: "2026-01-01T00:00:01.000Z", tasks: [{ taskId: secondTask, agentId: secondAgent, state: "failed" as const }] };
    const first = { role: "custom", customType: "mesh-event", content: "stale", details: { kind: "completion", sources: [sourceOne], frontier: { observedAt: "2026-01-01T00:00:00.500Z", pendingTasks: [{ taskId: secondTask, agentId: secondAgent, state: "running" as const }] } } };
    const second = { role: "custom", customType: "mesh-event", content: "newer", details: { kind: "completion", sources: [structuredClone(sourceOne), sourceTwo], frontier: { observedAt: "2026-01-01T00:00:02.000Z", pendingTasks: [{ taskId: firstTask, agentId: firstAgent, state: "running" as const }, { taskId: thirdTask, agentId: thirdAgent, state: "created" as const }] } } };
    const receiptId = "66666666-6666-4666-8666-666666666666"; const receipt = { role: "toolResult", toolName: "mesh_get", details: { accounting: { receiptIds: [receiptId], receivedTaskIds: [firstTask], claimedTaskIds: [] } } };
    const question = { role: "toolResult", toolName: "question", details: { answers: [{ id: "choice" }] } };
    const signal = { role: "custom", customType: "mesh-event", content: "signal", details: { eventId: "77777777-7777-4777-8777-777777777777", kind: "signal", payload: { topic: "x" } } };
    assert.deepEqual(receiptIdsFromToolResults([receipt]), [receiptId]);
    const projected = projectMeshCompletionContext([first, question, receipt, second, signal], new Set([firstTask]));
    assert.deepEqual(projected.eventIds, [firstEvent, secondEvent]);
    assert.deepEqual(projected.messages.slice(0, 2), [question, receipt]); assert.equal(projected.messages.at(-1), signal);
    const canonical = projected.messages[2] as typeof second; const content = JSON.parse(canonical.content) as { tasks: Array<{ taskId: string }>; pendingTasks: Array<{ taskId: string }> };
    assert.deepEqual(content.tasks.map(task => task.taskId), [secondTask]); assert.deepEqual(content.pendingTasks.map(task => task.taskId), [thirdTask]);
    const conflicting = structuredClone(second); conflicting.details.sources[0]!.tasks[0]!.state = "failed";
    assert.throws(() => projectMeshCompletionContext([first, conflicting], new Set()), /Conflicting duplicate/u);
    const legacy = { ...first, details: { eventId: firstEvent, kind: "completion", payload: sourceOne } };
    assert.throws(() => projectMeshCompletionContext([legacy], new Set()), /Malformed mesh completion/u);
});

// Admission: completion identity loss at the serialization boundary would make retrieval impossible; ordinary type checks do not observe truncation.
// Given the default 256-task completion and concurrent frontier budgets, serialization preserves every task identity within Pi's model-visible limits.
void test("completion metadata remains lossless at the default mesh budget", () => {
    const ids = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(8, "0") + "-aaaa-4aaa-8aaa-" + index.toString(16).padStart(12, "0"));
    const agents = Array.from({ length: 256 }, (_, index) => (index + 256).toString(16).padStart(8, "0") + "-bbbb-4bbb-8bbb-" + (index + 256).toString(16).padStart(12, "0"));
    const value = { tasks: ids.map((taskId, index) => ({ taskId, agentId: agents[index], state: "succeeded" })), pendingTasks: ids.slice(0, 20).map((taskId, index) => ({ taskId: taskId.replace("-aaaa-", "-cccc-"), agentId: agents[index], state: "running" })) };
    const text = serializeModelVisibleJson(value); const parsed = JSON.parse(text) as typeof value;
    assert.ok(Buffer.byteLength(text, "utf8") <= MAX_MODEL_VISIBLE_BYTES); assert.ok(text.split(/\r\n|\r|\n/u).length <= MAX_MODEL_VISIBLE_LINES);
    assert.deepEqual(parsed.tasks.map(task => task.taskId), value.tasks.map(task => task.taskId)); assert.deepEqual(parsed.pendingTasks.map(task => task.taskId), value.pendingTasks.map(task => task.taskId));
});

async function writeRuntimeFiles(root: string) {
    const configPath = join(root, "orchestration.json");
    const catalogPath = join(root, "role-catalog.json");
    const profilePath = join(root, "execution-profiles.json");
    const modePath = join(root, "agent-modes.json");
    await writeFile(configPath, JSON.stringify(runtimeConfig(root)));
    await writeFile(catalogPath, JSON.stringify(settledAgentCatalog()));
    await writeFile(profilePath, JSON.stringify(profiles));
    await writeFile(modePath, JSON.stringify({ schemaVersion: 2, defaultMode: "recon", modes: Object.fromEntries(["recon", "ops"].map(name => [name, { description: name, defaultProfile: "pi-default", tools: ["read"], skillOptIns: [], instructions: `Use ${name}.` }])) }));
    return { configPath, catalogPath, profilePath, modePath };
}

async function writeMeshKeybindings(root: string): Promise<string> {
    const current = JSON.parse(await readFile(join(import.meta.dirname, "fixtures/extension-keybindings.json"), "utf8")) as { schemaVersion: 1; features: Record<string, Record<string, string[]>> };
    current.features.meshNavigation = { parent: ["ctrl+o"] };
    const path = join(root, "keybindings.json");
    await writeFile(path, JSON.stringify(current));
    return path;
}

async function publishWorker(root: string, meshId: string, epochId: string, options: { activity?: boolean; parentAgentId?: string; role?: string } = {}) {
    const roleName = options.role ?? "worker"; const definition = settledAgentDefinition(roleName);
    const reservation = await reserveMeshCapacity(root, meshId, "new-agent-task");
    const prepared = await prepareAgent(root, meshId, { reservationId: reservation.reservationId, role: roleName, selectedProfile: "pi-default", harness: "pi", cwd: root, roleSnapshot: definition, profileSnapshot: profiles.profiles["pi-default"]!, launchEnvelope: "pending", epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    const epoch = await readPolicyEpoch(root, meshId, epochId);
    const childExtensions = Object.fromEntries(Object.keys(epoch.roles).map(name => [name, ["/popup.ts", "/orchestration.ts", ...epoch.roles[name]!.childExtensionContributions, "/bridge.ts"]]));
    const envelope = buildLaunchEnvelopeV4({ meshId, agentId: prepared.agentId, epochId, role: roleName, selectedProfile: "pi-default", authorizedProfiles: ["pi-default"], snapshot: epoch, childExtensions });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(envelope), { mode: 0o600 });
    await publishAgent(root, meshId, prepared.paths, { agentId: prepared.agentId, epochId, role: roleName, selectedProfile: "pi-default", harness: "pi", cwd: root, roleSnapshot: definition, profileSnapshot: profiles.profiles["pi-default"]!, launchEnvelope: envelopePath, tmux, capabilities, ...(options.parentAgentId ? { parentAgentId: options.parentAgentId } : {}), creatorSessionId: "creator" });
    await patchAgentStatus(root, meshId, prepared.agentId, { state: "idle", bridgeReady: true });
    if (options.activity !== false) { const runtimeId = randomUUID(); await bindAgentRuntime(root, meshId, prepared.agentId, { runtimeId, kind: "external" }); const now = new Date().toISOString(); await publishAgentActivity(root, meshId, prepared.agentId, { runtimeId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: now, observedAt: now, heartbeatAt: now, context: availableContext(10, 100_000, 100) }); }
    return { ...prepared, envelope, envelopePath };
}

function caller(meshId: string, epoch: ActiveCaller["epoch"], overrides: Partial<ActiveCaller> = {}): ActiveCaller {
    const agentId = overrides.agentId; return { identity: "mode:ops", meshId, epoch, catalog: settledAgentCatalog(), ...overrides, endpointId: overrides.endpointId ?? (agentId ? `agent:${agentId}` : `root:${meshId}`) };
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
    messageRenderers = new Map<string, (...args: any[]) => unknown>();
    registerTool(tool: any) { this.tools.set(tool.name, tool); if (!this.active.includes(tool.name)) this.active.push(tool.name); }
    getAllTools() { return [...this.tools.values()]; }
    getActiveTools() { return [...this.active]; }
    setActiveTools(names: string[]) { this.active = [...names]; }
    registerCommand() {}
    registerEntryRenderer(customType: string, renderer: (...args: any[]) => unknown) { this.entryRenderers.set(customType, renderer); }
    registerMessageRenderer(customType: string, renderer: (...args: any[]) => unknown) { this.messageRenderers.set(customType, renderer); }
    appendEntry(customType: string, data: unknown) { this.entries.push({ customType, data }); }
    sendMessage(message: unknown, options: unknown) { this.messages.push({ message, options }); }
    exec = async () => ({ stdout: "", stderr: "", code: 1 });
    on(name: string, handler: (...args: any[]) => unknown) { const values = this.handlers.get(name) ?? []; values.push(handler); this.handlers.set(name, values); }
}

void test("core mesh schemas expose send/report messages and task-only retrieval", async () => {
    const targets = { worker: settledAgentDefinition("worker") };
    const inactive = () => undefined;
    const deps = { configPath: "/missing", env: {}, exec: absentTmux, activeCaller: inactive } as OrchestrationDependencies;
    const send = createMeshSendTool(deps, targets, { worker: ["pi-default", "cursor-write"] });
    assert.equal(Value.Check(send.parameters, { agent: "worker", profile: "pi-default", message: "work" }), true);
    assert.equal(Value.Check(send.parameters, { agent: "worker", message: "work" }), false);
    assert.equal(Value.Check(send.parameters, { agent: "worker", profile: "cursor-write", message: "work", prompt: "obsolete" }), false);
    const fixed = createMeshSendTool(deps, { explorer: settledAgentDefinition("explorer") }, { explorer: ["pi-default"] });
    assert.equal(Value.Check(fixed.parameters, { agent: "explorer", message: "inspect" }), true);
    assert.equal(Value.Check(fixed.parameters, { agent: "explorer", profile: "pi-default", message: "inspect" }), false);
    assert.equal(Value.Check(send.parameters, { agentId: "agent-id", message: "work" }), true);
    assert.equal(Value.Check(send.parameters, { profile: "cursor-write", message: "work" }), false);
    assert.equal(Value.Check(send.parameters, { agent: "unknown", profile: "pi-default", message: "work" }), false);
    await assert.rejects(send.execute("call", { agent: "worker", agentId: "id", profile: "pi-default", message: "work" }, undefined, undefined, {} as never), /cannot be combined/u);
    const get = createMeshGetTool(deps); const wait = createMeshWaitTool(deps); const report = createMeshReportTool(deps);
    assert.equal(Value.Check(get.parameters, { taskId: "task", outputMode: "compact" }), true); assert.equal(Value.Check(get.parameters, { taskId: "task", outputMode: "full" }), true); assert.equal(Value.Check(get.parameters, { agentId: "agent" }), false); assert.equal(Value.Check(get.parameters, { taskId: "task", agentId: "agent" }), false); assert.equal(Value.Check(get.parameters, { taskId: "task", outputMode: "other" }), false);
    assert.deepEqual(get.prepareArguments!({ taskId: "stored-task" }), { taskId: "stored-task", outputMode: "compact" });
    assert.equal(Value.Check(wait.parameters, { taskIds: ["one", "two"] }), true); assert.equal(Value.Check(wait.parameters, { taskIds: ["one", "one"] }), false); assert.deepEqual(wait.prepareArguments!({ taskIds: ["stored-task"] }), { taskIds: ["stored-task"], outputMode: "compact" });
    assert.equal(Value.Check(report.parameters, { summary: "bounded status" }), true); assert.equal(Value.Check(report.parameters, { message: "obsolete" }), false);
    await assert.rejects(createMeshStopTool(deps).execute("call", {}, undefined, undefined, {} as never), /exactly one/u);
    await assert.rejects(createMeshStopTool(deps).execute("call", { taskId: "task", reason: "must not alter task-stop semantics" }, undefined, undefined, {} as never), /taskId rejects reason/u);
});

// Given a narrowing epoch committed before the reservation lock, dispatch rejects without any lifecycle mutation.
void test("new-agent dispatch rejects stale authority before reservation",  async () => withRoot("mesh-dispatch-reauthorize-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const initial = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const narrowed = await ensurePolicyEpoch(root, mesh.meshId, { mode: "recon", roleSet: ["explorer"], roles: { explorer: settledAgentDefinition("explorer") } }); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); let current = caller(mesh.meshId, initial, { identity: "mode:ops", sessionFile }); let crossings = 0; const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => current, authorityBarrier: async () => { crossings += 1; if (crossings === 3) current = caller(mesh.meshId, narrowed, { identity: "mode:recon", sessionFile }); } }; const ctx = { cwd: root, sessionManager: { getSessionId: () => "root", getSessionFile: () => sessionFile } } as never;
    await assert.rejects(createMeshSendTool(deps, { worker: settledAgentDefinition("worker") }).execute("stale-dispatch", { agent: "worker", message: "must not launch" }, undefined, undefined, ctx), /authority changed before reservation/u); assert.equal(crossings, 2); const paths = meshPaths(root, mesh.meshId); assert.deepEqual(await readdir(paths.reservations), []); assert.deepEqual(await readdir(paths.agents), []); assert.deepEqual(await readdir(paths.tasks), []);
}));

// Given a caller endpoint that goes offline or rotates session after initial lookup, reservation fencing rejects with no reservation, agent, admission, or task state.
void test("stale or offline caller binding at reservation has zero lifecycle mutation", async () => {
    for (const mode of ["offline", "rotated"] as const) await withRoot(`mesh-dispatch-binding-${mode}-`, async root => {
        const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
        const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
        const files = await writeRuntimeFiles(root); const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, "");
        const endpointId = `root:${mesh.meshId}`; const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "root", harness: "pi", sessionId: "root", sessionFile });
        let crossings = 0; const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }), authorityBarrier: async () => { crossings += 1; if (crossings !== 2) return; if (mode === "offline") await setMeshEndpointOffline(root, mesh.meshId, endpointId, endpoint); else await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "root", harness: "pi", sessionId: "rotated", sessionFile: join(root, "rotated.jsonl") }); } };
        const ctx = { cwd: root, sessionManager: { getSessionId: () => "root", getSessionFile: () => sessionFile } } as never;
        await assert.rejects(createMeshSendTool(deps, { worker: settledAgentDefinition("worker") }).execute("stale-binding", { agent: "worker", message: "must not mutate" }, undefined, undefined, ctx), /stale or offline/u);
        const paths = meshPaths(root, mesh.meshId); assert.deepEqual(await readdir(paths.reservations), []); assert.deepEqual(await readdir(paths.agents), []); assert.deepEqual(await readdir(paths.tasks), []); assert.deepEqual(await readdir(join(paths.directory, "pressure-admissions")).catch(() => []), []);
    });
});

// Given nested pressure demand with a stale durable session binding, admission rejects before persisting its request.
void test("stale nested caller binding creates no pressure admission", async () => withRoot("mesh-pressure-binding-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const runtime = await readAgentRuntimeBinding(root, mesh.meshId, worker.agentId); assert.ok(runtime);
    const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${worker.agentId}`, kind: "agent", agentId: worker.agentId, harness: "pi", sessionId: "child", sessionFile: join(root, "child.jsonl") }); await setMeshEndpointOffline(root, mesh.meshId, endpoint.endpointId, endpoint);
    await assert.rejects(requestPressureAdmission(root, mesh.meshId, { requestId: randomUUID(), requesterAgentId: worker.agentId, requesterRuntimeId: runtime.runtimeId, expectedBinding: { endpointId: endpoint.endpointId, endpointSessionFile: endpoint.sessionFile } }), /stale or offline/u);
    assert.deepEqual(await readdir(join(meshPaths(root, mesh.meshId).directory, "pressure-admissions")).catch(() => []), []);
}));

void test("root manages same-mesh tasks and agents across mode epochs while dispatch remains edge-bound", async () => withRoot("mesh-authority-", async root => {
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
    await assert.rejects(createMeshSendTool(deps, { explorer: settledAgentDefinition("explorer") }).execute("reuse", { agentId: worker.agentId, message: "not authorized" }, undefined, undefined, {} as never), /durable caller session/u);
    const stopped = await createMeshStopTool(deps).execute("stop", { agentId: worker.agentId }, undefined, undefined, {} as never); assert.equal((stopped.details as any).stopDisposition, "already-terminal");
}));

// Given forged lateral task and agent handles, child management tools reject before lifecycle mutation.
void test("child authority is requester- and direct-parent-scoped", async () => withRoot("mesh-child-authority-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["reviewer", "worker"], roles: { reviewer: settledAgentDefinition("reviewer"), "review-lens": settledAgentDefinition("review-lens"), validator: settledAgentDefinition("validator"), worker: settledAgentDefinition("worker") } }); const owner = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "reviewer" }); const lateral = await publishWorker(root, mesh.meshId, epoch.epochId); const owned = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "review-lens", parentAgentId: owner.agentId }); const lateralTask = await createTaskStore(root, mesh.meshId, lateral.agentId, "lateral", `root:${mesh.meshId}`); await finishTask(root, mesh.meshId, lateralTask.request.taskId, { outcome: "succeeded", output: "done" }); const ownedTask = await createTaskStore(root, mesh.meshId, owned.agentId, "owned", { requesterEndpointId: `agent:${owner.agentId}`, requesterAgentId: owner.agentId }); await finishTask(root, mesh.meshId, ownedTask.request.taskId, { outcome: "succeeded", output: "done" }); const ownerSessionFile = join(root, "owner.jsonl"); await writeFile(ownerSessionFile, ""); const ownerEndpointId = `agent:${owner.agentId}`; await bindMeshEndpoint(root, mesh.meshId, { endpointId: ownerEndpointId, kind: "agent", agentId: owner.agentId, harness: "pi", sessionId: "owner", sessionFile: ownerSessionFile }); const ownerRuntime = await readAgentRuntimeBinding(root, mesh.meshId, owner.agentId); const files = await writeRuntimeFiles(root); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "agent:reviewer", agentId: owner.agentId, runtimeId: ownerRuntime!.runtimeId, envelope: owner.envelope, endpointId: ownerEndpointId, sessionFile: ownerSessionFile }) };
    await assert.rejects(createMeshGetTool(deps).execute("get", { taskId: lateralTask.request.taskId }, undefined, undefined, {} as never), /not allowed to inspect task/u);
    await assert.rejects(createMeshStopTool(deps).execute("stop", { agentId: lateral.agentId }, undefined, undefined, {} as never), /not its direct parent/u);
    await assert.rejects(createMeshSendTool(deps).execute("send", { agentId: lateral.agentId, message: "lateral send" }, undefined, undefined, {} as never), /not its direct parent/u);
    const direct = await createMeshGetTool(deps).execute("get-child", { taskId: ownedTask.request.taskId }, undefined, undefined, {} as never); assert.equal((direct.details as any).agent.agentId, owned.agentId);
    await assert.rejects(publishWorker(root, mesh.meshId, epoch.epochId, { role: "review-lens", parentAgentId: lateral.agentId }), /actual inbound policy edge/u);
}));

// Admission: nested result integration and task-level retrieval ownership cross runtime, endpoint, projection, and accounting boundaries that schemas cannot observe.
// Given an outbound reviewer and oversized terminal descendants, mesh_wait returns ordered compact results by default, complete results on full retrieval, durable full details, and one receipt/usage claim per task while root execution is rejected.
void test("nested mesh_wait returns ordered compact or full terminal results with one accounting claim", async () => withRoot("mesh-wait-terminal-", async root => {
    const sessionFile = join(root, "reviewer.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets: { ...budgets, maxConcurrentTasks: 8 } });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["reviewer"], roles: { reviewer: settledAgentDefinition("reviewer"), "review-lens": settledAgentDefinition("review-lens"), validator: settledAgentDefinition("validator") } });
    const reviewer = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "reviewer" }); const lens = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "review-lens", parentAgentId: reviewer.agentId }); const validator = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "validator", parentAgentId: reviewer.agentId });
    const endpointId = `agent:${reviewer.agentId}`; await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "agent", agentId: reviewer.agentId, harness: "pi", sessionId: "reviewer", sessionFile }); const completion = { endpointId, endpointSessionFile: sessionFile }; const requester = { requesterEndpointId: endpointId, requesterAgentId: reviewer.agentId, completion };
    const firstOutput = `lens ${"🙂".repeat(4500)}`; const secondOutput = `validator ${"界".repeat(7000)}`;
    const first = await createTaskStore(root, mesh.meshId, lens.agentId, "lens evidence", requester); const second = await createTaskStore(root, mesh.meshId, validator.agentId, "validation evidence", requester); await finishTask(root, mesh.meshId, first.request.taskId, { outcome: "failed", output: firstOutput, error: "lens finding" }); await finishTask(root, mesh.meshId, second.request.taskId, { outcome: "stopped", output: secondOutput, error: "validator stopped" });
    const files = await writeRuntimeFiles(root); const current = caller(mesh.meshId, epoch, { identity: "agent:reviewer", agentId: reviewer.agentId, envelope: reviewer.envelope, endpointId, sessionFile }); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => current }; await createMeshGetTool(deps).execute("get-first", { taskId: first.request.taskId }, undefined, undefined, {} as never); const wait = createMeshWaitTool(deps);
    const result = await wait.execute("wait-call", { taskIds: [second.request.taskId, first.request.taskId] }, undefined, undefined, {} as never); const details = result.details as any; assert.deepEqual(details.tasks.map((snapshot: AgentSnapshot) => snapshot.task!.request.taskId), [second.request.taskId, first.request.taskId]); assert.deepEqual(details.tasks.map((snapshot: AgentSnapshot) => snapshot.task!.status.state), ["stopped", "failed"]); assert.deepEqual(details.accounting.receivedTaskIds, [second.request.taskId]); assert.deepEqual(details.accounting.claimedTaskIds, [second.request.taskId]); assert.ok(result.usage); const compactTasks = (JSON.parse((result.content[0] as { text: string }).text) as { tasks: Array<{ output: string; outputTruncated?: true; fullOutputAvailable?: true }> }).tasks; assert.equal(compactTasks.every(task => task.outputTruncated && task.fullOutputAvailable), true); assert.equal(details.tasks[0].task.result.output, secondOutput); assert.equal(details.tasks[1].task.result.output, firstOutput);
    const repeated = await wait.execute("wait-again", { taskIds: [second.request.taskId, first.request.taskId], outputMode: "full" }, undefined, undefined, {} as never); assert.deepEqual((repeated.details as any).accounting.receivedTaskIds, []); assert.deepEqual((repeated.details as any).accounting.claimedTaskIds, []); assert.equal(repeated.usage, undefined); const fullTasks = (JSON.parse((repeated.content[0] as { text: string }).text) as { tasks: Array<{ output: string }> }).tasks; assert.deepEqual(fullTasks.map(task => task.output), [secondOutput, firstOutput]);
    const terminalSnapshot = await readAgentSnapshot(root, mesh.meshId, validator.agentId, second.request.taskId); const abort = new AbortController(); const abortRace = createMeshWaitTool(deps, async () => { abort.abort(new Error("abort at terminal barrier")); return [terminalSnapshot]; }); await assert.rejects(abortRace.execute("abort-race", { taskIds: [second.request.taskId] }, abort.signal, undefined, {} as never), /abort at terminal barrier/u); const closing = new AbortController(); const shutdownRace = createMeshWaitTool(deps, async () => { closing.abort(new Error("shutdown at terminal barrier")); return [terminalSnapshot]; }, () => closing.signal); await assert.rejects(shutdownRace.execute("shutdown-race", { taskIds: [second.request.taskId] }, undefined, undefined, {} as never), /shutdown at terminal barrier/u);
    const ledger = await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile); assert.equal(ledger!.receipts.length, 2); const rootCaller = caller(mesh.meshId, epoch, { identity: "mode:ops", endpointId: `root:${mesh.meshId}`, sessionFile }); const rootWait = createMeshWaitTool({ ...deps, activeCaller: () => rootCaller }); await assert.rejects(rootWait.execute("root-wait", { taskIds: [first.request.taskId] }, undefined, undefined, {} as never), /only to a durable nested Pi caller/u);
}));

// Admission: pending mesh_wait endpoint fencing is a durable v4 runtime contract; types cannot observe a rotated binding leaving a waiter hung or mutating its descendant.
// Given concurrent nested waiters and a later endpoint rotation, the 250 ms read pass resolves terminal work, rejects the fenced waiter, and leaves its descendant untouched.
void test("nested waiters share completion passes and abort without stopping descendant tasks", async () => withRoot("mesh-wait-pump-", async root => {
    const sessionFile = join(root, "reviewer.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["reviewer"], roles: { reviewer: settledAgentDefinition("reviewer"), "review-lens": settledAgentDefinition("review-lens"), validator: settledAgentDefinition("validator") } }); const reviewer = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "reviewer" }); const lens = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "review-lens", parentAgentId: reviewer.agentId }); await patchAgentStatus(root, mesh.meshId, reviewer.agentId, { meshToolsEnabled: true }); const endpointId = `agent:${reviewer.agentId}`; const completion = { endpointId, endpointSessionFile: sessionFile }; const task = await createTaskStore(root, mesh.meshId, lens.agentId, "running descendant", { requesterEndpointId: endpointId, requesterAgentId: reviewer.agentId, completion }); const files = await writeRuntimeFiles(root); const ctx = { sessionManager: { getSessionId: () => "reviewer", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => false } as never; const clock = new FakeMonotonicTimers(); const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env: { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: reviewer.agentId, PI_AGENT_RESOLVED_AGENT: reviewer.envelopePath }, now: () => clock.now, setInterval: clock.setTimeout, clearInterval: clock.clearTimeout }); await pi.handlers.get("session_start")![0]!({}, ctx); const wait = pi.tools.get("mesh_wait")!;
    const first = wait.execute("wait-one", { taskIds: [task.request.taskId] }, undefined, undefined, {}); const second = wait.execute("wait-two", { taskIds: [task.request.taskId] }, undefined, undefined, {}); await new Promise(resolve => setImmediate(resolve)); assert.equal((await readTask(root, mesh.meshId, task.request.taskId)).status.state, "created"); await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "integrated evidence" }); await eventually(() => clock.nextDelay() === 250); await clock.advance(250); const results = await Promise.all([first, second]); assert.deepEqual((await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile))!.batches, []); assert.equal(results.every(result => result.details.tasks[0].task.result.output === "integrated evidence"), true); assert.equal(results.flatMap(result => result.details.accounting.receivedTaskIds).length, 1);
    const next = await createTaskStore(root, mesh.meshId, lens.agentId, "abort only wait", { requesterEndpointId: endpointId, requesterAgentId: reviewer.agentId, completion }); const abort = new AbortController(); const aborted = wait.execute("wait-abort", { taskIds: [next.request.taskId] }, abort.signal, undefined, {}); await new Promise(resolve => setImmediate(resolve)); abort.abort(new Error("cancel nested barrier")); await assert.rejects(aborted, /cancel nested barrier/u); assert.equal((await readTask(root, mesh.meshId, next.request.taskId)).status.state, "created"); const lost = wait.execute("wait-endpoint-loss", { taskIds: [next.request.taskId] }, undefined, undefined, {}); await eventually(() => clock.nextDelay() === 250); await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "agent", agentId: reviewer.agentId, harness: "pi", sessionId: "replacement", sessionFile }); const rejected = assert.rejects(lost, /rotated or went offline/u); await clock.advance(250); await rejected; assert.equal((await readTask(root, mesh.meshId, next.request.taskId)).status.state, "created"); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Admission: schemas cannot observe native Pi prompt composition; a stale role Skill injection would reintroduce optional ownership while a missing addition would drop mandatory instructions.
// Given a prompt-only Pi child and a discovered disabled Skill, session startup appends only the synthetic role instructions, creates no route endpoint or management surface, and root routing cannot deliver a message.
void test("prompt-only child receives only role instructions and remains isolated from routed management", async () => withRoot("mesh-prompt-only-runtime-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const gyaruCatalog: RoleCatalog = { schemaVersion: 4, roles: { gyaru: settledAgentDefinition("gyaru") } }; const gyaruPolicy: CallPolicy = { modes: { ops: { targets: { gyaru: { profiles: ["pi-default"] } } } }, roles: { gyaru: { targets: {} } } }; const epoch = await ensurePolicyEpochStore(root, mesh.meshId, { mode: "ops", catalog: gyaruCatalog, profiles, callPolicy: gyaruPolicy }); const gyaru = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "gyaru" }); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "gyaru.jsonl"); await writeFile(sessionFile, ""); const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: gyaru.agentId, PI_AGENT_RESOLVED_AGENT: gyaru.envelopePath }; let tick!: () => Promise<void>; const pi = new PiMock(); const ctx = { sessionManager: { getSessionId: () => "gyaru", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => true } as never; await registerOrchestration(pi as never, { ...files, env, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx);
    const prompt = await pi.handlers.get("before_agent_start")![0]!({ systemPrompt: "base", systemPromptOptions: { skills: [{ name: "retired-role-method", description: "legacy", filePath: "/legacy/SKILL.md", disableModelInvocation: true }] } }, ctx);
    assert.deepEqual(prompt, { systemPrompt: "base\n\nPerform gyaru." });
    assert.deepEqual(pi.active, []); assert.equal(pi.tools.has("mesh_enable"), false); assert.equal(pi.handlers.has("context"), false); assert.equal(pi.eventHandlers.get("command-palette:contribution")?.length ?? 0, 0);
    await assert.rejects(readMeshEndpoint(root, mesh.meshId, `agent:${gyaru.agentId}`), /ENOENT/u); await assert.rejects(resolveRouteEndpoint(root, mesh.meshId, gyaru.agentId), /not a durable Pi endpoint/u); await tick(); assert.deepEqual(pi.messages, []); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

void test("mesh_send profile selector exposes only authorized names and rejects forged profiles before launch", async () => withRoot("mesh-profile-schema-", async root => {
    const meshId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; const agentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; const epochId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; const snapshot = buildPolicySnapshot({ mode: "ops", catalog, profiles, callPolicy }); const envelope = buildLaunchEnvelopeV4({ meshId, agentId, epochId, role: "worker", selectedProfile: "pi-default", snapshot, childExtensions: Object.fromEntries(Object.keys(snapshot.roles).map(name => [name, []])) }); const epoch = { schemaVersion: 4, meshId, epochId, ...snapshot, policyDigest: envelope.policyDigest, createdAt: new Date().toISOString(), roleSet: Object.keys(snapshot.directTargets) } as const; const configPath = join(root, "orchestration.json"); await writeFile(configPath, JSON.stringify(runtimeConfig(root))); const deps = { configPath, env: {}, exec: absentTmux, activeCaller: () => caller(meshId, epoch as never, { identity: "agent:worker", agentId, envelope, endpointId: `agent:${agentId}` }) };
    const tool = createMeshSendTool(deps, { worker: settledAgentDefinition("worker") }, { worker: ["pi-default", "cursor-write"] }); assert.equal(Value.Check(tool.parameters, { agent: "worker", profile: "cursor-write", message: "selected" }), true); assert.equal(Value.Check(tool.parameters, { agent: "worker", message: "omitted" }), false); assert.equal(Value.Check(tool.parameters, { profile: "pi-default", message: "forged" }), false);
}));

// Given malformed dependent selectors passed directly to execute, authorization rejects before endpoint lookup or any lifecycle persistence.
void test("mesh_send rejects omitted, forged, and extra profiles before mutation", async () => withRoot("mesh-profile-premutation-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const localCatalog: RoleCatalog = { schemaVersion: 4, roles: { worker: settledAgentDefinition("worker"), explorer: settledAgentDefinition("explorer") } };
    const localPolicy: CallPolicy = { modes: { ops: { targets: { worker: { profiles: ["pi-default", "cursor-write"] }, explorer: { profiles: ["pi-default"] } } } }, roles: {} };
    const epoch = await ensurePolicyEpochStore(root, mesh.meshId, { mode: "ops", catalog: localCatalog, profiles, callPolicy: localPolicy });
    const files = await writeRuntimeFiles(root); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile: join(root, "missing.jsonl") }) };
    const tool = createMeshSendTool(deps, localCatalog.roles, { worker: ["pi-default", "cursor-write"], explorer: ["pi-default"] });
    for (const [params, pattern] of [
        [{ agent: "worker", message: "omitted" }, /requires an explicit profile/u],
        [{ agent: "worker", profile: "forged", message: "forged" }, /not allowed/u],
        [{ agent: "explorer", profile: "pi-default", message: "extra" }, /fixed profile/u],
    ] as const) await assert.rejects(tool.execute("invalid-profile", params, undefined, undefined, { cwd: root } as never), pattern);
    const paths = meshPaths(root, mesh.meshId); assert.deepEqual(await readdir(paths.reservations), []); assert.deepEqual(await readdir(paths.agents), []); assert.deepEqual(await readdir(paths.tasks), []);
}));

// Given an existing agent whose selected profile was removed from the current direct edge, reuse rejects before reserving or creating a task.
void test("mesh_send reuse requires the current role and selected-profile edge", async () => withRoot("mesh-reuse-profile-edge-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets });
    const initial = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, initial.epochId);
    const narrowedPolicy: CallPolicy = { modes: { narrowed: { targets: { worker: { profiles: ["cursor-write"] } } } }, roles: {} }; const narrowed = await ensurePolicyEpochStore(root, mesh.meshId, { mode: "narrowed", catalog: { schemaVersion: 4, roles: { worker: settledAgentDefinition("worker") } }, profiles, callPolicy: narrowedPolicy });
    await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); const files = await writeRuntimeFiles(root); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, narrowed, { identity: "mode:narrowed", sessionFile }) }; const reservationsBefore = await readdir(meshPaths(root, mesh.meshId).reservations);
    await assert.rejects(createMeshSendTool(deps, { worker: settledAgentDefinition("worker") }, { worker: ["cursor-write"] }).execute("reuse-stale-profile", { agentId: worker.agentId, message: "must not reuse" }, undefined, undefined, { cwd: root } as never), /current immutable role\/profile edge/u);
    assert.deepEqual(await readdir(meshPaths(root, mesh.meshId).reservations), reservationsBefore); assert.deepEqual(await readdir(meshPaths(root, mesh.meshId).tasks), []);
}));

// Given a live reusable agent, mesh_send returns its durable nonterminal handle before the task is terminal and that same handle later observes successful completion.
void test("mesh_send existing-agent reuse succeeds immediately before terminal completion", async () => withRoot("mesh-reuse-success-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId);
    await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${worker.agentId}`, kind: "agent", agentId: worker.agentId, harness: "pi", sessionId: "worker", sessionFile: join(root, "worker.jsonl") }); const files = await writeRuntimeFiles(root);
    const exec = async (_command: string, args: string[]) => { if (args.includes("display-message")) return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("list-panes")) return { stdout: `${tmux.paneId}\t0\n`, stderr: "", code: 0 }; if (args.includes("has-session")) return { stdout: "", stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; };
    const deps = { ...files, env: {}, exec, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) };
    const submitted = await createMeshSendTool(deps, { worker: settledAgentDefinition("worker") }).execute("reuse-success", { agentId: worker.agentId, message: "complete after submit returns" }, undefined, undefined, { cwd: root } as never);
    const taskId = (submitted.details as any).task.request.taskId as string; assert.equal((submitted.details as any).task.status.state, "created"); assert.equal((await readTask(root, mesh.meshId, taskId)).status.state, "created");
    await finishTask(root, mesh.meshId, taskId, { outcome: "succeeded", output: "done after immediate return" }); assert.equal((await readTask(root, mesh.meshId, taskId)).status.state, "succeeded");
}));

void test("existing-agent send rejects conservative unknown activity without creating a task", async () => withRoot("mesh-reuse-activity-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId, { activity: false }); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${worker.agentId}`, kind: "agent", agentId: worker.agentId, harness: "pi", sessionId: "worker", sessionFile: join(root, "worker.jsonl") }); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) };
    await assert.rejects(createMeshSendTool(deps, { worker: settledAgentDefinition("worker") }).execute("submit", { agentId: worker.agentId, message: "must not reroute" }, undefined, undefined, { cwd: root } as never), /not accepting tasks/iu);
    assert.deepEqual(await readdir(meshPaths(root, mesh.meshId).tasks), []);
}));

void test("a child cannot stop its own agent process", async () => withRoot("mesh-self-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
    const worker = await publishWorker(root, mesh.meshId, epoch.epochId);
    const files = await writeRuntimeFiles(root);
    const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "agent:worker", agentId: worker.agentId }) };
    await assert.rejects(createMeshStopTool(deps).execute("stop", { agentId: worker.agentId }, undefined, undefined, {} as never), /calling agent itself/u);
}));

void test("root and envelope-less children do not expose mesh bootstrap", async () => withRoot("mesh-registration-", async root => {
    const files = await writeRuntimeFiles(root); const keybindings = await writeMeshKeybindings(root); const previous = process.env.PI_EXTENSION_KEYBINDINGS_PATH; process.env.PI_EXTENSION_KEYBINDINGS_PATH = keybindings;
    try { const rootPi = new PiMock(); await registerOrchestration(rootPi as never, { ...files, env: {} }); assert.equal(rootPi.tools.has("mesh_enable"), false); assert.equal(rootPi.tools.has("mesh_wait"), false); const leafPi = new PiMock(); await registerOrchestration(leafPi as never, { ...files, env: { PI_MESH_AGENT_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }); assert.equal(leafPi.tools.has("mesh_enable"), false); }
    finally { if (previous === undefined) delete process.env.PI_EXTENSION_KEYBINDINGS_PATH; else process.env.PI_EXTENSION_KEYBINDINGS_PATH = previous; }
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
    await writeFile(join(root, "execution-profiles.json"), JSON.stringify(profiles));
    await writeFile(join(root, "agent-modes.json"), JSON.stringify({ schemaVersion: 2, defaultMode: "recon", modes: Object.fromEntries(["recon", "ops"].map(name => [name, { description: name, defaultProfile: "pi-default", tools: ["read"], skillOptIns: [], instructions: `Use ${name}.` }])) }));
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

// Admission: partial activation would expose an inconsistent management surface before dispatch, and no schema or type guarantee observes Pi's runtime active set.
// Given a fresh authorized child, when staged activation crosses Pi's active-tool and persistence boundary, all five peers become active atomically and either failure restores the exact prior set.
void test("staged send activation is additive, complete, and rolls back activation or persistence failure", async () => {
    const meshId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; const epochId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; const agentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; const snapshot = buildPolicySnapshot({ mode: "ops", catalog, profiles, callPolicy }); const envelope = buildLaunchEnvelopeV4({ meshId, agentId, epochId, role: "reviewer", selectedProfile: "pi-default", snapshot, childExtensions: Object.fromEntries(Object.keys(snapshot.roles).map(name => [name, []])) }); const epoch = { schemaVersion: 4, meshId, epochId, ...snapshot, policyDigest: envelope.policyDigest, createdAt: "2026-01-01T00:00:00.000Z", roleSet: Object.keys(snapshot.directTargets) } as const; const activeCaller = caller(meshId, epoch as never, { identity: "agent:reviewer", agentId, envelope, endpointId: `agent:${agentId}` });
    const pi = new PiMock(); for (const name of MESH_TOOLS) pi.registerTool({ name }); pi.active = ["read", "mesh_send", "mesh_report"]; let persisted = 0;
    await activateMeshPeerToolsForSend(pi as never, activeCaller, async () => { persisted += 1; });
    assert.deepEqual(MESH_TOOLS.filter(name => !pi.active.includes(name)), []); assert.equal(new Set(pi.active).size, pi.active.length); assert.equal(persisted, 1);

    const incomplete = new PiMock(); for (const name of MESH_TOOLS) incomplete.registerTool({ name }); incomplete.active = ["read", "mesh_send", "mesh_report"]; const setActive = incomplete.setActiveTools.bind(incomplete); let denyReport = true; incomplete.setActiveTools = names => { if (denyReport && names.includes("mesh_report")) { denyReport = false; setActive(names.filter(name => name !== "mesh_report")); } else setActive(names); }; let incompletePersisted = 0;
    await assert.rejects(activateMeshPeerToolsForSend(incomplete as never, activeCaller, async () => { incompletePersisted += 1; }), /activation incomplete.*mesh_report/u); assert.deepEqual(incomplete.active, ["read", "mesh_send", "mesh_report"]); assert.equal(incompletePersisted, 0);

    const persistence = new PiMock(); for (const name of MESH_TOOLS) persistence.registerTool({ name }); persistence.active = ["read", "mesh_send", "mesh_report"];
    await assert.rejects(activateMeshPeerToolsForSend(persistence as never, activeCaller, async () => { throw new Error("status persistence failed"); }), /status persistence failed/u); assert.deepEqual(persistence.active, ["read", "mesh_send", "mesh_report"]);

    const legacy = new PiMock(); for (const name of MESH_TOOLS.filter(name => name !== "mesh_wait")) legacy.registerTool({ name }); legacy.active = ["read", "mesh_send", "mesh_report"]; await assert.rejects(activateMeshPeerToolsForSend(legacy as never, activeCaller, async () => {}), /restart required.*mesh_wait/u); assert.deepEqual(legacy.active, ["read", "mesh_send", "mesh_report"]);
});

// Admission: the first authorized child dispatch must expose the complete management surface before task mutation and persisted state must restore that surface after reload; Pi's registry mock and schemas do not guarantee either boundary.
// Given a fresh reviewer child, when its first send targets an authorized review-lens, the next request sees all peers, persistence restores them after reload, and pre-send persistence failure creates no task.
void test("reviewer first send unlocks all peers transactionally and reload restores them", async () => withRoot("mesh-staged-send-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["reviewer"], roles: { reviewer: settledAgentDefinition("reviewer"), "review-lens": settledAgentDefinition("review-lens"), validator: settledAgentDefinition("validator") } });
    const reviewer = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "reviewer" }); const lens = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "review-lens", parentAgentId: reviewer.agentId }); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${lens.agentId}`, kind: "agent", agentId: lens.agentId, harness: "pi", sessionId: "lens", sessionFile: join(root, "lens.jsonl") });
    const files = await writeRuntimeFiles(root); const sessionFile = join(root, "reviewer.jsonl"); await writeFile(sessionFile, ""); const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: reviewer.agentId, PI_AGENT_RESOLVED_AGENT: reviewer.envelopePath }; const ctx = { sessionManager: { getSessionId: () => "reviewer-session", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => false } as never;
    const liveExec = async (_command = "", args: string[] = []) => { if (args.includes("display-message")) return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("list-panes")) return { stdout: `${tmux.paneId}\t0\n`, stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; };
    const pi = new PiMock(); pi.exec = liveExec; await registerOrchestration(pi as never, { ...files, env, setInterval() { return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); assert.deepEqual(pi.active, ["read", "mesh_send", "mesh_report"]);
    const registered = pi.tools.get("mesh_send")!; assert.equal(Value.Check(registered.parameters, { agent: "review-lens", message: "focused review" }), true); assert.equal(Value.Check(registered.parameters, { agent: "validator", message: "focused validation" }), true); assert.equal(Value.Check(registered.parameters, { agent: "worker", message: "forged" }), false);

    const currentEpoch = await readPolicyEpoch(root, mesh.meshId, epoch.epochId); const directDeps = { ...files, env, exec: liveExec, activeCaller: () => caller(mesh.meshId, currentEpoch, { identity: "agent:reviewer", agentId: reviewer.agentId, envelope: reviewer.envelope, endpointId: `agent:${reviewer.agentId}`, sessionFile }) }; const before = await readdir(meshPaths(root, mesh.meshId).tasks); const failing = createMeshSendTool(directDeps, { "review-lens": settledAgentDefinition("review-lens"), validator: settledAgentDefinition("validator") }, { "review-lens": ["pi-default"], validator: ["pi-default"] }, activeCaller => activateMeshPeerToolsForSend(pi as never, activeCaller, async () => { throw new Error("status persistence failed"); }));
    await assert.rejects(failing.execute("failed-staged-submit", { agentId: lens.agentId, message: "must not mutate lifecycle" }, undefined, undefined, { cwd: root } as never), /status persistence failed/u); assert.deepEqual(await readdir(meshPaths(root, mesh.meshId).tasks), before); assert.deepEqual(pi.active, ["read", "mesh_send", "mesh_report"]);

    const submitted = await registered.execute("reviewer-to-lens", { agentId: lens.agentId, message: "inspect the bounded lens" }, undefined, undefined, { cwd: root } as never); assert.equal((submitted.details as any).agent.role, "review-lens"); assert.deepEqual(MESH_TOOLS.filter(name => !pi.active.includes(name)), []); assert.equal((await readAgentSnapshot(root, mesh.meshId, reviewer.agentId)).status.meshToolsEnabled, true);
    await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" }); const reloaded = new PiMock(); await registerOrchestration(reloaded as never, { ...files, env, setInterval() { return "timer"; }, clearInterval() {} }); await reloaded.handlers.get("session_start")![0]!({}, ctx); assert.deepEqual(MESH_TOOLS.filter(name => !reloaded.active.includes(name)), []); await reloaded.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Admission: nonterminal retrieval is a public control-plane boundary; only runtime execution can prove it neither accounts nor creates a receipt.
// Given a pending authorized task, mesh_get reports that its result is not ready without an accounting payload or receipt.
void test("mesh_get reports nonterminal work as not-ready without accounting", async () => withRoot("mesh-get-not-ready-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const endpointId = `root:${mesh.meshId}`; await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "root", harness: "pi", sessionId: "root", sessionFile });
    const task = await createTask(root, mesh.meshId, worker.agentId, "still running"); const files = await writeRuntimeFiles(root); const exec = async (_command: string, args: string[]) => args.includes("display-message") ? { stdout: "10\n", stderr: "", code: 0 } : args.includes("list-panes") ? { stdout: `${tmux.paneId}\t0\n`, stderr: "", code: 0 } : { stdout: "", stderr: "", code: 0 }; const got = await createMeshGetTool({ ...files, env: {}, exec, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) }).execute("not-ready", { taskId: task.request.taskId }, undefined, undefined, {} as never);
    assert.deepEqual(JSON.parse((got.content[0] as { text: string }).text), { taskId: task.request.taskId, taskState: "created", resultAvailable: false }); assert.equal((got.details as any).accounting, undefined); assert.equal(await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile), undefined);
}));

// Admission: an existing-agent send has distinct consumer outcomes for busy intervention and idle submission; schemas cannot observe its stable retry result.
// Given a direct child that is busy or idle, mesh_send durably intervenes or submits respectively, and retrying the intervention reuses its original handle.
void test("mesh_send intervenes when busy, submits when idle, and retries idempotently", async () => withRoot("mesh-send-state-aware-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${worker.agentId}`, kind: "agent", agentId: worker.agentId, harness: "pi", sessionId: "worker", sessionFile: join(root, "worker.jsonl") });
    const active = await createTask(root, mesh.meshId, worker.agentId, "active work"); const files = await writeRuntimeFiles(root); const send = createMeshSendTool({ ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) }, { worker: settledAgentDefinition("worker") });
    const first = await send.execute("busy-send", { agentId: worker.agentId, message: "change direction" }, undefined, undefined, {} as never); const retry = await send.execute("busy-send", { agentId: worker.agentId, message: "change direction" }, undefined, undefined, {} as never);
    assert.deepEqual(retry.details, first.details); assert.deepEqual(first.details, { disposition: "intervened", agentId: worker.agentId, taskId: active.request.taskId, messageId: (first.details as any).messageId, sequence: 1, deliveryState: "pending" });
    await finishTask(root, mesh.meshId, active.request.taskId, { outcome: "succeeded", output: "done" }); const submitted = await send.execute("idle-send", { agentId: worker.agentId, message: "new work" }, undefined, undefined, {} as never);
    assert.equal((submitted.details as any).task.request.prompt, "new work"); assert.equal((submitted.details as any).task.status.state, "created");
}));

// Admission: leaf report availability and routing cross launch policy, live endpoint binding, and task ownership; no lower-level event test proves the tool is exposed to its consumer.
// Given a leaf child with a parent-routed active task, startup exposes only mesh_report and the report reaches that parent endpoint.
void test("leaf children register mesh_report and route active-task reports to their parent", async () => withRoot("mesh-leaf-report-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["reviewer"], roles: { reviewer: settledAgentDefinition("reviewer"), "review-lens": settledAgentDefinition("review-lens"), validator: settledAgentDefinition("validator") } });
    const parent = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "reviewer" }); const leaf = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "review-lens", parentAgentId: parent.agentId }); const parentSession = join(root, "parent.jsonl"); await writeFile(parentSession, ""); const parentEndpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${parent.agentId}`, kind: "agent", agentId: parent.agentId, harness: "pi", sessionId: "parent", sessionFile: parentSession });
    const task = await createTaskStore(root, mesh.meshId, leaf.agentId, "leaf work", { requesterEndpointId: parentEndpoint.endpointId, requesterAgentId: parent.agentId, completion: { endpointId: parentEndpoint.endpointId, endpointSessionFile: parentSession } }); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "leaf.jsonl"); await writeFile(sessionFile, ""); const pi = new PiMock(); const ctx = { sessionManager: { getSessionId: () => "leaf", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => false } as never;
    await registerOrchestration(pi as never, { ...files, env: { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: leaf.agentId, PI_AGENT_RESOLVED_AGENT: leaf.envelopePath }, setInterval() { return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); assert.deepEqual(pi.active, ["read", "mesh_report"]);
    const result = await pi.tools.get("mesh_report")!.execute("report", { summary: "bounded progress" }, undefined, undefined, {}); assert.deepEqual(result.details, { reportId: (result.details as any).reportId, taskId: task.request.taskId, state: "queued" }); const reports = (await readEndpointDeliverySnapshot(root, mesh.meshId, parentEndpoint)).events.filter(event => event.kind === "report"); assert.equal(reports.length, 1); assert.equal(reports[0]!.payload.summary, "bounded progress"); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Admission: context acknowledgement is the runtime boundary that proves injected interventions become one parent-visible frontier rather than unacknowledged delivery state.
// Given two interventions for a busy child task in one context, the context hook acknowledges their shared sequence frontier with one delivery-ack bundle.
void test("intervention context acknowledgement bundles a shared delivery frontier", async () => withRoot("mesh-intervention-ack-", async root => {
    const rootSession = join(root, "root.jsonl"); await writeFile(rootSession, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: rootSession, recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
    const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const rootEndpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile: rootSession }); const task = await createTask(root, mesh.meshId, worker.agentId, "active work"); const files = await writeRuntimeFiles(root); const childSession = join(root, "worker.jsonl"); await writeFile(childSession, ""); const pi = new PiMock(); const ctx = { sessionManager: { getSessionId: () => "worker", getSessionFile: () => childSession, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => false } as never;
    let tick!: () => Promise<void>; await registerOrchestration(pi as never, { ...files, env: { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: worker.agentId, PI_AGENT_RESOLVED_AGENT: worker.envelopePath }, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx);
    const send = createMeshSendTool({ ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile: rootSession }) }, { worker: settledAgentDefinition("worker") }); await send.execute("intervention-one", { agentId: worker.agentId, message: "first adjustment" }, undefined, undefined, {} as never); await send.execute("intervention-two", { agentId: worker.agentId, message: "second adjustment" }, undefined, undefined, {} as never);
    for (let attempt = 0; attempt < 5 && pi.messages.length < 2; attempt += 1) await tick(); const context = await pi.handlers.get("context")![0]!({ messages: pi.messages.map(item => item.message) }, ctx); assert.ok(context);
    const acknowledgements = (await readEndpointDeliverySnapshot(root, mesh.meshId, rootEndpoint)).events.filter(event => event.kind === "delivery-ack"); assert.equal(acknowledgements.length, 1); assert.equal(acknowledgements[0]!.payload.taskId, task.request.taskId); assert.equal(acknowledgements[0]!.payload.acknowledgedThrough, 2); assert.equal((acknowledgements[0]!.payload.messageIds as string[]).length, 2); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Admission: root materialization and endpoint delivery are repository-owned production wiring; schemas cannot detect endpoint-count multiplication or a read pass that settles ledgers.
// Given a restored root and routed terminal work, startup and deadline advancement expose immediate/one-second materialization followed by two-second read-only delivery without duplicate settlement when another endpoint exists.
void test("root registration materializes once per deadline and delivers on its independent read cadence", async () => withRoot("mesh-root-cadence-", async root => {
    const sessionFile = join(root, "root-session.jsonl"); await writeFile(sessionFile, "");
    const mesh = await initializeMesh(root, { rootSessionId: "root-session", rootSessionFile: sessionFile, recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
    const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const endpointId = `root:${mesh.meshId}`; const completion = { endpointId, endpointSessionFile: sessionFile };
    const first = await createTaskStore(root, mesh.meshId, worker.agentId, "startup completion", { requesterEndpointId: endpointId, completion }); await finishTask(root, mesh.meshId, first.request.taskId, { outcome: "succeeded" });
    const files = await writeRuntimeFiles(root); const clock = new FakeMonotonicTimers(); const pi = new PiMock(); const branch = [{ type: "custom", customType: "mesh-root-binding", data: { schemaVersion: 1, meshId: mesh.meshId } }]; const ctx = { sessionManager: { getSessionId: () => "root-session", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { setStatus() {}, notify() {} }, isIdle: () => true } as never;
    await registerOrchestration(pi as never, { ...files, env: {}, now: () => clock.now, setInterval: clock.setTimeout, clearInterval: clock.clearTimeout }); await pi.handlers.get("session_start")![0]!({}, ctx);
    assert.equal(pi.messages.length, 1); assert.equal((await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile))!.batches.length, 1);
    const extraAgentId = randomUUID(); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${extraAgentId}`, kind: "agent", agentId: extraAgentId, harness: "pi", sessionId: "extra", sessionFile: join(root, "extra.jsonl") });
    const second = await createTaskStore(root, mesh.meshId, worker.agentId, "cadenced completion", { requesterEndpointId: endpointId, completion }); await finishTask(root, mesh.meshId, second.request.taskId, { outcome: "failed" });
    await clock.advance(999); assert.equal((await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile))!.batches.length, 1); assert.equal(pi.messages.length, 1);
    await clock.advance(1); assert.equal((await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile))!.batches.length, 2); assert.equal(pi.messages.length, 1);
    await clock.advance(1000); assert.equal(pi.messages.length, 2); assert.equal((await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile))!.batches.length, 2);
    await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Admission: pump-level bundling and frontier capture cross persisted source events and Pi message delivery; schemas cannot observe notification count or metadata loss.
// Given two materialization passes and one pending peer before a shared delivery deadline, the endpoint receives one completion message containing both sources and the current pending frontier.
void test("delivery pump bundles completion sources and preserves the pending frontier", async () => withRoot("mesh-completion-bundle-", async root => {
    const sessionFile = join(root, "root-bundle.jsonl"); await writeFile(sessionFile, "");
    const mesh = await initializeMesh(root, { rootSessionId: "root-bundle", rootSessionFile: sessionFile, recoverable: true, budgets: { ...budgets, maxConcurrentTasks: 8 } });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
    const firstAgent = await publishWorker(root, mesh.meshId, epoch.epochId); const secondAgent = await publishWorker(root, mesh.meshId, epoch.epochId); const pendingAgent = await publishWorker(root, mesh.meshId, epoch.epochId);
    const endpointId = `root:${mesh.meshId}`; const completion = { endpointId, endpointSessionFile: sessionFile };
    const first = await createTaskStore(root, mesh.meshId, firstAgent.agentId, "first private prompt", { requesterEndpointId: endpointId, completion });
    const second = await createTaskStore(root, mesh.meshId, secondAgent.agentId, "second private prompt", { requesterEndpointId: endpointId, completion });
    const pending = await createTaskStore(root, mesh.meshId, pendingAgent.agentId, "pending private prompt", { requesterEndpointId: endpointId, completion });
    const files = await writeRuntimeFiles(root); await writeFile(files.configPath, JSON.stringify({ ...runtimeConfig(root), budgets: { ...budgets, maxConcurrentTasks: 8 } })); const clock = new FakeMonotonicTimers(); const pi = new PiMock(); const branch = [{ type: "custom", customType: "mesh-root-binding", data: { schemaVersion: 1, meshId: mesh.meshId } }];
    const ctx = { sessionManager: { getSessionId: () => "root-bundle", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { setStatus() {}, notify() {} }, isIdle: () => false } as never;
    await registerOrchestration(pi as never, { ...files, env: {}, now: () => clock.now, setInterval: clock.setTimeout, clearInterval: clock.clearTimeout }); await pi.handlers.get("session_start")![0]!({}, ctx); assert.equal(pi.messages.length, 0);
    await finishTask(root, mesh.meshId, first.request.taskId, { outcome: "succeeded", output: "private first output" }); await clock.advance(1000);
    await finishTask(root, mesh.meshId, second.request.taskId, { outcome: "failed", error: "private second error" }); await clock.advance(1000);
    const completionMessages = pi.messages.filter(item => (item.message as any).details?.kind === "completion");
    assert.equal(completionMessages.length, 1);
    const message = completionMessages[0]!.message as any; assert.equal(message.details.sources.length, 2);
    const visible = JSON.parse(message.content) as { tasks: Array<{ taskId: string }>; pendingTasks: Array<{ taskId: string }> };
    assert.deepEqual(visible.tasks.map(task => task.taskId), [first.request.taskId, second.request.taskId]); assert.deepEqual(visible.pendingTasks.map(task => task.taskId), [pending.request.taskId]);
    assert.doesNotMatch(message.content, /prompt|output|error|usage/u); assert.deepEqual(completionMessages[0]!.options, { deliverAs: "steer", triggerTurn: false });
    await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Given direct task completions while the Pi runtime is idle and busy, the completion pump requests a turn only for idle delivery and uses turn-boundary steer in both cases.
void test("completion pump triggers an idle turn but leaves busy steer non-triggering", async () => withRoot("mesh-completion-trigger-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const lease = await attachRootMesh(root, mesh.meshId, { rootSessionId: "root", budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
    const receiver = await publishWorker(root, mesh.meshId, epoch.epochId); const peer = await publishWorker(root, mesh.meshId, epoch.epochId); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "completion-session.jsonl"); await writeFile(sessionFile, ""); const endpointId = `agent:${receiver.agentId}`; const completion = { endpointId, endpointSessionFile: sessionFile };
    const requester = { requesterEndpointId: endpointId, requesterAgentId: receiver.agentId, completion }; const first = await createTaskStore(root, mesh.meshId, receiver.agentId, "idle completion", requester); const second = await createTaskStore(root, mesh.meshId, peer.agentId, "busy completion", requester);
    let idle = true; const ctx = { sessionManager: { getSessionId: () => "completion-session", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => idle } as never; let tick!: () => Promise<void>; const pi = new PiMock();
    await registerOrchestration(pi as never, { ...files, env: { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: receiver.agentId, PI_AGENT_RESOLVED_AGENT: receiver.envelopePath }, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx);
    await finishTask(root, mesh.meshId, first.request.taskId, { outcome: "succeeded", output: "idle done" }); await materializeMeshCompletionEvents(root, mesh.meshId, lease.leaseId); for (let attempt = 0; attempt < 5 && pi.messages.length < 1; attempt += 1) await tick(); assert.deepEqual(pi.messages.at(-1)!.options, { deliverAs: "steer", triggerTurn: true });
    const receipt = await createCompletionReceipt(root, mesh.meshId, { endpointId, endpointSessionFile: sessionFile, claimantSessionFile: sessionFile, toolCallId: "context-get", toolName: "mesh_get", canonicalArguments: { taskId: first.request.taskId }, taskIds: [first.request.taskId], maxTasksPerMesh: budgets.maxTasksPerMesh }); const toolResult = { role: "toolResult", toolName: "mesh_get", details: { accounting: { receiptIds: [receipt.receipt!.receiptId], receivedTaskIds: [first.request.taskId], claimedTaskIds: [] } } }; const projected = await pi.handlers.get("context")![0]!({ messages: [(pi.messages[0]!.message as object), toolResult] }, ctx) as { messages: unknown[] }; assert.equal(projected.messages.length, 2); const projectedCompletion = projected.messages[0] as { content: string }; assert.deepEqual(JSON.parse(projectedCompletion.content), { tasks: [], pendingTasks: [{ taskId: second.request.taskId, agentId: peer.agentId, state: "created" }] }); assert.equal(projected.messages[1], toolResult); const firstEventId = ((pi.messages[0]!.message as any).details.sources[0].eventId as string); assert.equal((JSON.parse(await readFile(join(meshPaths(root, mesh.meshId).events, `${firstEventId}.json`), "utf8")) as { state: string }).state, "acknowledged");
    idle = false; await finishTask(root, mesh.meshId, second.request.taskId, { outcome: "failed", error: "busy done" }); await materializeMeshCompletionEvents(root, mesh.meshId, lease.leaseId); for (let attempt = 0; attempt < 5 && pi.messages.length < 2; attempt += 1) await tick(); assert.deepEqual(pi.messages.at(-1)!.options, { deliverAs: "steer", triggerTurn: false }); assert.equal(pi.messages.length, 2);
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

// Given a root maintenance pass held across shutdown, when reload crosses the lifecycle boundary, shutdown aborts and awaits that pass before cancelling open admissions.
void test("root shutdown quiesces a held maintenance pass before admission cancellation", async () => withRoot("mesh-root-pass-shutdown-", async root => { const sessionFile = join(root, "root-session.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root-session", rootSessionFile: sessionFile, recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const requester = await publishWorker(root, mesh.meshId, epoch.epochId); const requesterRuntime = randomUUID(); await bindAgentRuntime(root, mesh.meshId, requester.agentId, { runtimeId: requesterRuntime, kind: "external" }); await patchAgentStatus(root, mesh.meshId, requester.agentId, { state: "busy" }); const requestId = randomUUID(); await requestPressureAdmission(root, mesh.meshId, { requestId, requesterAgentId: requester.agentId, requesterRuntimeId: requesterRuntime }); const files = await writeRuntimeFiles(root); const branch = [{ type: "custom", customType: "mesh-root-binding", data: { schemaVersion: 1, meshId: mesh.meshId } }]; const ctx = { sessionManager: { getSessionId: () => "root-session", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { notify() {}, setStatus() {} }, isIdle: () => true } as never; let tick!: () => Promise<void>; const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env: {}, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); let unlock!: () => void; let acquired!: () => void; const acquiredPromise = new Promise<void>(resolve => { acquired = resolve; }); const gate = new Promise<void>(resolve => { unlock = resolve; }); const held = withMeshLock(root, mesh.meshId, async () => { acquired(); await gate; }); await acquiredPromise;
    const ticking = tick(); await Promise.resolve(); let shutdownDone = false; const shutdown = Promise.resolve(pi.handlers.get("session_shutdown")![0]!({ reason: "reload" })).finally(() => { shutdownDone = true; }); await Promise.resolve(); assert.equal(shutdownDone, false); unlock(); await Promise.all([held, ticking, shutdown]); assert.equal((await readPressureAdmission(root, mesh.meshId, requestId)).state, "cancelled"); }));

void test("failed pre-publication cleanup retains prepared capacity when process death cannot be confirmed", async () => withRoot("mesh-launch-cleanup-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const files = await writeRuntimeFiles(root); let cleanupInspection = false;
    const exec = async (_command: string, args: string[]) => { if (args.includes("display-message") && args.at(-1)?.includes("#{session_id}")) return { stdout: "10\t$root\tmain\t@root\t%root\tclient\n", stderr: "", code: 0 }; if (args.at(-1) === "#{pid}") return cleanupInspection ? { stdout: "", stderr: "temporary inspection failure", code: 2 } : { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("has-session")) return { stdout: "", stderr: "missing", code: 1 }; if (args.includes("new-session")) return { stdout: "$hub\t@agent\t%agent\n", stderr: "", code: 0 }; if (args.includes("@pi_mesh_schema")) { cleanupInspection = true; return { stdout: "", stderr: "metadata write failed", code: 2 }; } return { stdout: "", stderr: "", code: 0 }; };
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); const deps = { ...files, env: { TMUX: "/tmp/tmux,1,0" }, exec, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) }; const ctx = { cwd: root, sessionManager: { getSessionId: () => "root", getSessionFile: () => sessionFile } } as never;
    await assert.rejects(createMeshSendTool(deps, { worker: settledAgentDefinition("worker") }).execute("launch", { agent: "worker", message: "work" }, undefined, undefined, ctx), /cleanup.*remains incomplete/iu);
    const paths = meshPaths(root, mesh.meshId); const reservations = await readdir(paths.reservations); const agents = await readdir(paths.agents); assert.equal(reservations.length, 1); assert.equal(agents.length, 1); const reservation = JSON.parse(await readFile(join(paths.reservations, reservations[0]!), "utf8")) as { state: string }; assert.equal(reservation.state, "committed");
}));

// Given a published launch whose bridge never becomes ready, when normal launch cleanup crosses durable stop and tmux termination, callers observe the launch error while recovery state records a confirmed failed lifecycle with that reason.
void test("published launch failure durably confirms a failed agent outcome", async () => withRoot("mesh-published-launch-failure-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const files = await writeRuntimeFiles(root); let clock = -6000;
    const exec = async (_command: string, args: string[]) => { if (args.includes("display-message") && args.at(-1)?.includes("#{session_id}")) return { stdout: "10\t$root\tmain\t@root\t%root\tclient\n", stderr: "", code: 0 }; if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("has-session")) return { stdout: "", stderr: "missing", code: 1 }; if (args.includes("new-session")) return { stdout: "$hub\t@agent\t%agent\n", stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; };
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); const deps = { ...files, env: { TMUX: "/tmp/tmux,1,0" }, exec, now: () => clock += 6000, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) }; const ctx = { cwd: root, sessionManager: { getSessionId: () => "root", getSessionFile: () => sessionFile } } as never;
    await assert.rejects(createMeshSendTool(deps, { worker: settledAgentDefinition("worker") }).execute("launch", { agent: "worker", message: "work" }, undefined, undefined, ctx), /bridge readiness timed out/iu);
    const agentIds = await readdir(meshPaths(root, mesh.meshId).agents); assert.equal(agentIds.length, 1); const failed = await readAgentSnapshot(root, mesh.meshId, agentIds[0]!); assert.deepEqual({ lifecycle: failed.status.state, reason: failed.status.exitReason, stop: failed.stop?.state, terminalState: failed.stop?.terminalState }, { lifecycle: "failed", reason: "Agent bridge readiness timed out", stop: "confirmed", terminalState: "failed" });
}));

void test("root palette management survives a mode switch", async () => withRoot("mesh-palette-barrier-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const ops = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, ops.epochId); const recon = await ensurePolicyEpoch(root, mesh.meshId, { mode: "recon", roleSet: ["explorer"], roles: { explorer: settledAgentDefinition("explorer") } }); let current = caller(mesh.meshId, ops, { identity: "mode:ops" }); let release!: () => void; const barrier = new Promise<void>(resolve => { release = () => { current = caller(mesh.meshId, recon, { identity: "mode:recon" }); resolve(); }; }); let execCalls = 0; const deps = { configPath: "/unused", env: {}, exec: async () => { execCalls += 1; return { stdout: "", stderr: "", code: 1 }; }, activeCaller: () => current, authorityBarrier: () => barrier };
    const stopped = stopPaletteMeshAgent(deps, runtimeConfig(root), { meshId: mesh.meshId, agentId: worker.agentId, reason: "root lifecycle stop" }); release(); assert.equal((await stopped).status.state, "stopping"); assert.ok(execCalls >= 0);
}));

// Given a terminal task, mesh_stop exposes only lifecycle projection while mesh_get remains the full result and usage owner.
void test("mesh_stop omits terminal result ownership that mesh_get retains", async () => withRoot("mesh-stop-get-projection-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId);
    await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile });
    const task = await createTask(root, mesh.meshId, worker.agentId, "projection ownership"); await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "failed", output: "terminal output", error: "terminal error", usage: { input: 3, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 8, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const files = await writeRuntimeFiles(root); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) };
    const stopped = await createMeshStopTool(deps).execute("stop", { taskId: task.request.taskId }, undefined, undefined, {} as never); const stopText = (stopped.content[0] as { text: string }).text;
    assert.doesNotMatch(stopText, /terminal output|terminal error|usage/u);
    const got = await createMeshGetTool(deps).execute("get", { taskId: task.request.taskId }, undefined, undefined, {} as never); const getText = (got.content[0] as { text: string }).text;
    assert.match(getText, /terminal output/u); assert.match(getText, /terminal error/u); assert.deepEqual((got.details as any).accounting.claimedTaskIds, [task.request.taskId]); assert.ok(got.usage);
}));

// Admission: schemas and the aggregate serializer cannot prove the retrieval-mode boundary, durable-detail preservation, or usage idempotence.
// Given a UTF-8 terminal result above the compact task budget, omitted mesh_get mode returns a marked JSON-safe compact projection, full returns the complete projection, and only the first retrieval claims usage.
void test("mesh_get compact and full modes preserve durable output and claim usage once", async () => withRoot("mesh-get-output-mode-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile });
    const output = "🙂".repeat(4500); const error = "界".repeat(2000); const task = await createTask(root, mesh.meshId, worker.agentId, "bounded retrieval"); await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "failed", output, error, usage: { input: 3, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 8, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const files = await writeRuntimeFiles(root); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) }; const get = createMeshGetTool(deps);
    const compact = await get.execute("compact", { taskId: task.request.taskId }, undefined, undefined, {} as never); const compactTask = JSON.parse((compact.content[0] as { text: string }).text) as { output: string; error: string; outputTruncated: true; fullOutputAvailable: true };
    assert.equal(compactTask.outputTruncated, true); assert.equal(compactTask.fullOutputAvailable, true); assert.ok(Buffer.byteLength(JSON.stringify({ output: compactTask.output, error: compactTask.error, outputTruncated: true, fullOutputAvailable: true }), "utf8") <= 16 * 1024); assert.doesNotMatch(compactTask.output + compactTask.error, /\uFFFD/u); assert.equal((compact.details as any).task.result.output, output); assert.equal((compact.details as any).task.result.error, error); assert.ok(compact.usage);
    const full = await get.execute("full", { taskId: task.request.taskId, outputMode: "full" }, undefined, undefined, {} as never); const fullTask = JSON.parse((full.content[0] as { text: string }).text) as { output: string; error: string; outputTruncated?: true; fullOutputAvailable?: true };
    assert.equal(fullTask.output, output); assert.equal(fullTask.error, error); assert.equal(fullTask.outputTruncated, undefined); assert.equal(fullTask.fullOutputAvailable, undefined); assert.equal(full.usage, undefined); assert.deepEqual((full.details as any).accounting.claimedTaskIds, []);
}));

// Given a retained v1-era claim written by a retired tool, reads and startup reconciliation accept it alongside current retrieval-tool claims.
void test("historical retired-tool usage claim remains readable and reconcilable", async () => withRoot("mesh-historical-usage-claim-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const task = await createTask(root, mesh.meshId, worker.agentId, "historical claim"); await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "done" });
    await writeFile(taskPaths(root, mesh.meshId, task.request.taskId).usageClaim, JSON.stringify({ schemaVersion: 1, meshId: mesh.meshId, claimantSessionFile: sessionFile, toolCallId: "retained-call", toolName: "mesh_wait", agentId: worker.agentId, taskId: task.request.taskId, claimedAt: new Date().toISOString() }));
    assert.equal((await readTask(root, mesh.meshId, task.request.taskId)).claimed, true); assert.equal(await reconcileMeshUsageClaims(root, mesh.meshId, sessionFile), 1); assert.equal((await readTask(root, mesh.meshId, task.request.taskId)).claimed, false);
}));

void test("persisted root startup reconciles an unpersisted usage claim before tools can observe it", async () => withRoot("mesh-root-usage-reconcile-", async root => {
    const sessionFile = join(root, "root-session.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root-session", rootSessionFile: sessionFile, recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const task = await createTask(root, mesh.meshId, worker.agentId, "account once"); await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "done" }); assert.equal((await claimTaskUsage(root, mesh.meshId, task.request.taskId, sessionFile, "lost-call", "mesh_get")).created, true);
    const files = await writeRuntimeFiles(root); const keybindings = await writeMeshKeybindings(root); const previous = process.env.PI_EXTENSION_KEYBINDINGS_PATH; process.env.PI_EXTENSION_KEYBINDINGS_PATH = keybindings; const branch = [{ type: "custom", customType: "mesh-root-binding", data: { schemaVersion: 1, meshId: mesh.meshId } }]; const ctx = { sessionManager: { getSessionId: () => "root-session", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { notify() {}, setStatus() {} }, isIdle: () => true } as never;
    try { const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env: {} }); assert.equal(pi.messageRenderers.has("mesh-event"), true); await pi.handlers.get("session_start")![0]!({}, ctx); assert.equal((await claimTaskUsage(root, mesh.meshId, task.request.taskId, sessionFile, "recovered-call", "mesh_get")).created, true); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" }); }
    finally { if (previous === undefined) delete process.env.PI_EXTENSION_KEYBINDINGS_PATH; else process.env.PI_EXTENSION_KEYBINDINGS_PATH = previous; }
}));

// Given a receipt written before its tool result, root startup removes the orphan before the immediate completion pass so the task becomes visible again.
void test("persisted root startup reconciles orphan receipts before completion pumping", async () => withRoot("mesh-root-receipt-reconcile-", async root => {
    const sessionFile = join(root, "root-session.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root-session", rootSessionFile: sessionFile, recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const endpointId = `root:${mesh.meshId}`; await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "root", harness: "pi", sessionId: "root-session", sessionFile }); const completion = { endpointId, endpointSessionFile: sessionFile }; const task = await createTaskStore(root, mesh.meshId, worker.agentId, "orphan receipt", { requesterEndpointId: endpointId, completion }); await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "visible after repair" }); await createCompletionReceipt(root, mesh.meshId, { endpointId, endpointSessionFile: sessionFile, claimantSessionFile: sessionFile, toolCallId: "lost-result", toolName: "mesh_get", canonicalArguments: { taskId: task.request.taskId }, taskIds: [task.request.taskId], maxTasksPerMesh: budgets.maxTasksPerMesh });
    const files = await writeRuntimeFiles(root); const keybindings = await writeMeshKeybindings(root); const previous = process.env.PI_EXTENSION_KEYBINDINGS_PATH; process.env.PI_EXTENSION_KEYBINDINGS_PATH = keybindings; const branch = [{ type: "custom", customType: "mesh-root-binding", data: { schemaVersion: 1, meshId: mesh.meshId } }]; const ctx = { sessionManager: { getSessionId: () => "root-session", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { notify() {}, setStatus() {} }, isIdle: () => true } as never;
    try { const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env: {}, setInterval() { return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); assert.deepEqual((await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile))!.receipts, []); assert.equal(pi.messages.length, 1); assert.equal((((pi.messages[0]!.message as any).details.sources[0].tasks as Array<{ taskId: string }>)[0]!.taskId), task.request.taskId); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" }); }
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
    const launchFor = (tools: string[]) => piLaunchDescriptor(runtimeConfig("/state"), { meshId, agentId, agentDirectory: `/state/meshes/${meshId}/agents/${agentId}`, role: "reviewer", taskPath: "/task", launchEnvelope: "/envelope.json", epochSnapshot: { ...envelope, self: { ...envelope.self, tools } } });
    const launch = launchFor([]);
    assert.deepEqual(launch.args.filter((value, index) => launch.args[index - 1] === "-e"), manifest);
    assert.ok(!launch.args.includes("--mode") && !launch.args.includes("--profile") && !launch.args.includes("--no-tools"));
    const launchTools = (value: ReturnType<typeof launchFor>) => value.args[value.args.indexOf("--tools") + 1]!.split(",");
    const configured = launchTools(launch);
    for (const name of REQUIRED_PEER_CAPABILITIES) assert.equal(configured.includes(name), true, `launch configures latent ${name}`);
    assert.equal(new Set(configured).size, configured.length);
    const union = launchTools(launchFor(["read", "mesh_send", "read"]));
    assert.equal(union.includes("read"), true);
    for (const name of REQUIRED_PEER_CAPABILITIES) assert.equal(union.includes(name), true, `launch retains configured ${name}`);
    assert.equal(new Set(union).size, union.length);
});

void test("native launch selects only the target role's extension contributions", () => {
    const meshId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const agentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const epochId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const roleSet = ["reviewer", "worker"];
    const childExtensions = {
        reviewer: ["/popup.ts", "/orchestration.ts", "/reviewer.ts", "/bridge.ts"],
        worker: ["/popup.ts", "/orchestration.ts", "/worker.ts", "/bridge.ts"],
    };
    const launchExtensions = (agent: "reviewer" | "worker") => {
        const envelope = buildLaunchEnvelope({ meshId, agentId, epochId, agent, mode: "ops", roleSet, catalog: settledAgentCatalog(), childExtensions });
        const launch = piLaunchDescriptor(runtimeConfig("/state"), { meshId, agentId, agentDirectory: `/state/meshes/${meshId}/agents/${agentId}`, role: agent, taskPath: "/task", launchEnvelope: "/envelope.json", epochSnapshot: envelope });
        return launch.args.filter((value, index) => launch.args[index - 1] === "-e");
    };

    assert.deepEqual(launchExtensions("reviewer"), childExtensions.reviewer);
    assert.deepEqual(launchExtensions("worker"), childExtensions.worker);
});
