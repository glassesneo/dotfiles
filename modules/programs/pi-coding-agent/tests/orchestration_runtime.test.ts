import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Value } from "typebox/value";
import { visibleWidth } from "@earendil-works/pi-tui";
import { activateMeshPeerToolsForSubmit, createMeshGetTool, createMeshSignalTool, createMeshStopTool, createMeshSubmitTool, createMeshWaitTool, registerOrchestration, stopPaletteMeshAgent, type ActiveCaller, type OrchestrationDependencies } from "../extensions_src/orchestration.ts";
import { buildLaunchEnvelope as buildLaunchEnvelopeV3, buildPolicySnapshot, validateOrchestrationConfig, type AgentLaunchEnvelope, type CallPolicy, type OrchestrationConfig, type RoleCatalog, type RoleDefinition } from "../extensions_src/utilities/agent_types.ts";
import type { ExecutionProfileConfig } from "../extensions_src/utilities/mode_types.ts";
import { availableContext, publishAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { bindAgentRuntime, readAgentRuntimeBinding } from "../extensions_src/utilities/orchestration_runtime.ts";
import { bindMeshEndpoint, readMeshEndpoint, registerMeshSignal, resolveRouteEndpoint, setMeshEndpointOffline } from "../extensions_src/utilities/orchestration_events.ts";
import { createExplicitStopNotice, listPendingTuiNotices } from "../extensions_src/utilities/orchestration_notices.ts";
import { readPressureAdmission, requestPressureAdmission } from "../extensions_src/utilities/orchestration_admission.ts";
import { createCompletionReceipt, readCompletionLedger } from "../extensions_src/utilities/orchestration_channel.ts";
import { withMeshLock } from "../extensions_src/utilities/orchestration_lock.ts";
import { MESH_PEER_TOOL_NAMES, piLaunchDescriptor } from "../extensions_src/utilities/orchestration_pi.ts";
import { projectMeshCompletionContext, receiptIdsFromToolResults } from "../extensions_src/utilities/orchestration_projection.ts";
import { claimTaskUsage, createTask as createTaskStore, ensurePolicyEpoch as ensurePolicyEpochStore, finishTask, initializeMesh, meshPaths, patchAgentStatus, prepareAgent, publishAgent, readAgentSnapshot, readPolicyEpoch, readTask, reconcileMeshUsageClaims, reserveMeshCapacity, taskPaths } from "../extensions_src/utilities/orchestration_store.ts";
import type { AgentSnapshot } from "../extensions_src/utilities/orchestration_types.ts";
import { withTemporaryRoot as withRoot } from "./test_helpers.ts";

const MESH_TOOLS = [...MESH_PEER_TOOL_NAMES];
const REQUIRED_PEER_CAPABILITIES = ["mesh_submit", "mesh_get", "mesh_wait", "mesh_channel", "mesh_stop", "mesh_signal"] as const;
const AGENT_ARTIFACT_EXTENSION = "/agent_artifact.ts";
const budgets = { maxLiveAgents: 4, maxConcurrentTasks: 4, maxTasksPerMesh: 16 };
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };
const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" };
const profiles: ExecutionProfileConfig = { schemaVersion: 1, profiles: { "pi-default": { model: "openai/test", thinkingLevel: "medium", harness: "pi" }, "cursor-fast": { model: "cursor/test", harness: "cursor-agent", harnessOptions: { mode: "agent", permissionPolicy: "allow-always", sandbox: "disabled", trustWorkspace: true, worktree: false } } } };
const role = (name: string): RoleDefinition => ({ description: `Synthetic ${name}`, tools: ["read"], instructions: `Perform ${name}.`, defaultProfile: "pi-default", contextPolicy: name === "gyaru" ? "prompt-only" : "project", childExtensionContributions: name === "reviewer" ? [AGENT_ARTIFACT_EXTENSION] : [] });
const catalog: RoleCatalog = { schemaVersion: 3, roles: Object.fromEntries(["explorer", "worker", "validator", "reviewer", "review-lens", "researcher", "searcher", "gyaru"].map(name => [name, role(name)])) };
const callPolicy: CallPolicy = { modes: { ops: { roles: ["worker", "reviewer", "researcher"] }, recon: { roles: ["explorer", "reviewer", "researcher"] } }, roles: { reviewer: { roles: ["review-lens", "validator"], profiles: [] }, researcher: { roles: ["searcher"], profiles: [] }, worker: { roles: [], profiles: ["cursor-fast"] } } };
function settledAgentCatalog(): RoleCatalog { return structuredClone(catalog); }
function settledAgentDefinition(name: string): RoleDefinition { return structuredClone(catalog.roles[name] ?? role(name)); }
function settledMeshGcConfig() { return { contextHeadroomTokens: 32768, periodicIntervalMs: 5000, activityHeartbeatMs: 2000, activityStaleMs: 10000, roles: Object.fromEntries(Object.keys(catalog.roles).map(name => [name, { collectAt: 2, retain: 1, pressureFloor: 0 }])) }; }
async function ensurePolicyEpoch(stateRoot: string, meshId: string, input: { mode: string; roleSet: string[]; roles: Record<string, RoleDefinition> }) { const localCatalog = { schemaVersion: 3 as const, roles: input.roles }; const localPolicy: CallPolicy = { modes: { [input.mode]: { roles: input.roleSet } }, roles: Object.fromEntries(input.roleSet.map(name => [name, callPolicy.roles[name] ?? { roles: [], profiles: [] }])) }; return ensurePolicyEpochStore(stateRoot, meshId, { mode: input.mode, catalog: localCatalog, profiles, callPolicy: localPolicy }); }
function createTask(stateRoot: string, meshId: string, agentId: string, prompt: string) { return createTaskStore(stateRoot, meshId, agentId, prompt, `root:${meshId}`); }
function buildLaunchEnvelope(input: { meshId: string; agentId: string; epochId: string; agent: string; mode: string; roleSet: string[]; catalog: RoleCatalog; childExtensions: Record<string, string[]> }): AgentLaunchEnvelope { const policy: CallPolicy = { modes: { [input.mode]: { roles: input.roleSet } }, roles: Object.fromEntries(input.roleSet.map(name => [name, callPolicy.roles[name] ?? { roles: [], profiles: [] }])) }; const snapshot = buildPolicySnapshot({ mode: input.mode, catalog: input.catalog, profiles, callPolicy: policy }); const childExtensions = Object.fromEntries(Object.keys(snapshot.roles).map(name => [name, input.childExtensions[name] ?? []])); return buildLaunchEnvelopeV3({ meshId: input.meshId, agentId: input.agentId, epochId: input.epochId, role: input.agent, snapshot, childExtensions }); }

function runtimeConfig(stateRoot: string): OrchestrationConfig {
    return { schemaVersion: 3, stateRoot, tmux: "/tmux", returnParentCommand: "/parent", parentNavigationHint: "parent", historyViewerExtension: "/history.ts", popupExtension: "/popup.ts", orchestrationExtension: "/orchestration.ts", childBridgeExtension: "/bridge.ts", harnesses: { pi: { adapter: "pi-native", command: "/pi" }, "cursor-agent": { adapter: "cursor-acp", command: "/cursor", workerCommand: "/node", workerEntrypoint: "/worker.ts" } }, natureHandleWords: ["May"], callPolicy, budgets, gc: settledMeshGcConfig() };
}

void test("schema-v3 orchestration policy accepts coherent role hysteresis and rejects unsafe thresholds", () => {
    const config = runtimeConfig("/state");
    assert.deepEqual(validateOrchestrationConfig(config).gc, config.gc);
    const unsafe = structuredClone(config);
    unsafe.gc.roles.worker!.pressureFloor = unsafe.gc.roles.worker!.retain + 1;
    assert.throws(() => validateOrchestrationConfig(unsafe), /hysteresis/u);
    assert.throws(() => validateOrchestrationConfig({ ...config, schemaVersion: 2 }), /schemaVersion/u);
});

// Admission: completion context projection is the model-visible exactly-once boundary; schemas cannot detect duplicate, partially consumed, or malformed persisted custom messages.
// Given valid, malformed, legacy, duplicate, and partially receipted completion messages, when context is projected, the model preserves one frozen valid summary and rejects invalid protocol shapes.
void test("completion context projection preserves valid open channels with legacy compatibility", () => {
    const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; const firstTask = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; const secondTask = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; const receiptId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const openChannels = [{ channel: "A", terminal: 0, total: 1 }, { channel: "B", terminal: 1, total: 3 }];
    const payload = { eventId, route: "channel", channel: "A", batchId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", settledAt: "2026-01-01T00:00:00.000Z", tasks: [{ taskId: firstTask, state: "succeeded" }, { taskId: secondTask, state: "failed" }], openChannels };
    const completion = { role: "custom", customType: "mesh-event", content: "stale", details: { eventId, kind: "completion", payload } };
    const receipt = { role: "toolResult", toolName: "mesh_get", details: { accounting: { receiptIds: [receiptId], receivedTaskIds: [firstTask], claimedTaskIds: [] } } };
    const question = { role: "toolResult", toolName: "question", details: { answers: [{ id: "choice" }] } };
    const signal = { role: "custom", customType: "mesh-event", content: "signal", details: { eventId: "ffffffff-ffff-4fff-8fff-ffffffffffff", kind: "signal", payload: { topic: "x" } } };
    assert.deepEqual(receiptIdsFromToolResults([receipt]), [receiptId]);
    const projected = projectMeshCompletionContext([completion, question, receipt, structuredClone(completion), signal], new Set([firstTask]));
    assert.deepEqual(projected.eventIds, [eventId]); assert.equal(projected.messages.length, 4); assert.equal(projected.messages[1], question); assert.equal(projected.messages[2], receipt); assert.equal(projected.messages[3], signal);
    const residual = projected.messages[0] as typeof completion; assert.deepEqual(residual.details.payload.tasks, [{ taskId: secondTask, state: "failed" }]); assert.deepEqual(residual.details.payload.openChannels, openChannels); assert.match(residual.content, new RegExp(secondTask, "u")); assert.doesNotMatch(residual.content, new RegExp(firstTask, "u"));

    const legacyPayload = { ...payload } as Record<string, unknown>; delete legacyPayload.openChannels;
    const legacy = { ...completion, details: { ...completion.details, payload: legacyPayload } };
    const legacyProjected = projectMeshCompletionContext([legacy], new Set());
    assert.equal(Object.hasOwn((legacyProjected.messages[0] as typeof legacy).details.payload, "openChannels"), false);

    for (const malformed of [
        { ...payload, openChannels: "A" },
        { ...payload, openChannels: [{ channel: "A", terminal: 0, total: 1 }, { channel: "A", terminal: 0, total: 2 }] },
        { ...payload, openChannels: [{ channel: "B", terminal: 1, total: 1 }] },
        { ...payload, openChannels: [{ channel: "B", terminal: 0, total: 1, taskId: firstTask }] },
    ]) {
        const invalid = { ...completion, details: { ...completion.details, payload: malformed } };
        assert.throws(() => projectMeshCompletionContext([invalid], new Set()), /Malformed mesh completion/u);
    }
    const conflicting = structuredClone(completion); conflicting.details.payload.openChannels[0]!.total = 2; assert.throws(() => projectMeshCompletionContext([completion, conflicting], new Set()), /Conflicting duplicate/u);
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
    const prepared = await prepareAgent(root, meshId, { reservationId: reservation.reservationId, role: roleName, selectedProfile: definition.defaultProfile, harness: "pi", cwd: root, roleSnapshot: definition, profileSnapshot: profiles.profiles[definition.defaultProfile]!, launchEnvelope: "pending", epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    const epoch = await readPolicyEpoch(root, meshId, epochId);
    const childExtensions = Object.fromEntries(epoch.roleSet.map(name => [name, ["/popup.ts", "/orchestration.ts", ...epoch.roles[name]!.childExtensionContributions, "/bridge.ts"]]));
    const envelope = buildLaunchEnvelope({ meshId, agentId: prepared.agentId, epochId, agent: roleName, mode: epoch.mode, roleSet: epoch.roleSet, catalog: settledAgentCatalog(), childExtensions });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(envelope), { mode: 0o600 });
    await publishAgent(root, meshId, prepared.paths, { agentId: prepared.agentId, epochId, role: roleName, selectedProfile: definition.defaultProfile, harness: "pi", cwd: root, roleSnapshot: definition, profileSnapshot: profiles.profiles[definition.defaultProfile]!, launchEnvelope: envelopePath, tmux, capabilities, ...(options.parentAgentId ? { parentAgentId: options.parentAgentId } : {}), creatorSessionId: "creator" });
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

void test("core tool schemas and execution require exactly one selector at each single-target boundary", async () => {
    const targets = { worker: settledAgentDefinition("worker") };
    const inactive = () => undefined;
    const deps = { configPath: "/missing", env: {}, exec: absentTmux, activeCaller: inactive } as OrchestrationDependencies;
    const submit = createMeshSubmitTool(deps, targets, ["cursor-fast"]);
    assert.equal(Value.Check(submit.parameters, { agent: "worker", prompt: "work", channel: "A" }), true);
    assert.equal(Value.Check(submit.parameters, { agentId: "agent-id", prompt: "work" }), true);
    assert.equal(Value.Check(submit.parameters, { profile: "cursor-fast", prompt: "work" }), true);
    assert.equal(Value.Check(submit.parameters, { agent: "unknown", prompt: "work" }), false);
    await assert.rejects(submit.execute("call", { agent: "worker", agentId: "id", prompt: "work" }, undefined, undefined, {} as never), /exactly one/u);
    await assert.rejects(createMeshGetTool(deps).execute("call", { taskId: "task", agentId: "agent" }, undefined, undefined, {} as never), /exactly one/u);
    assert.equal(Value.Check(createMeshWaitTool(deps).parameters, { taskIds: ["one", "two"] }), true); assert.equal(Value.Check(createMeshWaitTool(deps).parameters, { taskIds: ["one", "one"] }), false);
    await assert.rejects(createMeshStopTool(deps).execute("call", {}, undefined, undefined, {} as never), /exactly one/u);
    await assert.rejects(createMeshStopTool(deps).execute("call", { taskId: "task", reason: "must not alter task-stop semantics" }, undefined, undefined, {} as never), /taskId rejects reason/u);
});

// Given a narrowing epoch committed before the reservation lock, dispatch rejects without any lifecycle mutation.
void test("new-agent dispatch rejects stale authority before reservation",  async () => withRoot("mesh-dispatch-reauthorize-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const initial = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const narrowed = await ensurePolicyEpoch(root, mesh.meshId, { mode: "recon", roleSet: ["explorer"], roles: { explorer: settledAgentDefinition("explorer") } }); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); let current = caller(mesh.meshId, initial, { identity: "mode:ops", sessionFile }); let crossings = 0; const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => current, authorityBarrier: async () => { crossings += 1; if (crossings === 3) current = caller(mesh.meshId, narrowed, { identity: "mode:recon", sessionFile }); } }; const ctx = { cwd: root, sessionManager: { getSessionId: () => "root", getSessionFile: () => sessionFile } } as never;
    await assert.rejects(createMeshSubmitTool(deps, { worker: settledAgentDefinition("worker") }).execute("stale-dispatch", { agent: "worker", prompt: "must not launch" }, undefined, undefined, ctx), /authority changed before reservation/u); assert.equal(crossings, 2); const paths = meshPaths(root, mesh.meshId); assert.deepEqual(await readdir(paths.reservations), []); assert.deepEqual(await readdir(paths.agents), []); assert.deepEqual(await readdir(paths.tasks), []);
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
        await assert.rejects(createMeshSubmitTool(deps, { worker: settledAgentDefinition("worker") }).execute("stale-binding", { agent: "worker", prompt: "must not mutate" }, undefined, undefined, ctx), /stale or offline/u);
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
    await assert.rejects(createMeshSubmitTool(deps, { explorer: settledAgentDefinition("explorer") }).execute("reuse", { agentId: worker.agentId, prompt: "not authorized" }, undefined, undefined, {} as never), /durable caller session/u);
    const stopped = await createMeshStopTool(deps).execute("stop", { agentId: worker.agentId }, undefined, undefined, {} as never); assert.equal((stopped.details as any).stopDisposition, "already-terminal");
}));

// Given forged lateral task and agent handles, child management tools reject before lifecycle mutation.
void test("child authority is requester- and direct-parent-scoped", async () => withRoot("mesh-child-authority-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const owner = await publishWorker(root, mesh.meshId, epoch.epochId); const lateral = await publishWorker(root, mesh.meshId, epoch.epochId); const owned = await publishWorker(root, mesh.meshId, epoch.epochId, { parentAgentId: owner.agentId }); const lateralTask = await createTaskStore(root, mesh.meshId, lateral.agentId, "lateral", `root:${mesh.meshId}`); await finishTask(root, mesh.meshId, lateralTask.request.taskId, { outcome: "succeeded", output: "done" }); const files = await writeRuntimeFiles(root); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "agent:worker", agentId: owner.agentId, endpointId: `agent:${owner.agentId}` }) };
    await assert.rejects(createMeshGetTool(deps).execute("get", { taskId: lateralTask.request.taskId }, undefined, undefined, {} as never), /not allowed to inspect task/u);
    await assert.rejects(createMeshStopTool(deps).execute("stop", { agentId: lateral.agentId }, undefined, undefined, {} as never), /not its direct parent/u);
    const direct = await createMeshGetTool(deps).execute("get-child", { agentId: owned.agentId }, undefined, undefined, {} as never); assert.equal((direct.details as any).agent.agentId, owned.agentId);
}));

// Admission: nested result integration and task-level retrieval ownership cross runtime, endpoint, and accounting boundaries that schemas cannot observe.
// Given an outbound reviewer and terminal descendants, when mesh_wait receives all IDs, the caller observes ordered full results and one durable receipt/usage claim per task while root execution is rejected.
void test("nested mesh_wait returns all terminal descendant results once in input order", async () => withRoot("mesh-wait-terminal-", async root => {
    const sessionFile = join(root, "reviewer.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets: { ...budgets, maxConcurrentTasks: 8 } });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["reviewer"], roles: { reviewer: settledAgentDefinition("reviewer"), "review-lens": settledAgentDefinition("review-lens"), validator: settledAgentDefinition("validator") } });
    const reviewer = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "reviewer" }); const lens = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "review-lens", parentAgentId: reviewer.agentId }); const validator = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "validator", parentAgentId: reviewer.agentId });
    const endpointId = `agent:${reviewer.agentId}`; await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "agent", agentId: reviewer.agentId, harness: "pi", sessionId: "reviewer", sessionFile }); const completion = { endpointId, endpointSessionFile: sessionFile, mode: "direct" as const }; const requester = { requesterEndpointId: endpointId, requesterAgentId: reviewer.agentId, completion };
    const first = await createTaskStore(root, mesh.meshId, lens.agentId, "lens evidence", requester); const second = await createTaskStore(root, mesh.meshId, validator.agentId, "validation evidence", requester); await finishTask(root, mesh.meshId, first.request.taskId, { outcome: "failed", output: "lens output", error: "lens finding" }); await finishTask(root, mesh.meshId, second.request.taskId, { outcome: "stopped", output: "validator partial", error: "validator stopped" });
    const files = await writeRuntimeFiles(root); const current = caller(mesh.meshId, epoch, { identity: "agent:reviewer", agentId: reviewer.agentId, envelope: reviewer.envelope, endpointId, sessionFile }); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => current }; await createMeshGetTool(deps).execute("get-first", { taskId: first.request.taskId }, undefined, undefined, {} as never); const wait = createMeshWaitTool(deps);
    const result = await wait.execute("wait-call", { taskIds: [second.request.taskId, first.request.taskId] }, undefined, undefined, {} as never); const details = result.details as any; assert.deepEqual(details.tasks.map((snapshot: AgentSnapshot) => snapshot.task!.request.taskId), [second.request.taskId, first.request.taskId]); assert.deepEqual(details.tasks.map((snapshot: AgentSnapshot) => snapshot.task!.status.state), ["stopped", "failed"]); assert.deepEqual(details.accounting.receivedTaskIds, [second.request.taskId]); assert.deepEqual(details.accounting.claimedTaskIds, [second.request.taskId]); assert.ok(result.usage);
    const repeated = await wait.execute("wait-again", { taskIds: [second.request.taskId, first.request.taskId] }, undefined, undefined, {} as never); assert.deepEqual((repeated.details as any).accounting.receivedTaskIds, []); assert.deepEqual((repeated.details as any).accounting.claimedTaskIds, []); assert.equal(repeated.usage, undefined);
    const terminalSnapshot = await readAgentSnapshot(root, mesh.meshId, validator.agentId, second.request.taskId); const abort = new AbortController(); const abortRace = createMeshWaitTool(deps, async () => { abort.abort(new Error("abort at terminal barrier")); return [terminalSnapshot]; }); await assert.rejects(abortRace.execute("abort-race", { taskIds: [second.request.taskId] }, abort.signal, undefined, {} as never), /abort at terminal barrier/u); const closing = new AbortController(); const shutdownRace = createMeshWaitTool(deps, async () => { closing.abort(new Error("shutdown at terminal barrier")); return [terminalSnapshot]; }, () => closing.signal); await assert.rejects(shutdownRace.execute("shutdown-race", { taskIds: [second.request.taskId] }, undefined, undefined, {} as never), /shutdown at terminal barrier/u);
    const ledger = await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile); assert.equal(ledger!.receipts.length, 2); const rootCaller = caller(mesh.meshId, epoch, { identity: "mode:ops", endpointId: `root:${mesh.meshId}`, sessionFile }); const rootWait = createMeshWaitTool({ ...deps, activeCaller: () => rootCaller }); await assert.rejects(rootWait.execute("root-wait", { taskIds: [first.request.taskId] }, undefined, undefined, {} as never), /only to a durable nested Pi caller/u);
}));

// Given concurrent nested waiters on a running descendant, when the shared pump observes terminalization, both barriers return while cancellation releases only its waiter.
void test("nested waiters share completion passes and abort without stopping descendant tasks", async () => withRoot("mesh-wait-pump-", async root => {
    const sessionFile = join(root, "reviewer.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["reviewer"], roles: { reviewer: settledAgentDefinition("reviewer"), "review-lens": settledAgentDefinition("review-lens"), validator: settledAgentDefinition("validator") } }); const reviewer = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "reviewer" }); const lens = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "review-lens", parentAgentId: reviewer.agentId }); await patchAgentStatus(root, mesh.meshId, reviewer.agentId, { meshToolsEnabled: true }); const endpointId = `agent:${reviewer.agentId}`; const completion = { endpointId, endpointSessionFile: sessionFile, mode: "direct" as const }; const task = await createTaskStore(root, mesh.meshId, lens.agentId, "running descendant", { requesterEndpointId: endpointId, requesterAgentId: reviewer.agentId, completion }); const files = await writeRuntimeFiles(root); const ctx = { sessionManager: { getSessionId: () => "reviewer", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => false } as never; let tick!: () => Promise<void>; const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env: { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: reviewer.agentId, PI_AGENT_RESOLVED_AGENT: reviewer.envelopePath }, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); const wait = pi.tools.get("mesh_wait")!;
    const first = wait.execute("wait-one", { taskIds: [task.request.taskId] }, undefined, undefined, {}); const second = wait.execute("wait-two", { taskIds: [task.request.taskId] }, undefined, undefined, {}); await new Promise(resolve => setImmediate(resolve)); assert.equal((await readTask(root, mesh.meshId, task.request.taskId)).status.state, "created"); await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "integrated evidence" }); await tick(); const results = await Promise.all([first, second]); assert.equal(results.every(result => result.details.tasks[0].task.result.output === "integrated evidence"), true); assert.equal(results.flatMap(result => result.details.accounting.receivedTaskIds).length, 1);
    const next = await createTaskStore(root, mesh.meshId, lens.agentId, "abort only wait", { requesterEndpointId: endpointId, requesterAgentId: reviewer.agentId, completion }); const abort = new AbortController(); const aborted = wait.execute("wait-abort", { taskIds: [next.request.taskId] }, abort.signal, undefined, {}); await new Promise(resolve => setImmediate(resolve)); abort.abort(new Error("cancel nested barrier")); await assert.rejects(aborted, /cancel nested barrier/u); assert.equal((await readTask(root, mesh.meshId, next.request.taskId)).status.state, "created"); const endpoint = await readMeshEndpoint(root, mesh.meshId, endpointId); const lost = wait.execute("wait-endpoint-loss", { taskIds: [next.request.taskId] }, undefined, undefined, {}); let loss: unknown; let lossSettled = false; const observedLoss = lost.then(() => { lossSettled = true; }, (error: unknown) => { loss = error; lossSettled = true; }); await setMeshEndpointOffline(root, mesh.meshId, endpointId, endpoint); for (let attempt = 0; attempt < 10 && !lossSettled; attempt += 1) { await tick(); await new Promise(resolve => setImmediate(resolve)); } await observedLoss; assert.match(loss instanceof Error ? loss.message : String(loss), /rotated or went offline/u); assert.equal((await readTask(root, mesh.meshId, next.request.taskId)).status.state, "created"); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Given a lateral endpoint and task, child routing rejects both before event persistence.
void test("child route allows root and direct descendants only", async () => withRoot("mesh-child-route-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: "/root.jsonl", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const owner = await publishWorker(root, mesh.meshId, epoch.epochId); const lateral = await publishWorker(root, mesh.meshId, epoch.epochId); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile: "/root.jsonl" }); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${lateral.agentId}`, kind: "agent", agentId: lateral.agentId, harness: "pi", sessionId: "lateral", sessionFile: "/lateral.jsonl" }); const task = await createTaskStore(root, mesh.meshId, lateral.agentId, "lateral", `root:${mesh.meshId}`); const files = await writeRuntimeFiles(root); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "agent:worker", agentId: owner.agentId, endpointId: `agent:${owner.agentId}` }) }; const route = createMeshSignalTool(deps);
    await assert.rejects(route.execute("route-lateral", { receiver: lateral.agentId, delivery: "steer", topic: "x", text: "x" }, undefined, undefined, {} as never), /not its direct parent/u);
    await assert.rejects(route.execute("route-task", { receiver: "root", delivery: "steer", topic: "x", text: "x", taskIds: [task.request.taskId] }, undefined, undefined, {} as never), /not allowed to signal task/u);
}));

// Admission: schemas cannot observe native Pi prompt composition; a stale role Skill injection would reintroduce optional ownership while a missing addition would drop mandatory instructions.
// Given a prompt-only Pi child and a discovered disabled Skill, session startup appends only the synthetic role instructions, creates no route endpoint or management surface, and root routing cannot deliver a message.
void test("prompt-only child receives only role instructions and remains isolated from routed management", async () => withRoot("mesh-prompt-only-runtime-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const gyaruCatalog: RoleCatalog = { schemaVersion: 3, roles: { gyaru: settledAgentDefinition("gyaru") } }; const gyaruPolicy: CallPolicy = { modes: { ops: { roles: ["gyaru"] } }, roles: { gyaru: { roles: [], profiles: [] } } }; const epoch = await ensurePolicyEpochStore(root, mesh.meshId, { mode: "ops", catalog: gyaruCatalog, profiles, callPolicy: gyaruPolicy }); const gyaru = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "gyaru" }); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "gyaru.jsonl"); await writeFile(sessionFile, ""); const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: gyaru.agentId, PI_AGENT_RESOLVED_AGENT: gyaru.envelopePath }; let tick!: () => Promise<void>; const pi = new PiMock(); const ctx = { sessionManager: { getSessionId: () => "gyaru", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => true } as never; await registerOrchestration(pi as never, { ...files, env, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx);
    const prompt = await pi.handlers.get("before_agent_start")![0]!({ systemPrompt: "base", systemPromptOptions: { skills: [{ name: "retired-role-method", description: "legacy", filePath: "/legacy/SKILL.md", disableModelInvocation: true }] } }, ctx);
    assert.deepEqual(prompt, { systemPrompt: "base\n\nPerform gyaru." });
    assert.deepEqual(pi.active, []); assert.equal(pi.tools.has("mesh_enable"), false); assert.equal(pi.handlers.has("context"), false); assert.equal(pi.eventHandlers.get("command-palette:contribution")?.length ?? 0, 0);
    await assert.rejects(readMeshEndpoint(root, mesh.meshId, `agent:${gyaru.agentId}`), /ENOENT/u); await assert.rejects(resolveRouteEndpoint(root, mesh.meshId, gyaru.agentId), /not a durable Pi endpoint/u); await tick(); assert.deepEqual(pi.messages, []); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

void test("mesh_submit profile selector exposes only authorized names and rejects forged profiles before launch", async () => withRoot("mesh-profile-schema-", async root => {
    const meshId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; const agentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; const epochId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; const snapshot = buildPolicySnapshot({ mode: "ops", catalog, profiles, callPolicy }); const envelope = buildLaunchEnvelopeV3({ meshId, agentId, epochId, role: "worker", snapshot, childExtensions: Object.fromEntries(Object.keys(snapshot.roles).map(name => [name, []])) }); const epoch = { schemaVersion: 3, meshId, epochId, ...snapshot, policyDigest: envelope.policyDigest, createdAt: new Date().toISOString(), roleSet: snapshot.directRoles } as const; const configPath = join(root, "orchestration.json"); await writeFile(configPath, JSON.stringify(runtimeConfig(root))); const deps = { configPath, env: {}, exec: absentTmux, activeCaller: () => caller(meshId, epoch as never, { identity: "agent:worker", agentId, envelope, endpointId: `agent:${agentId}` }) };
    const tool = createMeshSubmitTool(deps, {}, ["cursor-fast"]); assert.equal(Value.Check(tool.parameters, { profile: "cursor-fast", prompt: "same purpose" }), true); assert.equal(Value.Check(tool.parameters, { profile: "pi-default", prompt: "forged" }), false);
}));

// Given a live reusable agent, mesh_submit returns its durable nonterminal handle before the task is terminal and that same handle later observes successful completion.
void test("mesh_submit existing-agent reuse succeeds immediately before terminal completion", async () => withRoot("mesh-reuse-success-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId);
    await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); const files = await writeRuntimeFiles(root);
    const exec = async (_command: string, args: string[]) => { if (args.includes("display-message")) return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("list-panes")) return { stdout: `${tmux.paneId}\t0\n`, stderr: "", code: 0 }; if (args.includes("has-session")) return { stdout: "", stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; };
    const deps = { ...files, env: {}, exec, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) };
    const submitted = await createMeshSubmitTool(deps, { worker: settledAgentDefinition("worker") }).execute("reuse-success", { agentId: worker.agentId, prompt: "complete after submit returns" }, undefined, undefined, { cwd: root } as never);
    const taskId = (submitted.details as any).task.request.taskId as string; assert.equal((submitted.details as any).task.status.state, "created"); assert.equal((await readTask(root, mesh.meshId, taskId)).status.state, "created");
    await finishTask(root, mesh.meshId, taskId, { outcome: "succeeded", output: "done after immediate return" }); assert.equal((await readTask(root, mesh.meshId, taskId)).status.state, "succeeded");
}));

void test("existing-agent submit rejects conservative unknown activity without creating a task", async () => withRoot("mesh-reuse-activity-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId, { activity: false }); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) };
    await assert.rejects(createMeshSubmitTool(deps, { worker: settledAgentDefinition("worker") }).execute("submit", { agentId: worker.agentId, prompt: "must not reroute" }, undefined, undefined, { cwd: root } as never), /not accepting tasks.*activity=unknown/iu);
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
// Given a fresh authorized child, when staged activation crosses Pi's active-tool and persistence boundary, all six peers become active atomically and either failure restores the exact prior set.
void test("staged submit activation is additive, complete, and rolls back activation or persistence failure", async () => {
    const meshId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; const epochId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; const agentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; const snapshot = buildPolicySnapshot({ mode: "ops", catalog, profiles, callPolicy }); const envelope = buildLaunchEnvelopeV3({ meshId, agentId, epochId, role: "reviewer", snapshot, childExtensions: Object.fromEntries(Object.keys(snapshot.roles).map(name => [name, []])) }); const epoch = { schemaVersion: 3, meshId, epochId, ...snapshot, policyDigest: envelope.policyDigest, createdAt: "2026-01-01T00:00:00.000Z", roleSet: snapshot.directRoles } as const; const activeCaller = caller(meshId, epoch as never, { identity: "agent:reviewer", agentId, envelope, endpointId: `agent:${agentId}` });
    const pi = new PiMock(); for (const name of MESH_TOOLS) pi.registerTool({ name }); pi.active = ["read", "mesh_submit"]; let persisted = 0;
    await activateMeshPeerToolsForSubmit(pi as never, activeCaller, async () => { persisted += 1; });
    assert.deepEqual(MESH_TOOLS.filter(name => !pi.active.includes(name)), []); assert.equal(new Set(pi.active).size, pi.active.length); assert.equal(persisted, 1);

    const incomplete = new PiMock(); for (const name of MESH_TOOLS) incomplete.registerTool({ name }); incomplete.active = ["read", "mesh_submit"]; const setActive = incomplete.setActiveTools.bind(incomplete); incomplete.setActiveTools = names => setActive(names.includes("mesh_signal") ? names.filter(name => name !== "mesh_signal") : names); let incompletePersisted = 0;
    await assert.rejects(activateMeshPeerToolsForSubmit(incomplete as never, activeCaller, async () => { incompletePersisted += 1; }), /activation incomplete.*mesh_signal/u); assert.deepEqual(incomplete.active, ["read", "mesh_submit"]); assert.equal(incompletePersisted, 0);

    const persistence = new PiMock(); for (const name of MESH_TOOLS) persistence.registerTool({ name }); persistence.active = ["read", "mesh_submit"];
    await assert.rejects(activateMeshPeerToolsForSubmit(persistence as never, activeCaller, async () => { throw new Error("status persistence failed"); }), /status persistence failed/u); assert.deepEqual(persistence.active, ["read", "mesh_submit"]);

    const legacy = new PiMock(); for (const name of MESH_TOOLS.filter(name => name !== "mesh_wait")) legacy.registerTool({ name }); legacy.active = ["read", "mesh_submit"]; await assert.rejects(activateMeshPeerToolsForSubmit(legacy as never, activeCaller, async () => {}), /restart required.*mesh_wait/u); assert.deepEqual(legacy.active, ["read", "mesh_submit"]);
});

// Admission: the first authorized child dispatch must expose the complete management surface before task mutation and persisted state must restore that surface after reload; Pi's registry mock and schemas do not guarantee either boundary.
// Given a fresh reviewer child, when its first submit targets an authorized review-lens, the next request sees all peers, persistence restores them after reload, and pre-submit persistence failure creates no task.
void test("reviewer first submit unlocks all peers transactionally and reload restores them", async () => withRoot("mesh-staged-submit-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["reviewer"], roles: { reviewer: settledAgentDefinition("reviewer"), "review-lens": settledAgentDefinition("review-lens"), validator: settledAgentDefinition("validator") } });
    const reviewer = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "reviewer" }); const lens = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "review-lens", parentAgentId: reviewer.agentId });
    const files = await writeRuntimeFiles(root); const sessionFile = join(root, "reviewer.jsonl"); await writeFile(sessionFile, ""); const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: reviewer.agentId, PI_AGENT_RESOLVED_AGENT: reviewer.envelopePath }; const ctx = { sessionManager: { getSessionId: () => "reviewer-session", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => false } as never;
    const liveExec = async (_command = "", args: string[] = []) => { if (args.includes("display-message")) return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("list-panes")) return { stdout: `${tmux.paneId}\t0\n`, stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; };
    const pi = new PiMock(); pi.exec = liveExec; await registerOrchestration(pi as never, { ...files, env, setInterval() { return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); assert.deepEqual(pi.active, ["read", "mesh_submit"]);
    const registered = pi.tools.get("mesh_submit")!; assert.equal(Value.Check(registered.parameters, { agent: "review-lens", prompt: "focused review" }), true); assert.equal(Value.Check(registered.parameters, { agent: "validator", prompt: "focused validation" }), true); assert.equal(Value.Check(registered.parameters, { agent: "worker", prompt: "forged" }), false);

    const currentEpoch = await readPolicyEpoch(root, mesh.meshId, epoch.epochId); const directDeps = { ...files, env, exec: liveExec, activeCaller: () => caller(mesh.meshId, currentEpoch, { identity: "agent:reviewer", agentId: reviewer.agentId, envelope: reviewer.envelope, endpointId: `agent:${reviewer.agentId}`, sessionFile }) }; const before = await readdir(meshPaths(root, mesh.meshId).tasks); const failing = createMeshSubmitTool(directDeps, { "review-lens": settledAgentDefinition("review-lens"), validator: settledAgentDefinition("validator") }, [], activeCaller => activateMeshPeerToolsForSubmit(pi as never, activeCaller, async () => { throw new Error("status persistence failed"); }));
    await assert.rejects(failing.execute("failed-staged-submit", { agentId: lens.agentId, prompt: "must not mutate lifecycle" }, undefined, undefined, { cwd: root } as never), /status persistence failed/u); assert.deepEqual(await readdir(meshPaths(root, mesh.meshId).tasks), before); assert.deepEqual(pi.active, ["read", "mesh_submit"]);

    const submitted = await registered.execute("reviewer-to-lens", { agentId: lens.agentId, prompt: "inspect the bounded lens" }, undefined, undefined, { cwd: root } as never); assert.equal((submitted.details as any).agent.role, "review-lens"); assert.deepEqual(MESH_TOOLS.filter(name => !pi.active.includes(name)), []); assert.equal((await readAgentSnapshot(root, mesh.meshId, reviewer.agentId)).status.meshToolsEnabled, true);
    await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" }); const reloaded = new PiMock(); await registerOrchestration(reloaded as never, { ...files, env, setInterval() { return "timer"; }, clearInterval() {} }); await reloaded.handlers.get("session_start")![0]!({}, ctx); assert.deepEqual(MESH_TOOLS.filter(name => !reloaded.active.includes(name)), []); await reloaded.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

void test("post-start steer and followUp signals do not unlock a fresh outbound child", async () => withRoot("mesh-post-start-signals-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["reviewer"], roles: { reviewer: settledAgentDefinition("reviewer"), "review-lens": settledAgentDefinition("review-lens"), validator: settledAgentDefinition("validator") } });
    const reviewer = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "reviewer" });
    const task = await createTask(root, mesh.meshId, reviewer.agentId, "active child task");
    const files = await writeRuntimeFiles(root); const sessionFile = join(root, "child-session.jsonl"); await writeFile(sessionFile, "");
    const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: reviewer.agentId, PI_AGENT_RESOLVED_AGENT: reviewer.envelopePath };
    const statuses: Array<[string, string | undefined]> = []; const notifications: string[] = [];
    const ctx = { sessionManager: { getSessionId: () => "child-session", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus(key: string, text: string | undefined) { statuses.push([key, text]); }, notify(text: string) { notifications.push(text); } }, isIdle: () => false } as never;
    let tick!: () => Promise<void>; const pi = new PiMock();
    await registerOrchestration(pi as never, { ...files, env, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} });
    await pi.handlers.get("session_start")![0]!({}, ctx);
    assert.deepEqual(pi.active, ["read", "mesh_submit"]);

    const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${reviewer.agentId}`, kind: "agent", agentId: reviewer.agentId, harness: "pi", sessionId: "child-session", sessionFile });
    for (const delivery of ["steer", "followUp"] as const) {
        const signal = await registerMeshSignal(root, mesh.meshId, { callerEndpointId: `root:${mesh.meshId}`, toolCallId: `inbound-${delivery}`, endpoint, delivery, topic: delivery, text: `Deliver ${delivery}`, canonicalArguments: { action: "signal", receiver: reviewer.agentId, delivery, topic: delivery, text: `Deliver ${delivery}` } });
        await tick();
        const received = pi.messages.at(-1)!;
        assert.equal((received.message as { customType: string }).customType, "mesh-event");
        assert.deepEqual(received.options, { deliverAs: delivery, triggerTurn: false });
        const persisted = JSON.parse(await readFile(join(meshPaths(root, mesh.meshId).events, `${signal.eventId}.json`), "utf8")) as { state: string };
        assert.equal(persisted.state, "injected");
    }
    assert.deepEqual(pi.active, ["read", "mesh_submit"]);
    assert.equal((await readAgentSnapshot(root, mesh.meshId, reviewer.agentId, task.request.taskId)).task?.interventions.length, 0);
    assert.equal((await readAgentSnapshot(root, mesh.meshId, reviewer.agentId)).status.meshToolsEnabled, false);
    assert.deepEqual(notifications, []); assert.equal(statuses.some(([key]) => key === "mesh-event-pump"), false);
    await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Given direct task completions while the Pi runtime is idle and busy, the completion pump requests a turn only for idle delivery and uses turn-boundary steer in both cases.
void test("completion pump triggers an idle turn but leaves busy steer non-triggering", async () => withRoot("mesh-completion-trigger-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
    const receiver = await publishWorker(root, mesh.meshId, epoch.epochId); const peer = await publishWorker(root, mesh.meshId, epoch.epochId); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "completion-session.jsonl"); await writeFile(sessionFile, ""); const endpointId = `agent:${receiver.agentId}`; const completion = { endpointId, endpointSessionFile: sessionFile, mode: "direct" as const };
    const requester = { requesterEndpointId: endpointId, requesterAgentId: receiver.agentId, completion }; const first = await createTaskStore(root, mesh.meshId, receiver.agentId, "idle completion", requester); const second = await createTaskStore(root, mesh.meshId, peer.agentId, "busy completion", requester);
    let idle = true; const ctx = { sessionManager: { getSessionId: () => "completion-session", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => idle } as never; let tick!: () => Promise<void>; const pi = new PiMock();
    await registerOrchestration(pi as never, { ...files, env: { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: receiver.agentId, PI_AGENT_RESOLVED_AGENT: receiver.envelopePath }, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx);
    await finishTask(root, mesh.meshId, first.request.taskId, { outcome: "succeeded", output: "idle done" }); await tick(); assert.deepEqual(pi.messages.at(-1)!.options, { deliverAs: "steer", triggerTurn: true });
    const receipt = await createCompletionReceipt(root, mesh.meshId, { endpointId, endpointSessionFile: sessionFile, claimantSessionFile: sessionFile, toolCallId: "context-get", toolName: "mesh_get", canonicalArguments: { taskId: first.request.taskId }, taskIds: [first.request.taskId], maxTasksPerMesh: budgets.maxTasksPerMesh }); const toolResult = { role: "toolResult", toolName: "mesh_get", details: { accounting: { receiptIds: [receipt.receipt!.receiptId], receivedTaskIds: [first.request.taskId], claimedTaskIds: [] } } }; const projected = await pi.handlers.get("context")![0]!({ messages: [(pi.messages[0]!.message as object), toolResult] }, ctx) as { messages: unknown[] }; assert.deepEqual(projected.messages, [toolResult]); const firstEventId = ((pi.messages[0]!.message as any).details.eventId as string); assert.equal((JSON.parse(await readFile(join(meshPaths(root, mesh.meshId).events, `${firstEventId}.json`), "utf8")) as { state: string }).state, "acknowledged");
    idle = false; await finishTask(root, mesh.meshId, second.request.taskId, { outcome: "failed", error: "busy done" }); await tick(); assert.deepEqual(pi.messages.at(-1)!.options, { deliverAs: "steer", triggerTurn: false }); assert.equal(pi.messages.length, 2);
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
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); const deps = { ...files, env: { TMUX: "/tmp/tmux,1,0" }, exec, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) }; const ctx = { cwd: root, sessionManager: { getSessionId: () => "root", getSessionFile: () => sessionFile } } as never;
    await assert.rejects(createMeshSubmitTool(deps, { worker: settledAgentDefinition("worker") }).execute("launch", { agent: "worker", prompt: "work" }, undefined, undefined, ctx), /cleanup.*remains incomplete/iu);
    const paths = meshPaths(root, mesh.meshId); const reservations = await readdir(paths.reservations); const agents = await readdir(paths.agents); assert.equal(reservations.length, 1); assert.equal(agents.length, 1); const reservation = JSON.parse(await readFile(join(paths.reservations, reservations[0]!), "utf8")) as { state: string }; assert.equal(reservation.state, "committed");
}));

// Given a published launch whose bridge never becomes ready, when normal launch cleanup crosses durable stop and tmux termination, callers observe the launch error while recovery state records a confirmed failed lifecycle with that reason.
void test("published launch failure durably confirms a failed agent outcome", async () => withRoot("mesh-published-launch-failure-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const files = await writeRuntimeFiles(root); let clock = -6000;
    const exec = async (_command: string, args: string[]) => { if (args.includes("display-message") && args.at(-1)?.includes("#{session_id}")) return { stdout: "10\t$root\tmain\t@root\t%root\tclient\n", stderr: "", code: 0 }; if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("has-session")) return { stdout: "", stderr: "missing", code: 1 }; if (args.includes("new-session")) return { stdout: "$hub\t@agent\t%agent\n", stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; };
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); const deps = { ...files, env: { TMUX: "/tmp/tmux,1,0" }, exec, now: () => clock += 6000, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) }; const ctx = { cwd: root, sessionManager: { getSessionId: () => "root", getSessionFile: () => sessionFile } } as never;
    await assert.rejects(createMeshSubmitTool(deps, { worker: settledAgentDefinition("worker") }).execute("launch", { agent: "worker", prompt: "work" }, undefined, undefined, ctx), /bridge readiness timed out/iu);
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

// Given an agent selector retried after the agent completes newer work, the original tool-call receipt keeps the selected terminal result stable.
void test("mesh_get agent retry returns the originally receipted task", async () => withRoot("mesh-get-agent-retry-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const endpointId = `root:${mesh.meshId}`; await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "root", harness: "pi", sessionId: "root", sessionFile }); const completion = { endpointId, endpointSessionFile: sessionFile, mode: "direct" as const }; const first = await createTaskStore(root, mesh.meshId, worker.agentId, "first result", { requesterEndpointId: endpointId, completion }); await finishTask(root, mesh.meshId, first.request.taskId, { outcome: "succeeded", output: "first output" }); const files = await writeRuntimeFiles(root); const liveExec = async (_command: string, args: string[]) => { if (args.includes("display-message")) return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("list-panes")) return { stdout: `${tmux.paneId}\t0\n`, stderr: "", code: 0 }; if (args.includes("has-session")) return { stdout: "", stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; }; const deps = { ...files, env: {}, exec: liveExec, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) }; const get = createMeshGetTool(deps); const initial = await get.execute("same-call", { agentId: worker.agentId }, undefined, undefined, {} as never); assert.equal((initial.details as any).task.request.taskId, first.request.taskId);
    const second = await createTaskStore(root, mesh.meshId, worker.agentId, "second result", { requesterEndpointId: endpointId, completion }); await finishTask(root, mesh.meshId, second.request.taskId, { outcome: "succeeded", output: "second output" }); const retry = await get.execute("same-call", { agentId: worker.agentId }, undefined, undefined, {} as never); assert.equal((retry.details as any).task.request.taskId, first.request.taskId); assert.equal((retry.details as any).task.result.output, "first output"); await assert.rejects(get.execute("same-call", { agentId: worker.agentId, debug: true }, undefined, undefined, {} as never), /different arguments/u);
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
    const sessionFile = join(root, "root-session.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root-session", rootSessionFile: sessionFile, recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const endpointId = `root:${mesh.meshId}`; await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "root", harness: "pi", sessionId: "root-session", sessionFile }); const completion = { endpointId, endpointSessionFile: sessionFile, mode: "direct" as const }; const task = await createTaskStore(root, mesh.meshId, worker.agentId, "orphan receipt", { requesterEndpointId: endpointId, completion }); await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "visible after repair" }); await createCompletionReceipt(root, mesh.meshId, { endpointId, endpointSessionFile: sessionFile, claimantSessionFile: sessionFile, toolCallId: "lost-result", toolName: "mesh_get", canonicalArguments: { taskId: task.request.taskId }, taskIds: [task.request.taskId], maxTasksPerMesh: budgets.maxTasksPerMesh });
    const files = await writeRuntimeFiles(root); const keybindings = await writeMeshKeybindings(root); const previous = process.env.PI_EXTENSION_KEYBINDINGS_PATH; process.env.PI_EXTENSION_KEYBINDINGS_PATH = keybindings; const branch = [{ type: "custom", customType: "mesh-root-binding", data: { schemaVersion: 1, meshId: mesh.meshId } }]; const ctx = { sessionManager: { getSessionId: () => "root-session", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { notify() {}, setStatus() {} }, isIdle: () => true } as never;
    try { const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env: {}, setInterval() { return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); assert.deepEqual((await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile))!.receipts, []); assert.equal(pi.messages.length, 1); assert.equal((((pi.messages[0]!.message as any).details.payload.tasks as Array<{ taskId: string }>)[0]!.taskId), task.request.taskId); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" }); }
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
    const union = launchTools(launchFor(["read", "mesh_signal", "read"]));
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
