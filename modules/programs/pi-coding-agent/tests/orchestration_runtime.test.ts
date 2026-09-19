import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Value } from "typebox/value";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { activateMeshPeerToolsForSend, createEndResponseTool, createMeshControlTool, createMeshGetTool, createMeshReportTool, createMeshSendTool, createMeshStopTool, registerOrchestration, stopPaletteMeshAgent, type ActiveCaller, type OrchestrationDependencies } from "../extensions_src/orchestration.ts";
import { emitActiveMode } from "../extensions_src/utilities/mode_events.ts";
import { buildLaunchEnvelope as buildLaunchEnvelopeV8, buildPolicySnapshot, validateChildCatalog, validateOrchestrationConfig, type AgentLaunchEnvelope, type CallPolicy, type ChildCatalog, type ChildDefinition, type OrchestrationConfig } from "../extensions_src/utilities/agent_types.ts";
import type { ExecutionConfig } from "../extensions_src/utilities/mode_types.ts";
import { availableContext, publishAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { bindAgentRuntime, readAgentRuntimeBinding, unbindAgentRuntime } from "../extensions_src/utilities/orchestration_runtime.ts";
import { bindMeshEndpoint, materializeMeshCompletionEvents, readEndpointDeliverySnapshot, readMeshEndpoint, registerMeshReport, resolveRouteEndpoint, setMeshEndpointOffline } from "../extensions_src/utilities/orchestration_events.ts";
import { renderMeshEventMessage } from "../extensions_src/utilities/orchestration_cards.ts";
import { handleForAgentId } from "../extensions_src/utilities/orchestration_identity.ts";
import { createExplicitStopNotice, listPendingTuiNotices } from "../extensions_src/utilities/orchestration_notices.ts";
import { readPressureAdmission, requestPressureAdmission } from "../extensions_src/utilities/orchestration_admission.ts";
import { completionLedgerPath, createCompletionReceipt, readCompletionLedger } from "../extensions_src/utilities/orchestration_completion.ts";
import { indexEventCreation } from "../extensions_src/utilities/orchestration_index.ts";
import { withMeshLock } from "../extensions_src/utilities/orchestration_lock.ts";
import { buildChildExtensionManifest, MESH_PEER_TOOL_NAMES, piLaunchDescriptor } from "../extensions_src/utilities/orchestration_pi.ts";
import { MAX_MODEL_VISIBLE_BYTES, MAX_MODEL_VISIBLE_LINES, packCompactCompletionDelivery, projectMeshCompletionContext, receiptIdsFromToolResults, serializeModelVisibleJson } from "../extensions_src/utilities/orchestration_projection.ts";
import { attachRootMesh, applyAgentControl, claimTaskUsage, createTask as createTaskStore, ensurePolicyEpoch as ensurePolicyEpochStore, finishTask, initializeMesh, meshPaths, patchAgentStatus, prepareAgent, publishAgent, readAgentExecution, readAgentSnapshot, readMesh, readPolicyEpoch, readTask, reserveMeshCapacity, taskPaths } from "../extensions_src/utilities/orchestration_store.ts";
import { FakeMonotonicTimers, withTemporaryRoot as withRoot, yieldToIO } from "./test_helpers.ts";

const MESH_TOOLS = [...MESH_PEER_TOOL_NAMES];
const REQUIRED_PEER_CAPABILITIES = ["mesh_send", "mesh_get", "mesh_control", "mesh_stop", "mesh_report"] as const;
const AGENT_ARTIFACT_EXTENSION = "/agent_artifact.ts";
const budgets = { maxLiveAgents: 4, maxConcurrentTasks: 4, maxTasksPerMesh: 16 };
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };
const tmux = { socket: "/tmp/tmux", serverPid: "10", sessionId: "$1", sessionName: "mesh", windowId: "@1", paneId: "%1", windowName: "worker" };
const piExecution: ExecutionConfig = { models: ["openai/test"], thinkingLevel: "medium", harness: "pi" };
const cursorExecution: ExecutionConfig = { models: ["cursor/test"], harness: "cursor-agent", harnessOptions: { mode: "agent", permissionPolicy: "allow-always", sandbox: "disabled", trustWorkspace: true, worktree: false } };
const childGc = { collectAt: 2, retain: 1, pressureFloor: 0 };
const outbound: Record<string, string[]> = { reviewer: ["review-lens", "validator"], researcher: ["searcher"] };
const child = (name: string): ChildDefinition => ({ selector: { agent: name, access: "read" as const }, description: `Synthetic ${name}`, tools: ["read"], instructions: `Perform ${name}.`, contextPolicy: name === "prompt-only" ? "prompt-only" : "project", childExtensionContributions: name === "reviewer" ? [AGENT_ARTIFACT_EXTENSION] : [], execution: piExecution, targets: outbound[name] ?? [], gc: childGc });
const catalog: ChildCatalog = { schemaVersion: 1, children: Object.fromEntries(["explorer", "worker", "validator", "reviewer", "review-lens", "researcher", "searcher", "prompt-only"].map(name => [name, child(name)])) };
const callPolicy: CallPolicy = {
    modes: {
        ops: { targets: ["worker", "reviewer", "researcher"] },
        recon: { targets: ["explorer", "reviewer", "researcher"] },
    },
};
const opsMode = { description: "ops", execution: piExecution, tools: ["read"], skillOptIns: [] as string[], instructions: "Use ops." };
function settledAgentCatalog(): ChildCatalog { return structuredClone(catalog); }
function settledAgentDefinition(name: string): ChildDefinition { return structuredClone(catalog.children[name] ?? child(name)); }
function settledMeshGcTiming() { return { contextHeadroomTokens: 32768, periodicIntervalMs: 5000, activityHeartbeatMs: 2000, activityStaleMs: 10000 }; }
async function ensurePolicyEpoch(stateRoot: string, meshId: string, input: { mode: string; roleSet: string[]; roles: Record<string, ChildDefinition> }) { const localCatalog = { schemaVersion: 1 as const, children: input.roles }; const localPolicy: CallPolicy = { modes: { [input.mode]: { targets: [...input.roleSet] } } }; return ensurePolicyEpochStore(stateRoot, meshId, { mode: input.mode, catalog: localCatalog, callPolicy: localPolicy }); }
function createTask(stateRoot: string, meshId: string, agentId: string, work: { prompt: string; purpose: string }) { return createTaskStore(stateRoot, meshId, agentId, work, `root:${meshId}`); }
function buildLaunchEnvelope(input: { meshId: string; agentId: string; epochId: string; agent: string; mode: string; roleSet: string[]; catalog: ChildCatalog; childExtensions: Record<string, string[]> }): AgentLaunchEnvelope { const policy: CallPolicy = { modes: { [input.mode]: { targets: [...input.roleSet] } } }; const snapshot = buildPolicySnapshot({ mode: input.mode, catalog: input.catalog, callPolicy: policy }); const childExtensions = Object.fromEntries(Object.keys(snapshot.children).map(name => [name, input.childExtensions[name] ?? []])); return buildLaunchEnvelopeV8({ meshId: input.meshId, agentId: input.agentId, epochId: input.epochId, childId: input.agent, snapshot, childExtensions }); }

function runtimeConfig(stateRoot: string): OrchestrationConfig {
    return { schemaVersion: 6, stateRoot, tmux: "/tmux", returnParentCommand: "/parent", parentNavigationHint: "parent", historyViewerExtension: "/history.ts", popupExtension: "/popup.ts", orchestrationExtension: "/orchestration.ts", childBridgeExtension: "/bridge.ts", harnesses: { pi: { adapter: "pi-native", command: "/pi" }, "cursor-agent": { adapter: "cursor-acp", command: "/cursor", workerCommand: "/node", workerEntrypoint: "/worker.ts", modelIds: { test: "synthetic-acp-model" } } }, natureHandleWords: ["May"], callPolicy, budgets, gc: settledMeshGcTiming() };
}

void test("schema-v6 orchestration timing is separate from child GC hysteresis", () => {
    const config = runtimeConfig("/state");
    assert.deepEqual(validateOrchestrationConfig(config).gc, config.gc);
    const unsafe = structuredClone(settledAgentDefinition("worker"));
    unsafe.gc.pressureFloor = unsafe.gc.retain + 1;
    assert.throws(() => validateChildCatalog({ schemaVersion: 1, children: { worker: unsafe } }), /hysteresis/u);
    assert.throws(() => validateOrchestrationConfig({ ...config, schemaVersion: 5 }), /schemaVersion/u);
});

// Admission: source-level completion projection is the model-visible exactly-once boundary; schemas cannot detect regrouped duplicates, stale frontiers, or partial receipt filtering.
// Given repeated sources in different bundles and a newer frontier, projection emits one canonical current view, filters received/completed pending IDs, and rejects conflicting source payloads.
void test("completion context projection deduplicates sources across bundles and keeps the newest frontier", () => {
    const firstEvent = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; const secondEvent = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const firstTask = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; const secondTask = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; const thirdTask = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const firstAgent = "11111111-1111-4111-8111-111111111111"; const secondAgent = "22222222-2222-4222-8222-222222222222"; const thirdAgent = "33333333-3333-4333-8333-333333333333";
    const sourceOne = { eventId: firstEvent, batchId: "44444444-4444-4444-8444-444444444444", settledAt: "2026-01-01T00:00:00.000Z", tasks: [{ taskId: firstTask, agentId: firstAgent, state: "succeeded" as const }] };
    const sourceTwo = { eventId: secondEvent, batchId: "55555555-5555-4555-8555-555555555555", settledAt: "2026-01-01T00:00:01.000Z", tasks: [{ taskId: secondTask, agentId: secondAgent, state: "failed" as const }] };
    const first = { role: "custom", customType: "mesh-event", content: "stale", details: { kind: "completion", sources: [sourceOne], frontier: { observedAt: "2026-01-01T00:00:00.500Z", pendingTasks: [{ taskId: secondTask, agentId: secondAgent, state: "running" as const }] }, display: { tasks: [{ taskId: firstTask, preview: "private output" }] } } };
    const second = { role: "custom", customType: "mesh-event", content: "newer", details: { kind: "completion", sources: [structuredClone(sourceOne), sourceTwo], frontier: { observedAt: "2026-01-01T00:00:02.000Z", pendingTasks: [{ taskId: firstTask, agentId: firstAgent, state: "running" as const }, { taskId: thirdTask, agentId: thirdAgent, state: "created" as const }] }, identities: { [secondAgent]: { handle: "May-22222222" } }, display: { tasks: [{ taskId: secondTask, preview: "secret preview" }] } } };
    const receiptId = "66666666-6666-4666-8666-666666666666"; const receipt = { role: "toolResult", toolName: "mesh_get", details: { accounting: { receiptIds: [receiptId], receivedTaskIds: [firstTask], claimedTaskIds: [] } } };
    const question = { role: "toolResult", toolName: "question", details: { answers: [{ id: "choice" }] } };
    const report = { role: "custom", customType: "mesh-event", content: "report", details: { eventId: "77777777-7777-4777-8777-777777777777", kind: "report", payload: { reportId: "77777777-7777-4777-8777-777777777777", agentId: secondAgent, taskId: secondTask, summary: "x" }, identities: { [secondAgent]: { role: "internal", profile: "secret", model: "provider/model" } } } };
    assert.deepEqual(receiptIdsFromToolResults([receipt]), [receiptId]);
    const projected = projectMeshCompletionContext([first, question, receipt, second, report], new Set([firstTask]));
    assert.deepEqual(projected.eventIds, [firstEvent, secondEvent]);
    assert.deepEqual(projected.messages.slice(0, 2), [question, receipt]);
    assert.deepEqual(projected.messages.at(-1), { ...report, details: { eventId: report.details.eventId, kind: report.details.kind, payload: report.details.payload } });
    assert.equal("identities" in (projected.messages.at(-1) as typeof report).details, false);
    const standaloneReport = projectMeshCompletionContext([report], new Set()).messages[0] as typeof report;
    assert.equal("identities" in standaloneReport.details, false);
    const canonical = projected.messages[2] as typeof second; const content = JSON.parse(canonical.content) as { tasks: Array<{ taskId: string }>; pendingTasks: Array<{ taskId: string }> };
    assert.deepEqual(content.tasks.map(task => task.taskId), [secondTask]); assert.deepEqual(content.pendingTasks.map(task => task.taskId), [thirdTask]); assert.equal("identities" in canonical.details, false); assert.equal("display" in canonical.details, false); assert.doesNotMatch(JSON.stringify(canonical.details), /secret preview|private output/u);
    const included = {
        role: "custom",
        customType: "mesh-event",
        content: JSON.stringify({ deliveryId: "88888888-8888-4888-8888-888888888888", wakeId: "99999999-9999-4999-8999-999999999999", wakeOrigin: "mesh-event", tasks: [{ taskId: firstTask, agentId: firstAgent, resultIncluded: true, output: "compact-first" }], pendingTasks: [{ taskId: secondTask, agentId: secondAgent, state: "created" }] }),
        details: { kind: "completion", sources: [sourceOne], frontier: { observedAt: "2026-01-01T00:00:00.500Z", pendingTasks: [{ taskId: secondTask, agentId: secondAgent, state: "created" as const }] }, deliveryId: "88888888-8888-4888-8888-888888888888", wakeId: "99999999-9999-4999-8999-999999999999", wakeOrigin: "mesh-event", accounting: { claimedTaskIds: [firstTask], receiptIds: [receiptId], receivedTaskIds: [firstTask] }, identities: { [firstAgent]: { handle: "secret" } }, display: { tasks: [{ taskId: firstTask, preview: "private output" }] } },
    };
    const includedProjected = projectMeshCompletionContext([question, included], new Set([firstTask]));
    const includedMessage = includedProjected.messages[1] as typeof included;
    assert.equal(includedProjected.messages[0], question);
    assert.equal(JSON.parse(includedMessage.content).tasks[0].output, "compact-first");
    assert.equal("identities" in includedMessage.details, false);
    assert.equal("display" in includedMessage.details, false);
    assert.equal("accounting" in includedMessage.details, false);
    assert.equal("deliveryId" in includedMessage.details, false);
    const priorDelivery = {
        role: "custom",
        customType: "mesh-event",
        content: JSON.stringify({ deliveryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", wakeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", wakeOrigin: "mesh-event", tasks: [{ taskId: firstTask, agentId: firstAgent, resultIncluded: true, output: "prior-compact" }], pendingTasks: [] }),
        details: { kind: "completion", sources: [sourceOne], frontier: { observedAt: "2026-01-01T00:00:00.500Z", pendingTasks: [] }, deliveryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", wakeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", wakeOrigin: "mesh-event", resultTaskIds: [firstTask] },
    };
    const retainedDelivery = structuredClone(included);
    const retainedOnly = projectMeshCompletionContext([question, priorDelivery, retainedDelivery], new Set());
    assert.equal(retainedOnly.messages.length, 2);
    assert.equal(retainedOnly.messages[0], question);
    assert.deepEqual(retainedOnly.eventIds, [firstEvent]);
    assert.equal(JSON.parse((retainedOnly.messages[1] as typeof included).content).tasks[0].output, "compact-first");
    const packed = packCompactCompletionDelivery({
        deliveryId: "delivery",
        wakeId: "wake",
        pendingTasks: [],
        items: [
            { taskId: firstTask, eventId: firstEvent, full: { taskId: firstTask, output: "small" }, identity: { taskId: firstTask, resultIncluded: false } },
            { taskId: secondTask, eventId: secondEvent, full: { taskId: secondTask, output: "x".repeat(51_000) }, identity: { taskId: secondTask, resultIncluded: false } },
            { taskId: thirdTask, eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", full: { taskId: thirdTask, output: "y".repeat(51_000) }, identity: { taskId: thirdTask, resultIncluded: false } },
        ],
    });
    assert.deepEqual(packed.resultTaskIds, [firstTask]);
    assert.ok(packed.packedTaskIds.includes(secondTask));
    assert.equal(packed.resultTaskIds.includes(secondTask), false);
    assert.deepEqual(packed.completeEventIds, [firstEvent]);
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
    const catalogPath = join(root, "child-catalog.json");
    const modePath = join(root, "agent-modes.json");
    await writeFile(configPath, JSON.stringify(runtimeConfig(root)));
    await writeFile(catalogPath, JSON.stringify(settledAgentCatalog()));
    await writeFile(modePath, JSON.stringify({ schemaVersion: 3, defaultMode: "recon", modes: Object.fromEntries(["recon", "ops"].map(name => [name, { description: name, execution: piExecution, tools: ["read"], skillOptIns: [], instructions: `Use ${name}.` }])) }));
    return { configPath, catalogPath, modePath };
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
    const prepared = await prepareAgent(root, meshId, { reservationId: reservation.reservationId, childId: roleName, harness: definition.execution.harness, cwd: root, definitionSnapshot: definition, launchEnvelope: "pending", epochId, provenance: { creatorSessionId: "creator" }, capabilities });
    const epoch = await readPolicyEpoch(root, meshId, epochId);
    const childExtensions = Object.fromEntries(Object.keys(epoch.children).map(name => [name, ["/popup.ts", "/orchestration.ts", ...epoch.children[name]!.childExtensionContributions, "/bridge.ts"]]));
    const envelope = buildLaunchEnvelopeV8({ meshId, agentId: prepared.agentId, epochId, childId: roleName, snapshot: epoch, childExtensions });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(envelope), { mode: 0o600 });
    await publishAgent(root, meshId, prepared.paths, { agentId: prepared.agentId, epochId, childId: roleName, harness: definition.execution.harness, cwd: root, definitionSnapshot: definition, launchEnvelope: envelopePath, tmux, capabilities, ...(options.parentAgentId ? { parentAgentId: options.parentAgentId } : {}), creatorSessionId: "creator" });
    await patchAgentStatus(root, meshId, prepared.agentId, { state: "idle", bridgeReady: true });
    if (options.activity !== false) { const runtimeId = randomUUID(); await bindAgentRuntime(root, meshId, prepared.agentId, { runtimeId, kind: "external" }); const now = new Date().toISOString(); await publishAgentActivity(root, meshId, prepared.agentId, { runtimeId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: now, observedAt: now, heartbeatAt: now, context: availableContext(10, 100_000, 100) }); }
    return { ...prepared, envelope, envelopePath };
}

function caller(meshId: string, epoch: ActiveCaller["epoch"], overrides: Partial<ActiveCaller> = {}): ActiveCaller {
    const agentId = overrides.agentId; return { identity: "mode:ops", meshId, epoch, catalog: settledAgentCatalog(), ...overrides, endpointId: overrides.endpointId ?? (agentId ? `agent:${agentId}` : `root:${meshId}`) };
}

const absentTmux = async () => ({ stdout: "", stderr: "no server running", code: 1 });
function piTestRegistry(available: ReadonlyArray<{ provider: string; id: string; contextWindow?: number }> = [{ provider: "openai", id: "test", contextWindow: 100_000 }]) {
    return {
        find(provider: string, id: string) { return available.find(model => model.provider === provider && model.id === id); },
        hasConfiguredAuth: () => true,
        getApiKeyAndHeaders: async () => ({ ok: true as const }),
    };
}
function liveTmuxExec() {
    return async (_command: string, args: string[]) => {
        if (args.includes("display-message") && args.at(-1)?.includes("#{session_id}")) return { stdout: "10\t$root\tmain\t@root\t%root\tclient\n", stderr: "", code: 0 };
        if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 };
        if (args.includes("has-session")) return { stdout: "", stderr: "missing", code: 1 };
        if (args.includes("new-session")) return { stdout: "$hub\t@agent\t%agent\n", stderr: "", code: 0 };
        return { stdout: "", stderr: "", code: 0 };
    };
}

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
    const send = createMeshSendTool(deps, targets);
    assert.equal(Value.Check(send.parameters, { agent: "worker", access: "read", purpose: "synthetic purpose", message: "work" }), true);
    assert.equal(Value.Check(send.parameters, { agent: "worker", message: "work" }), false);
    assert.equal(Value.Check(send.parameters, { agent: "worker", access: "write", purpose: "synthetic purpose", message: "work" }), false);
    const fixed = createMeshSendTool(deps, { explorer: settledAgentDefinition("explorer") });
    assert.equal(Value.Check(fixed.parameters, { agent: "explorer", access: "read", purpose: "synthetic purpose", message: "inspect" }), true);
    assert.equal(Value.Check(fixed.parameters, { agent: "explorer", profile: "pi-default", message: "inspect" }), false);
    assert.equal(Value.Check(send.parameters, { agentId: "agent-id", message: "work" }), true);
    assert.equal(Value.Check(send.parameters, { profile: "pi-default", message: "work" }), false);
    assert.equal(Value.Check(send.parameters, { agent: "unknown", access: "read", purpose: "synthetic purpose", message: "work" }), false);
    await assert.rejects(send.execute("call", { agent: "worker", agentId: "id", access: "read", message: "work" }, undefined, undefined, {} as never), /cannot be combined/u);
    await assert.rejects(send.execute("call", { agentId: "id", access: "write", message: "work" }, undefined, undefined, {} as never), /cannot be combined/u);
    const get = createMeshGetTool(deps); const end = createEndResponseTool(deps); const report = createMeshReportTool(deps);
    const control = createMeshControlTool(deps);
    assert.equal(Value.Check(control.parameters, { agentId: "11111111-1111-4111-8111-111111111111", action: "pause" }), true);
    assert.equal(Value.Check(get.parameters, { taskId: "task", outputMode: "compact" }), true); assert.equal(Value.Check(get.parameters, { taskId: "task", outputMode: "full" }), true); assert.equal(Value.Check(get.parameters, { agentId: "agent" }), false); assert.equal(Value.Check(get.parameters, { taskId: "task", agentId: "agent" }), false); assert.equal(Value.Check(get.parameters, { taskId: "task", outputMode: "other" }), false);
    assert.deepEqual(get.prepareArguments!({ taskId: "stored-task" }), { taskId: "stored-task", outputMode: "compact" });
    assert.equal(Value.Check(end.parameters, {}), true); assert.equal(Value.Check(end.parameters, { taskIds: ["one"] }), false);
    assert.equal(Value.Check(report.parameters, { summary: "bounded status" }), true); assert.equal(Value.Check(report.parameters, { message: "obsolete" }), false);
    await assert.rejects(createMeshStopTool(deps).execute("call", {}, undefined, undefined, {} as never), /exactly one/u);
    await assert.rejects(createMeshStopTool(deps).execute("call", { taskId: "task", reason: "must not alter task-stop semantics" }, undefined, undefined, {} as never), /taskId rejects reason/u);
});

// Given a narrowing epoch committed before the reservation lock, dispatch rejects without any lifecycle mutation.
void test("new-agent dispatch rejects stale authority before reservation",  async () => withRoot("mesh-dispatch-reauthorize-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const initial = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const narrowed = await ensurePolicyEpoch(root, mesh.meshId, { mode: "recon", roleSet: ["explorer"], roles: { explorer: settledAgentDefinition("explorer") } }); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); let current = caller(mesh.meshId, initial, { identity: "mode:ops", sessionFile }); let crossings = 0; const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => current, authorityBarrier: async () => { crossings += 1; if (crossings === 3) current = caller(mesh.meshId, narrowed, { identity: "mode:recon", sessionFile }); } }; const ctx = { cwd: root, sessionManager: { getSessionId: () => "root", getSessionFile: () => sessionFile } } as never;
    await assert.rejects(createMeshSendTool(deps, { worker: settledAgentDefinition("worker") }).execute("stale-dispatch", { agent: "worker", access: "read", purpose: "synthetic purpose", message: "must not launch" }, undefined, undefined, ctx), /authority changed before reservation/u); assert.equal(crossings, 2); const paths = meshPaths(root, mesh.meshId); assert.deepEqual(await readdir(paths.reservations), []); assert.deepEqual(await readdir(paths.agents), []); assert.deepEqual(await readdir(paths.tasks), []);
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
        await assert.rejects(createMeshSendTool(deps, { worker: settledAgentDefinition("worker") }).execute("stale-binding", { agent: "worker", access: "read", purpose: "synthetic purpose", message: "must not mutate" }, undefined, undefined, ctx), /stale or offline/u);
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
    const task = await createTask(root, mesh.meshId, worker.agentId, { prompt: "mesh-wide observation", purpose: "synthetic purpose" });
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
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["reviewer", "worker"], roles: { reviewer: settledAgentDefinition("reviewer"), "review-lens": settledAgentDefinition("review-lens"), validator: settledAgentDefinition("validator"), worker: settledAgentDefinition("worker") } }); const owner = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "reviewer" }); const lateral = await publishWorker(root, mesh.meshId, epoch.epochId); const owned = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "review-lens", parentAgentId: owner.agentId }); const lateralTask = await createTaskStore(root, mesh.meshId, lateral.agentId, { prompt: "lateral", purpose: "synthetic purpose" }, `root:${mesh.meshId}`); await finishTask(root, mesh.meshId, lateralTask.request.taskId, { outcome: "succeeded", output: "done" }); const ownedTask = await createTaskStore(root, mesh.meshId, owned.agentId, { prompt: "owned", purpose: "synthetic purpose" }, { requesterEndpointId: `agent:${owner.agentId}`, requesterAgentId: owner.agentId }); await finishTask(root, mesh.meshId, ownedTask.request.taskId, { outcome: "succeeded", output: "done" }); const ownerSessionFile = join(root, "owner.jsonl"); await writeFile(ownerSessionFile, ""); const ownerEndpointId = `agent:${owner.agentId}`; await bindMeshEndpoint(root, mesh.meshId, { endpointId: ownerEndpointId, kind: "agent", agentId: owner.agentId, harness: "pi", sessionId: "owner", sessionFile: ownerSessionFile }); const ownerRuntime = await readAgentRuntimeBinding(root, mesh.meshId, owner.agentId); const files = await writeRuntimeFiles(root); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "agent:reviewer", agentId: owner.agentId, runtimeId: ownerRuntime!.runtimeId, envelope: owner.envelope, endpointId: ownerEndpointId, sessionFile: ownerSessionFile }) };
    await assert.rejects(createMeshGetTool(deps).execute("get", { taskId: lateralTask.request.taskId }, undefined, undefined, {} as never), /not allowed to inspect task/u);
    await assert.rejects(createMeshStopTool(deps).execute("stop", { agentId: lateral.agentId }, undefined, undefined, {} as never), /not its direct parent/u);
    await assert.rejects(createMeshSendTool(deps).execute("send", { agentId: lateral.agentId, message: "lateral send" }, undefined, undefined, {} as never), /not its direct parent/u);
    const direct = await createMeshGetTool(deps).execute("get-child", { taskId: ownedTask.request.taskId }, undefined, undefined, {} as never); assert.equal((direct.details as any).agent.agentId, owned.agentId);
    await assert.rejects(publishWorker(root, mesh.meshId, epoch.epochId, { role: "review-lens", parentAgentId: lateral.agentId }), /actual inbound policy edge/u);
}));

// Admission: a mixed end_response batch must not terminate, and a standalone call must terminate without creating receipts.
void test("end_response terminates only when it is the standalone batch", async () => withRoot("mesh-end-response-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["reviewer"], roles: { reviewer: settledAgentDefinition("reviewer"), "review-lens": settledAgentDefinition("review-lens"), validator: settledAgentDefinition("validator") } });
    const endpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); const files = await writeRuntimeFiles(root); const activeCaller = caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile });
    const batch = new Map<string, string>([["yield", "end_response"], ["other", "mesh_send"]]);
    const mixedTool = createEndResponseTool({ ...files, env: {}, exec: absentTmux, activeCaller: () => activeCaller, currentBatchTools: () => batch });
    const mixed = await mixedTool.execute("yield", {}, undefined, undefined, {} as never);
    assert.equal((mixed as { terminate?: boolean }).terminate, undefined);
    assert.equal((mixed.details as { error?: string }).error, "standalone_call_required");
    const standalone = createEndResponseTool({ ...files, env: {}, exec: absentTmux, activeCaller: () => activeCaller, currentBatchTools: () => new Map([["yield", "end_response"]]) });
    const first = await standalone.execute("yield", {}, undefined, undefined, {} as never);
    assert.equal((first as { terminate?: boolean }).terminate, true);
    assert.deepEqual(first.details, { kind: "end_response", toolCallId: "yield", ended: true });
    assert.equal(await readCompletionLedger(root, mesh.meshId, endpoint.endpointId, sessionFile), undefined);
}));

// Admission: the production endpoint resolver returns an equal binding as a different object, and terminal tasks disappear from pending indexes before delivery; unit latch tests cannot expose either early-settlement path.
// Given an armed root with routed work, agent_end remains held through terminal materialization, resumes only after the completion is queued, and drains only after that continuation reaches context.
void test("armed root agent_end follows durable completion through one final continuation", async () => withRoot("mesh-wait-runtime-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const endpointId = `root:${mesh.meshId}`;
    const files = await writeRuntimeFiles(root); const clock = new FakeMonotonicTimers(); const pi = new PiMock(); let queued = false; const notifications: string[] = [];
    // Native-only: Pi hasPendingMessages does not count custom sendMessage.
    pi.sendMessage = (message: unknown, options: unknown) => { pi.messages.push({ message, options }); };
    const branch = [{ type: "custom", customType: "mesh-root-binding-v11", data: { schemaVersion: 1, meshId: mesh.meshId } }]; const signal = new AbortController(); const ctx = { sessionManager: { getSessionId: () => "root", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { setStatus() {}, notify(text: string) { notifications.push(text); } }, isIdle: () => false, hasPendingMessages: () => queued, signal: signal.signal } as never;
    await registerOrchestration(pi as never, { ...files, env: {}, now: () => clock.now, setInterval: clock.setTimeout, clearInterval: clock.clearTimeout, wake: { watch: () => ({ close() {}, on() { return this; }, unref() {} }) } });
    pi.events.emit("neo.dotfiles.pi:active-mode", { schemaVersion: 1, name: "ops", mode: opsMode, reason: "startup" }); await pi.handlers.get("session_start")![0]!({}, ctx);
    const liveEndpoint = await readMeshEndpoint(root, mesh.meshId, endpointId); const task = await createTaskStore(root, mesh.meshId, worker.agentId, { prompt: "wait through completion", purpose: "synthetic purpose" }, { requesterEndpointId: endpointId, completion: { endpointId, endpointSessionFile: sessionFile, bindingId: liveEndpoint.bindingId } });
    await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "done" });
    let resumed = false; const firstEnd = Promise.resolve(pi.handlers.get("agent_end")![0]!({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx)).then(() => { resumed = true; });
    for (let attempt = 0; attempt < 100 && !await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile); attempt += 1) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(resumed, false); assert.deepEqual(notifications, []); assert.ok(await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile));
    await clock.advance(10_000); await Promise.race([firstEnd, new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`armed root did not resume; messages=${pi.messages.length}`)), 2_000))]); assert.equal(resumed, true); assert.equal(pi.messages.length, 1);
    await pi.handlers.get("context")![0]!({ messages: [pi.messages[0]!.message] }, ctx); await Promise.race([Promise.resolve(pi.handlers.get("agent_end")![0]!({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx)), new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("armed root did not drain after completion context")), 2_000))]); assert.deepEqual(notifications, []);
    await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// A local endpoint fixture keeps the wait tests at the registered extension boundary, with real durable tasks and a controllable native queue.
async function waitRuntime(root: string) {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, "");
    const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker", "reviewer"], roles: settledAgentCatalog().children });
    const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const files = await writeRuntimeFiles(root); const clock = new FakeMonotonicTimers(); const pi = new PiMock(); const signal = new AbortController(); const notifications: string[] = [];
    let queued = false; const branch = [{ type: "custom", customType: "mesh-root-binding-v11", data: { schemaVersion: 1, meshId: mesh.meshId } }];
    // Native-only: custom sendMessage is owned by production awaitingContextEvents, not this flag.
    pi.sendMessage = (message, options) => { pi.messages.push({ message, options }); };
    const statuses: Array<{ key: string; value?: string }> = [];
    let resolveArmed!: () => void;
    const armed = new Promise<void>(resolve => { resolveArmed = resolve; });
    const ctx = { cwd: root, sessionManager: { getSessionId: () => "root", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { setStatus(key: string, value?: string) { statuses.push({ key, value }); if (key === "mesh-auto-join" && value) resolveArmed(); }, notify(text: string) { notifications.push(text); } }, isIdle: () => false, hasPendingMessages: () => queued, signal: signal.signal };
    await registerOrchestration(pi as never, { ...files, env: {}, now: () => clock.now, setInterval: clock.setTimeout, clearInterval: clock.clearTimeout, wake: { watch: () => ({ close() {}, on() { return this; }, unref() {} }) } });
    pi.events.emit("neo.dotfiles.pi:active-mode", { schemaVersion: 1, name: "ops", mode: opsMode, reason: "startup" });
    await pi.handlers.get("session_start")![0]!({}, ctx);
    const endpoint = await readMeshEndpoint(root, mesh.meshId, `root:${mesh.meshId}`);
    const task = await createTaskStore(root, mesh.meshId, worker.agentId, { prompt: "delegated", purpose: "synthetic purpose" }, { requesterEndpointId: endpoint.endpointId, completion: { endpointId: endpoint.endpointId, endpointSessionFile: sessionFile, bindingId: endpoint.bindingId } });
    const invoke = (name: string, event: unknown = {}) => Promise.all((pi.handlers.get(name) ?? []).map(handler => handler(event, ctx)));
    const end = (reason = "stop") => invoke("agent_end", { messages: [{ role: "assistant", stopReason: reason }] });
    const arm = async () => {};
    const consume = async () => { const messages = pi.messages.splice(0).map(item => item.message); queued = false; await invoke("context", { messages }); };
    return { mesh, epoch, worker, endpoint, task, pi, ctx, clock, signal, notifications, statuses, armed, invoke, end, arm, consume, setQueued(value: boolean) { queued = value; }, close: () => invoke("session_shutdown", { reason: "reload" }) };
}
async function bounded<T>(value: Promise<T>): Promise<T> { let timer: NodeJS.Timeout | undefined; try { return await Promise.race([value, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("mesh wait boundary did not finish")), 2_000); })]); } finally { clearTimeout(timer); } }
async function awaitArmedWait(h: { statuses: Array<{ key: string; value?: string }>; armed: Promise<void> }): Promise<void> {
    await within(h.armed, `mesh wait did not arm; statuses=${JSON.stringify(h.statuses)}`);
}
async function driveWait<T>(h: { clock: FakeMonotonicTimers }, pending: Promise<T>, stepMs = 500, steps = 40): Promise<T> {
    let settled = false;
    const tracked = pending.finally(() => { settled = true; });
    for (let attempt = 0; attempt < steps && !settled; attempt += 1) {
        await yieldToIO();
        await h.clock.advance(stepMs);
    }
    return bounded(tracked);
}
async function within<T>(promise: Promise<T>, label: string, ms = 8_000): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
}
function countMessagesContaining(messages: unknown[], text: string): number {
    return messages.filter(message => JSON.stringify(message).includes(text)).length;
}
function meshIdFromSession(session: { sessionManager: { getBranch(): ReadonlyArray<{ type: string; customType?: string; data?: unknown }> } }): string {
    const entry = [...session.sessionManager.getBranch()].reverse().find(item => item.type === "custom" && item.customType === "mesh-root-binding-v11");
    const meshId = entry && typeof entry.data === "object" && entry.data && "meshId" in entry.data ? String((entry.data as { meshId: string }).meshId) : undefined;
    assert.ok(meshId, "session_start did not persist a mesh-root-binding-v11");
    return meshId;
}

// Admission: mock emitters and handwritten AgentSession hooks cannot detect a production join that settles, goes idle, or drops custom sendMessage because Pi hasPendingMessages ignores that queue.
// Given one prompt that auto-joins at a joinable agent_end, when a completion is queued before the production wait inspects, a later synthetic delegation and native steer while work remains, the same run stays active through one drain and one settlement.
void test("real AgentSession joins production auto-join through queued completion, new work, and native steer", async () => withRoot("mesh-wait-session-join-", async root => {
    const agentDir = join(root, "agent-home");
    const sessionDir = join(root, "sessions");
    await mkdir(agentDir, { recursive: true });
    const files = await writeRuntimeFiles(root);
    const clock = new FakeMonotonicTimers();
    const steerText = "native-steer-while-pending";
    const lifecycle: string[] = [];
    const idleWhileHeld: boolean[] = [];
    let ends = 0;
    let firstCompletionQueuedBeforeProductionEnd = false;
    let releasePending!: () => void;
    const pendingHeld = new Promise<void>(resolve => { releasePending = resolve; });
    let releaseAfterSteer!: () => void;
    const steerHeld = new Promise<void>(resolve => { releaseAfterSteer = resolve; });
    const live: {
        meshId?: string;
        taskId?: string;
        nextTaskId?: string;
        workerId?: string;
        endpointId?: string;
        sessionFile?: string;
        bindingId?: string;
    } = {};
    const faux = fauxProvider({ provider: "mesh-wait-session-join" });
    faux.setResponses([
        fauxAssistantMessage(fauxToolCall("end_response", {}, { id: "yield" }), { stopReason: "toolUse" }),
        async () => {
            const endpoint = await readMeshEndpoint(root, live.meshId!, live.endpointId!);
            const created = await createTaskStore(root, live.meshId!, live.workerId!, { prompt: "additional delegated work", purpose: "synthetic purpose" }, {
                requesterEndpointId: endpoint.endpointId,
                completion: { endpointId: endpoint.endpointId, endpointSessionFile: live.sessionFile!, bindingId: endpoint.bindingId },
            });
            live.nextTaskId = created.request.taskId;
            return fauxAssistantMessage("saw the first completion and delegated more work");
        },
        context => {
            assert.equal(countMessagesContaining(context.messages, steerText), 1);
            return fauxAssistantMessage("consumed the native steer while work remained");
        },
        fauxAssistantMessage("processed the last completion and finished"),
    ]);
    const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false, modelsPath: null });
    modelRuntime.registerNativeProvider(faux.provider);
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const loader = new DefaultResourceLoader({
        cwd: root,
        agentDir,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [{
            name: "mesh-wait-session-join",
            factory: async pi => {
                pi.on("agent_end", async (_event, ctx) => {
                    ends += 1;
                    idleWhileHeld.push(ctx.isIdle());
                    if (ends === 1) {
                        assert.ok(live.meshId && live.taskId);
                        await finishTask(root, live.meshId, live.taskId, { outcome: "succeeded", output: "first-done" });
                        await clock.advance(10_000);
                        firstCompletionQueuedBeforeProductionEnd = true;
                        return;
                    }
                    if (ends === 2) {
                        releasePending();
                        return;
                    }
                    if (ends === 3) {
                        releaseAfterSteer();
                        assert.ok(live.meshId && live.nextTaskId);
                        await finishTask(root, live.meshId, live.nextTaskId, { outcome: "succeeded", output: "second-done" });
                        await clock.advance(10_000);
                    }
                });
                await registerOrchestration(pi, {
                    ...files,
                    env: {},
                    now: () => clock.now,
                    setInterval: clock.setTimeout,
                    clearInterval: clock.clearTimeout,
                    wake: { watch: () => ({ close() {}, on() { return this; }, unref() {} }) },
                });
                emitActiveMode(pi, "ops", opsMode, "startup");
            },
        }],
    });
    await loader.reload();
    const sessionManager = SessionManager.create(root, sessionDir);
    const { session } = await createAgentSession({
        cwd: root,
        agentDir,
        model: faux.getModel(),
        modelRuntime,
        resourceLoader: loader,
        settingsManager,
        sessionManager,
        tools: ["end_response"],
    });
    try {
        await session.bindExtensions({});
        const meshId = meshIdFromSession(session);
        const sessionFile = session.sessionManager.getSessionFile();
        assert.ok(sessionFile);
        const mesh = await readMesh(root, meshId);
        assert.ok(mesh.currentEpochId);
        const epoch = await readPolicyEpoch(root, meshId, mesh.currentEpochId);
        const worker = await publishWorker(root, meshId, epoch.epochId);
        const endpoint = await readMeshEndpoint(root, meshId, `root:${meshId}`);
        const first = await createTaskStore(root, meshId, worker.agentId, { prompt: "initial delegated work", purpose: "synthetic purpose" }, {
            requesterEndpointId: endpoint.endpointId,
            completion: { endpointId: endpoint.endpointId, endpointSessionFile: sessionFile, bindingId: endpoint.bindingId },
        });
        Object.assign(live, { meshId, taskId: first.request.taskId, workerId: worker.agentId, endpointId: endpoint.endpointId, sessionFile, bindingId: endpoint.bindingId });
        const unsubscribe = session.subscribe(event => {
            if (event.type === "agent_start" || event.type === "agent_end" || event.type === "agent_settled") lifecycle.push(event.type);
        });
        const prompt = session.prompt("arm production wait");
        await within(pendingHeld, "held after first continuation");
        assert.equal(firstCompletionQueuedBeforeProductionEnd, true);
        assert.equal(idleWhileHeld.includes(true), false);
        assert.equal(session.isStreaming, true);
        assert.equal(session.isIdle, false);
        assert.equal(lifecycle.includes("agent_settled"), false);
        assert.ok(live.nextTaskId, "continuation did not create the additional delegated task");
        await yieldToIO();
        await session.steer(steerText);
        await clock.advance(250);
        await within(steerHeld, "held after native steer");
        await within(prompt, "AgentSession production join");
        unsubscribe();
        assert.deepEqual(lifecycle, [
            "agent_start", "agent_end",
            "agent_start", "agent_end",
            "agent_start", "agent_end",
            "agent_start", "agent_end",
            "agent_settled",
        ]);
        assert.equal(idleWhileHeld.includes(true), false);
        assert.equal(countMessagesContaining(session.state.messages, steerText), 1);
        assert.equal(faux.state.callCount, 4);
        assert.equal(session.isStreaming, false);
        assert.equal(session.isIdle, true);
    } finally {
        session.dispose();
    }
}));

// Admission: new work during a notification response and unrelated peer work can respectively cause early or endless settlement; neither the latch nor types owns endpoint targeting.
// Given a completion response that sends another task, the same arm tracks the new task and drains without waiting for a different endpoint's work.
void test("armed continuation includes new sends but not unrelated peer work", async () => withRoot("mesh-wait-grow-", async root => {
    const h = await waitRuntime(root);
    try {
        await h.arm(); await finishTask(root, h.mesh.meshId, h.task.request.taskId, { outcome: "succeeded", output: "first" });
        await driveWait(h, h.end()); await h.consume();
        await bindMeshEndpoint(root, h.mesh.meshId, { endpointId: `agent:${h.worker.agentId}`, kind: "agent", agentId: h.worker.agentId, harness: "pi", sessionId: "worker", sessionFile: join(root, "worker.jsonl") });
        const second = await h.pi.tools.get("mesh_send")!.execute("another", { agentId: h.worker.agentId, purpose: "additional work", message: "additional work" }, undefined, undefined, h.ctx);
        const submitted = JSON.parse(second.content[0].text); assert.equal(submitted.nextAction.yieldVia, "end_response");
        const peer = await publishWorker(root, h.mesh.meshId, h.epoch.epochId, { role: "reviewer" });
        const unrelated = await publishWorker(root, h.mesh.meshId, h.epoch.epochId, { role: "review-lens", parentAgentId: peer.agentId });
        await createTaskStore(root, h.mesh.meshId, unrelated.agentId, { prompt: "not this endpoint", purpose: "synthetic purpose" }, { requesterEndpointId: `agent:${peer.agentId}`, requesterAgentId: peer.agentId });
        let resumed = false; const next = h.end().finally(() => { resumed = true; }); await yieldToIO(); await h.clock.advance(1_000); assert.equal(resumed, false);
        await finishTask(root, h.mesh.meshId, submitted.taskId, { outcome: "succeeded", output: "second" }); await driveWait(h, next);
        await h.consume(); await driveWait(h, h.end()); assert.deepEqual(h.notifications, []);
        await h.invoke("agent_settled");
        const last = await h.pi.tools.get("mesh_send")!.execute("independent", { agentId: h.worker.agentId, purpose: "separate request", message: "separate request" }, undefined, undefined, h.ctx);
        const lastVisible = JSON.parse(last.content[0].text) as { taskId: string; nextAction: { action: string } };
        assert.equal(lastVisible.nextAction.action, "continue_independent_work");
        let independent = false; const independentEnd = h.end().finally(() => { independent = true; });
        await yieldToIO(); await h.clock.advance(1_000); assert.equal(independent, false);
        await finishTask(root, h.mesh.meshId, lastVisible.taskId, { outcome: "succeeded", output: "independent" });
        await driveWait(h, independentEnd);
    } finally { await h.close(); }
}));

// Admission: queued-but-unseen events are lost when abort clears Pi queues unless runtime suppression is reconciled; types and receipt schemas cannot observe this race.
// Given an acknowledged report and a second report queued concurrently with abort, settlement restores only the unseen event and leaves delegated work alive.
void test("abort restores unseen delivery without replaying acknowledged events or stopping children", async () => withRoot("mesh-wait-abort-", async root => {
    const h = await waitRuntime(root);
    try {
        const reporter = await publishWorker(root, h.mesh.meshId, h.epoch.epochId);
        const childSession = join(root, "abort-child.jsonl"); await writeFile(childSession, "");
        const childEndpoint = await bindMeshEndpoint(root, h.mesh.meshId, { endpointId: `agent:${reporter.agentId}`, kind: "agent", agentId: reporter.agentId, harness: "pi", sessionId: "abort-child", sessionFile: childSession });
        const childTask = await createTaskStore(root, h.mesh.meshId, reporter.agentId, { prompt: "abort child work", purpose: "synthetic purpose" }, { requesterEndpointId: h.endpoint.endpointId });
        const emit = (id: string, summary: string) => registerMeshReport(root, h.mesh.meshId, { callerEndpointId: childEndpoint.endpointId, callerEndpointSessionFile: childEndpoint.sessionFile, toolCallId: id, endpoint: h.endpoint, agentId: reporter.agentId, taskId: childTask.request.taskId, summary, canonicalArguments: { id } });
        await emit("accepted", "accepted"); await h.clock.advance(2_000); await h.consume();
        await h.arm(); await h.invoke("agent_start"); const ending = h.end(); await h.clock.advance(250);
        const send = h.pi.sendMessage.bind(h.pi); h.pi.sendMessage = (message, options) => { send(message, options); h.setQueued(false); h.signal.abort(); };
        await emit("unseen", "unseen"); await h.clock.advance(2_000); await bounded(ending);
        assert.equal(h.pi.messages.length, 1); h.pi.messages.length = 0; h.pi.sendMessage = send;
        await h.invoke("agent_settled"); await h.clock.advance(2_000);
        assert.equal(h.pi.messages.length, 1); assert.equal((h.pi.messages[0]!.message as any).details.payload.summary, "unseen");
        assert.equal((await readTask(root, h.mesh.meshId, h.task.request.taskId)).status.state, "created");
        await h.consume(); assert.equal((await readEndpointDeliverySnapshot(root, h.mesh.meshId, h.endpoint)).events.length, 0);
    } finally { await h.close(); }
}));

// Admission: input hooks run before native queue insertion, and handled inputs may never queue; an eager wake loses input or settles prematurely.
// Given handled or delayed input while blocked, agent_end resumes only after hasPendingMessages becomes true, without creating a replacement user message.
void test("input hooks preserve native queue ownership and wait for delayed insertion", async () => withRoot("mesh-wait-input-", async root => {
    const h = await waitRuntime(root);
    try {
        await h.arm(); let resumed = false; const ending = h.end().then(() => { resumed = true; });
        await h.clock.advance(250);
        assert.deepEqual(await h.invoke("input", { text: "handled elsewhere", source: "interactive", streamingBehavior: "steer" }), [{ action: "continue" }]);
        await h.clock.advance(500); assert.equal(resumed, false);
        await h.invoke("input", { text: "queued later", source: "interactive", streamingBehavior: "followUp" });
        await h.clock.advance(250); assert.equal(resumed, false);
        h.setQueued(true); await h.clock.advance(250); await bounded(ending);
        assert.deepEqual(h.pi.messages, []); assert.deepEqual(h.notifications, []);
    } finally { await h.close(); }
}));

// Admission: user input must lock wake origin before a later mesh-event can rewrite it; delayed native insertion still owns resume.
void test("accepted input locks user wake origin without injecting a replacement message", async () => withRoot("mesh-wait-user-origin-", async root => {
    const h = await waitRuntime(root);
    try {
        await h.arm();
        let resumed = false;
        const ending = h.end().then(() => { resumed = true; });
        await awaitArmedWait(h);
        assert.equal(resumed, false);
        await h.invoke("input", { text: "steer", source: "interactive", streamingBehavior: "steer" });
        assert.equal(resumed, false);
        await finishTask(root, h.mesh.meshId, h.task.request.taskId, { outcome: "succeeded", output: "secret-output-must-not-auto-include" });
        await h.clock.advance(10_000);
        assert.equal((await readCompletionLedger(root, h.mesh.meshId, h.endpoint.endpointId, h.endpoint.sessionFile))?.receipts.length ?? 0, 0);
        h.setQueued(true);
        await bounded(ending);
        const completion = h.pi.messages.find(item => (item.message as { details?: { kind?: string } }).details?.kind === "completion");
        assert.ok(completion);
        assert.doesNotMatch((completion!.message as { content: string }).content, /secret-output-must-not-auto-include/u);
        assert.equal(((completion!.message as { details?: { resultTaskIds?: string[] } }).details?.resultTaskIds ?? []).length, 0);
    } finally { await h.close(); }
}));

// Admission: notification receipts must not persist until LLM context adoption so abort can redeliver the same tasks.
void test("notification receipts confirm only in context and abort redelivers unconfirmed work", async () => withRoot("mesh-wait-receipt-context-", async root => {
    const h = await waitRuntime(root);
    try {
        h.ctx.isIdle = () => true;
        await finishTask(root, h.mesh.meshId, h.task.request.taskId, { outcome: "succeeded", output: "visible-result" });
        await h.clock.advance(10_000);
        assert.equal(h.pi.messages.length, 1);
        assert.equal((await readCompletionLedger(root, h.mesh.meshId, h.endpoint.endpointId, h.endpoint.sessionFile))?.receipts.length ?? 0, 0);
        await h.invoke("agent_start");
        h.signal.abort();
        await h.invoke("agent_end");
        h.pi.messages.splice(0);
        await h.invoke("agent_settled");
        await h.clock.advance(10_000);
        assert.equal((await readCompletionLedger(root, h.mesh.meshId, h.endpoint.endpointId, h.endpoint.sessionFile))?.receipts.length ?? 0, 0);
        assert.ok(h.pi.messages.length >= 1);
        await h.consume();
        const ledger = await readCompletionLedger(root, h.mesh.meshId, h.endpoint.endpointId, h.endpoint.sessionFile);
        assert.ok((ledger?.receipts.length ?? 0) >= 1);
    } finally { await h.close(); }
}));

// Admission: a later delivery in the same provider context would otherwise receipt earlier compact results that projection dropped.
// Given two completion deliveries in one context, receipts confirm only the retained delivery's tasks and the dropped delivery is injected again.
void test("context receipts confirm only the projected delivery and redeliver the prior one", async () => withRoot("mesh-wait-receipt-last-delivery-", async root => {
    const h = await waitRuntime(root);
    try {
        h.ctx.isIdle = () => true;
        await finishTask(root, h.mesh.meshId, h.task.request.taskId, { outcome: "succeeded", output: "first-visible" });
        await h.clock.advance(10_000);
        assert.ok(h.pi.messages.length >= 1);
        const firstDelivery = h.pi.messages.shift()!;
        const extra = await createTaskStore(root, h.mesh.meshId, h.worker.agentId, { prompt: "second", purpose: "synthetic purpose" }, { requesterEndpointId: h.endpoint.endpointId, completion: { endpointId: h.endpoint.endpointId, endpointSessionFile: h.endpoint.sessionFile, bindingId: h.endpoint.bindingId } });
        await finishTask(root, h.mesh.meshId, extra.request.taskId, { outcome: "succeeded", output: "second-visible" });
        await h.clock.advance(10_000);
        const secondDelivery = h.pi.messages.shift()!;
        assert.ok(secondDelivery);
        await h.invoke("context", { messages: [firstDelivery.message, secondDelivery.message] });
        const ledger = await readCompletionLedger(root, h.mesh.meshId, h.endpoint.endpointId, h.endpoint.sessionFile);
        const received = new Set((ledger?.receipts ?? []).flatMap(receipt => receipt.taskIds));
        assert.equal(received.has(extra.request.taskId), true);
        assert.equal(received.has(h.task.request.taskId), false);
        await h.clock.advance(10_000);
        const redelivered = h.pi.messages.map(item => item.message as { content?: string }).map(item => item.content ?? "").join("\n");
        assert.match(redelivered, /first-visible/u);
        assert.doesNotMatch(redelivered, /second-visible/u);
    } finally { await h.close(); }
}));

// Admission: per-task compact packing must keep identifiers, include results that fit, and skip receipts for identity-only or later-delivery tasks.
void test("huge completion bundles keep identifiers and skip receipts for unaccommodated tasks", async () => withRoot("mesh-wait-huge-split-", async root => {
    const h = await waitRuntime(root);
    try {
        h.ctx.isIdle = () => true;
        await finishTask(root, h.mesh.meshId, h.task.request.taskId, { outcome: "succeeded", output: "SMALL-NEEDLE-visible" });
        const extras = [];
        for (let index = 0; index < 4; index += 1) {
            const extra = await createTaskStore(root, h.mesh.meshId, h.worker.agentId, { prompt: `huge-${index}`, purpose: "synthetic purpose" }, { requesterEndpointId: h.endpoint.endpointId, completion: { endpointId: h.endpoint.endpointId, endpointSessionFile: h.endpoint.sessionFile, bindingId: h.endpoint.bindingId } });
            extras.push(extra);
            await finishTask(root, h.mesh.meshId, extra.request.taskId, { outcome: "succeeded", output: `HUGE-HEAD-NEEDLE-${index}-${"x".repeat(20_000)}` });
        }
        await h.clock.advance(10_000);
        const firstMessage = h.pi.messages.shift();
        assert.ok(firstMessage);
        const first = firstMessage.message as { content?: string; details?: { resultTaskIds?: string[]; kind?: string } };
        const firstContent = first.content ?? "";
        assert.match(firstContent, /SMALL-NEEDLE-visible/u);
        const firstIncluded = new Set(first.details?.resultTaskIds ?? []);
        assert.equal(firstIncluded.has(h.task.request.taskId), true);
        const extraIds = extras.map(item => item.request.taskId);
        const unaccommodated = extraIds.filter(taskId => !firstIncluded.has(taskId));
        assert.ok(unaccommodated.length > 0, "budget overflow must leave some tasks without included results");
        for (const taskId of unaccommodated) {
            if (firstContent.includes(taskId)) assert.doesNotMatch(firstContent, new RegExp(`HUGE-HEAD-NEEDLE-${extraIds.indexOf(taskId)}`, "u"));
        }
        await h.invoke("context", { messages: [firstMessage.message] });
        const afterFirst = await readCompletionLedger(root, h.mesh.meshId, h.endpoint.endpointId, h.endpoint.sessionFile);
        const receivedFirst = new Set((afterFirst?.receipts ?? []).flatMap(receipt => receipt.taskIds));
        assert.equal(receivedFirst.has(h.task.request.taskId), true);
        for (const taskId of unaccommodated) assert.equal(receivedFirst.has(taskId), false);
        await h.clock.advance(10_000);
        const later = h.pi.messages.map(item => item.message as { content?: string; details?: { resultTaskIds?: string[] } });
        const laterContent = later.map(item => item.content ?? "").join("\n");
        const laterIncluded = new Set(later.flatMap(item => item.details?.resultTaskIds ?? []));
        for (const taskId of extraIds) assert.ok(laterContent.includes(taskId) || firstContent.includes(taskId), taskId);
        assert.ok(unaccommodated.some(taskId => laterIncluded.has(taskId) || laterContent.includes(taskId)));
    } finally { await h.close(); }
}));

// Admission: wait status is the operator-visible auto-join surface; palette/projection tests cannot observe this live status key.
void test("armed wait status shows plain waiting text", async () => withRoot("mesh-wait-usage-status-", async root => {
    const h = await waitRuntime(root);
    try {
        await h.arm();
        const ending = h.end();
        await awaitArmedWait(h);
        const waitStatus = h.statuses.filter(item => item.key === "mesh-auto-join").map(item => item.value ?? "").at(-1);
        assert.equal(waitStatus, "Mesh: waiting for delegated work");
        h.signal.abort();
        await bounded(ending);
    } finally { await h.close(); }
}));

// Admission: failed context projection/acknowledgment leaves injected events suppressed but unacknowledged; retiring those IDs only after success would either wait forever or, after re-arm, treat stale queue ownership as an immediate wake.
// Given a queued event whose context handler fails, the run emits a diagnostic and disarms; re-arming then blocks on remaining work instead of yielding immediately.
void test("context delivery errors release arming rather than strand suppressed events", async () => withRoot("mesh-wait-context-error-", async root => {
    const h = await waitRuntime(root);
    try {
        await h.arm(); await driveWait(h, (async () => {
            const ending = h.end();
            await yieldToIO();
            const errorChildSession = join(root, "context-error-child.jsonl"); await writeFile(errorChildSession, "");
            const errorReporter = await publishWorker(root, h.mesh.meshId, h.epoch.epochId);
            const errorChildEndpoint = await bindMeshEndpoint(root, h.mesh.meshId, { endpointId: `agent:${errorReporter.agentId}`, kind: "agent", agentId: errorReporter.agentId, harness: "pi", sessionId: "context-error-child", sessionFile: errorChildSession });
            const errorChildTask = await createTaskStore(root, h.mesh.meshId, errorReporter.agentId, { prompt: "context error work", purpose: "synthetic purpose" }, { requesterEndpointId: h.endpoint.endpointId });
            await registerMeshReport(root, h.mesh.meshId, { callerEndpointId: errorChildEndpoint.endpointId, callerEndpointSessionFile: errorChildEndpoint.sessionFile, toolCallId: "context-error", endpoint: h.endpoint, agentId: errorReporter.agentId, taskId: errorChildTask.request.taskId, summary: "synthetic", canonicalArguments: {} });
            await ending;
        })());
        assert.equal(h.pi.messages.length, 1);
        h.pi.messages.push({ message: { role: "custom", customType: "mesh-event", content: "", details: { kind: "completion", sources: "malformed" } }, options: {} });
        await assert.rejects(h.consume(), /Malformed/u);
        assert.ok(h.notifications.some(text => /Malformed/u.test(text)));
        assert.equal((await readTask(root, h.mesh.meshId, h.task.request.taskId)).status.state, "created");
        let resumed = false; const blocked = h.end().finally(() => { resumed = true; });
        await yieldToIO(); await h.clock.advance(1_000); assert.equal(resumed, false);
        h.signal.abort(); await bounded(blocked);
    } finally { await h.close(); }
}));

// Admission: binding loss and store corruption while blocked have no future queue wake, so the extension must fail open with a diagnostic instead of stranding a run.
// Given pending work whose endpoint becomes invalid, the scheduler releases agent_end; error/length boundaries never enter that wait at all.
void test("waiting releases on endpoint loss, store errors, and shutdown while recovery boundaries bypass it", async () => {
    for (const failure of ["offline", "corrupt", "shutdown"] as const) await withRoot(`mesh-wait-${failure}-`, async root => {
        const h = await waitRuntime(root);
        try {
            await h.arm(); await bounded(h.end("error")); await bounded(h.end("length"));
            const ending = h.end(); await h.clock.advance(250);
            if (failure === "offline") await setMeshEndpointOffline(root, h.mesh.meshId, h.endpoint.endpointId, h.endpoint);
            else if (failure === "corrupt") await writeFile(completionLedgerPath(root, h.mesh.meshId, h.endpoint.endpointId, h.endpoint.sessionFile), "broken-json");
            else await h.close();
            await h.clock.advance(2_000); await bounded(ending);
            if (failure !== "shutdown") assert.ok(h.notifications.some(text => /binding|JSON|json/u.test(text)));
        } finally { await h.close(); }
    });
});

// Admission: schemas cannot observe native Pi prompt composition; a stale role Skill injection would reintroduce optional ownership while a missing addition would drop mandatory instructions.
// Given a prompt-only Pi child and a discovered disabled Skill, session startup appends only the synthetic role instructions, creates no route endpoint or management surface, and root routing cannot deliver a message.
void test("prompt-only child receives only role instructions and remains isolated from routed management", async () => withRoot("mesh-prompt-only-runtime-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const promptOnlyCatalog: ChildCatalog = { schemaVersion: 1, children: { "prompt-only": settledAgentDefinition("prompt-only") } }; const promptOnlyPolicy: CallPolicy = { modes: { ops: { targets: ["prompt-only"] } } }; const epoch = await ensurePolicyEpochStore(root, mesh.meshId, { mode: "ops", catalog: promptOnlyCatalog, callPolicy: promptOnlyPolicy }); const promptOnly = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "prompt-only" }); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "prompt-only.jsonl"); await writeFile(sessionFile, ""); const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: promptOnly.agentId, PI_AGENT_RESOLVED_AGENT: promptOnly.envelopePath }; let tick!: () => Promise<void>; const pi = new PiMock(); const ctx = { sessionManager: { getSessionId: () => "prompt-only", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => true } as never; await registerOrchestration(pi as never, { ...files, env, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx);
    const prompt = await pi.handlers.get("before_agent_start")![0]!({ systemPrompt: "base", systemPromptOptions: { skills: [{ name: "retired-role-method", description: "legacy", filePath: "/legacy/SKILL.md", disableModelInvocation: true }] } }, ctx);
    assert.deepEqual(prompt, { systemPrompt: "base\n\nPerform prompt-only." });
    assert.deepEqual(pi.active, []); assert.equal(pi.tools.has("mesh_enable"), false); assert.equal(pi.handlers.has("context"), false); assert.equal(pi.eventHandlers.get("command-palette:contribution")?.length ?? 0, 0);
    await assert.rejects(readMeshEndpoint(root, mesh.meshId, `agent:${promptOnly.agentId}`), /ENOENT/u); await assert.rejects(resolveRouteEndpoint(root, mesh.meshId, promptOnly.agentId), /not a durable Pi endpoint/u); await tick(); assert.deepEqual(pi.messages, []); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Admission: OpenAI-compatible providers consume this schema directly, and some reject a root union without an explicit object type before any tool call can run; TypeBox validation alone cannot detect that wire incompatibility.
// Given authorized role selectors, mesh_send exposes a top-level object schema to the provider while retaining its dependent selector validation.
void test("mesh_send exposes a provider-compatible object schema with authorized capability selectors", async () => withRoot("mesh-profile-schema-", async root => {
    const meshId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; const agentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; const epochId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; const snapshot = buildPolicySnapshot({ mode: "ops", catalog, callPolicy }); const envelope = buildLaunchEnvelopeV8({ meshId, agentId, epochId, childId: "worker", snapshot, childExtensions: Object.fromEntries(Object.keys(snapshot.children).map(name => [name, []])) }); const epoch = { schemaVersion: 7, meshId, epochId, ...snapshot, policyDigest: envelope.policyDigest, createdAt: new Date().toISOString() } as const; const configPath = join(root, "orchestration.json"); await writeFile(configPath, JSON.stringify(runtimeConfig(root))); const deps = { configPath, env: {}, exec: absentTmux, activeCaller: () => caller(meshId, epoch as never, { identity: "agent:worker", agentId, envelope, endpointId: `agent:${agentId}` }) };
    const tool = createMeshSendTool(deps, { worker: settledAgentDefinition("worker") }); assert.equal((tool.parameters as { type?: string }).type, "object"); assert.equal(Value.Check(tool.parameters, { agent: "worker", access: "read", purpose: "synthetic purpose", message: "selected" }), true); assert.equal(Value.Check(tool.parameters, { agent: "worker", access: "read", message: "omitted purpose" }), false); assert.equal(Value.Check(tool.parameters, { agentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", message: "existing" }), true); assert.equal(Value.Check(tool.parameters, { agent: "worker", message: "omitted" }), false); assert.equal(Value.Check(tool.parameters, { agent: "worker", access: "write", purpose: "synthetic purpose", message: "forged" }), false); assert.equal(Value.Check(tool.parameters, { agent: "worker", access: "read", profile: "pi-default", message: "internal" }), false);
}));

// Given malformed dependent selectors passed directly to execute, authorization rejects before endpoint lookup or any lifecycle persistence.
void test("mesh_send rejects omitted, forged, extra, and unauthorized selectors before mutation", async () => withRoot("mesh-profile-premutation-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const localCatalog: ChildCatalog = { schemaVersion: 1, children: { worker: settledAgentDefinition("worker"), explorer: settledAgentDefinition("explorer") } };
    const localPolicy: CallPolicy = { modes: { ops: { targets: ["worker", "explorer"] } } };
    const epoch = await ensurePolicyEpochStore(root, mesh.meshId, { mode: "ops", catalog: localCatalog, callPolicy: localPolicy });
    const files = await writeRuntimeFiles(root); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile: join(root, "missing.jsonl") }) };
    const tool = createMeshSendTool(deps, localCatalog.children);
    for (const [params, pattern] of [
        [{ agent: "worker", message: "omitted access" }, /requires access/u],
        [{ agent: "worker", access: "read", message: "omitted purpose" }, /requires purpose/u],
        [{ agent: "worker", access: "read", purpose: "bad\npurpose", message: "newline" }, /single line/u],
        [{ agent: "worker", access: "write", purpose: "synthetic purpose", message: "forged access" }, /not allowed/u],
        [{ agent: "search", access: "read", purpose: "synthetic purpose", message: "root search" }, /not allowed/u],
        [{ agent: "small-read", access: "read", purpose: "synthetic purpose", message: "internal role" }, /not allowed/u],
    ] as const) await assert.rejects(tool.execute("invalid-selector", params, undefined, undefined, { cwd: root } as never), pattern);
    const paths = meshPaths(root, mesh.meshId); assert.deepEqual(await readdir(paths.reservations), []); assert.deepEqual(await readdir(paths.agents), []); assert.deepEqual(await readdir(paths.tasks), []);
    assert.equal((await readdir(paths.events)).filter(name => name.startsWith("send-retry-")).length, 0);
}));

// Given an existing agent whose selected profile was removed from the current direct edge, reuse rejects before reserving or creating a task.
void test("mesh_send reuse requires the current child definition", async () => withRoot("mesh-reuse-profile-edge-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets });
    const initial = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, initial.epochId);
    const cursorWorker = { ...settledAgentDefinition("worker"), execution: cursorExecution }; const narrowedPolicy: CallPolicy = { modes: { narrowed: { targets: ["worker"] } } }; const narrowed = await ensurePolicyEpochStore(root, mesh.meshId, { mode: "narrowed", catalog: { schemaVersion: 1, children: { worker: cursorWorker } }, callPolicy: narrowedPolicy });
    await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); const files = await writeRuntimeFiles(root); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, narrowed, { identity: "mode:narrowed", sessionFile }) }; const reservationsBefore = await readdir(meshPaths(root, mesh.meshId).reservations);
    await assert.rejects(createMeshSendTool(deps, { worker: cursorWorker }).execute("reuse-stale-profile", { agentId: worker.agentId, message: "must not reuse" }, undefined, undefined, { cwd: root } as never), /current immutable capability route/u);
    assert.deepEqual(await readdir(meshPaths(root, mesh.meshId).reservations), reservationsBefore); assert.deepEqual(await readdir(meshPaths(root, mesh.meshId).tasks), []);
}));

// Given a live reusable agent, mesh_send returns its durable nonterminal handle before the task is terminal and that same handle later observes successful completion.
void test("mesh_send existing-agent reuse succeeds immediately before terminal completion", async () => withRoot("mesh-reuse-success-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId);
    await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${worker.agentId}`, kind: "agent", agentId: worker.agentId, harness: "pi", sessionId: "worker", sessionFile: join(root, "worker.jsonl") }); const files = await writeRuntimeFiles(root);
    const exec = async (_command: string, args: string[]) => { if (args.includes("display-message")) return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("list-panes")) return { stdout: `${tmux.paneId}\t0\n`, stderr: "", code: 0 }; if (args.includes("has-session")) return { stdout: "", stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; };
    const deps = { ...files, env: {}, exec, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) };
    const submitted = await createMeshSendTool(deps, { worker: settledAgentDefinition("worker") }).execute("reuse-success", { agentId: worker.agentId, purpose: "complete after submit", message: "complete after submit returns" }, undefined, undefined, { cwd: root } as never);
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
    try {
        const rootPi = new PiMock(); await registerOrchestration(rootPi as never, { ...files, env: {} }); assert.equal(rootPi.tools.has("mesh_enable"), false); assert.equal(rootPi.tools.has("end_response"), true);
        const leafPi = new PiMock(); await registerOrchestration(leafPi as never, { ...files, env: { PI_MESH_AGENT_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }); assert.equal(leafPi.tools.has("mesh_enable"), false);
        await assert.rejects(async () => { await leafPi.handlers.get("session_start")![0]!({}, { sessionManager: { getSessionId: () => "leaf", getSessionFile: () => "/leaf.jsonl" } } as never); }, /valid launch envelope and mesh identity/u);
    }
    finally { if (previous === undefined) delete process.env.PI_EXTENSION_KEYBINDINGS_PATH; else process.env.PI_EXTENSION_KEYBINDINGS_PATH = previous; }
}));

// Admission: custom-type names and state-root paths are not type-checked; restoring a retired mesh-root-binding would attach a v11 process to leftover mesh state.
// Given a previous-namespace directory and an old binding that names a leftover mesh in the new root, a fresh session creates a new mesh, writes only the v11 binding, and leaves both leftovers unmodified.
void test("a v11 root ignores retired bindings and leaves the previous state directory unmodified", async () => withRoot("mesh-retained-v9-", async root => {
    const stateRoot = join(root, "orchestration-v11");
    const legacyRoot = join(root, "orchestration-v9");
    const marker = join(legacyRoot, "retained.json");
    await mkdir(legacyRoot, { recursive: true });
    await writeFile(marker, "retained");
    const leftover = await initializeMesh(stateRoot, { rootSessionId: "legacy-session", recoverable: true, budgets });
    const leftoverRecord = await readMesh(stateRoot, leftover.meshId);
    const files = await writeRuntimeFiles(root);
    await writeFile(files.configPath, JSON.stringify(runtimeConfig(stateRoot)));
    const sessionFile = join(root, "session.jsonl");
    await writeFile(sessionFile, "");
    const keybindings = await writeMeshKeybindings(root);
    const previous = process.env.PI_EXTENSION_KEYBINDINGS_PATH;
    process.env.PI_EXTENSION_KEYBINDINGS_PATH = keybindings;
    const branch = [
        { type: "custom", customType: "mesh-root-binding", data: { schemaVersion: 1, meshId: leftover.meshId } },
        { type: "custom", customType: "mesh-policy-epoch", data: { schemaVersion: 1, meshId: leftover.meshId, mode: "ops", epochId: leftover.meshId, policyDigest: "0".repeat(64) } },
    ];
    const notifications: string[] = [];
    const ctx = { sessionManager: { getSessionId: () => "root-session", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { notify(text: string) { notifications.push(text); }, setStatus() {} }, isIdle: () => true } as never;
    try {
        const pi = new PiMock();
        await registerOrchestration(pi as never, { ...files, env: {}, setInterval() { return "timer"; }, clearInterval() {} });
        await pi.handlers.get("session_start")![0]!({}, ctx);
        assert.deepEqual(notifications, []);
        assert.equal(await readFile(marker, "utf8"), "retained");
        const persisted = pi.entries.find(entry => entry.customType === "mesh-root-binding-v11") as { data?: { meshId?: string } } | undefined;
        assert.equal(typeof persisted?.data?.meshId, "string");
        assert.notEqual(persisted!.data!.meshId, leftover.meshId);
        assert.equal(pi.entries.some(entry => entry.customType === "mesh-root-binding" || entry.customType === "mesh-policy-epoch"), false);
        const leftoverAfter = await readMesh(stateRoot, leftover.meshId);
        assert.deepEqual({ state: leftoverAfter.state, updatedAt: leftoverAfter.updatedAt }, { state: leftoverRecord.state, updatedAt: leftoverRecord.updatedAt });
        await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
    } finally { if (previous === undefined) delete process.env.PI_EXTENSION_KEYBINDINGS_PATH; else process.env.PI_EXTENSION_KEYBINDINGS_PATH = previous; }
}));

// Admission: partial activation would expose an inconsistent management surface before dispatch, and no schema or type guarantee observes Pi's runtime active set.
// Given a fresh authorized child, when staged activation crosses Pi's active-tool and persistence boundary, all five peers become active atomically and either failure restores the exact prior set.
void test("staged send activation is additive, complete, and rolls back activation or persistence failure", async () => {
    const meshId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; const epochId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; const agentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; const snapshot = buildPolicySnapshot({ mode: "ops", catalog, callPolicy }); const envelope = buildLaunchEnvelopeV8({ meshId, agentId, epochId, childId: "reviewer", snapshot, childExtensions: Object.fromEntries(Object.keys(snapshot.children).map(name => [name, []])) }); const epoch = { schemaVersion: 7, meshId, epochId, ...snapshot, policyDigest: envelope.policyDigest, createdAt: "2026-01-01T00:00:00.000Z" } as const; const activeCaller = caller(meshId, epoch as never, { identity: "agent:reviewer", agentId, envelope, endpointId: `agent:${agentId}` });
    const pi = new PiMock(); for (const name of MESH_TOOLS) pi.registerTool({ name }); pi.active = ["read", "mesh_send", "mesh_report"]; let persisted = 0;
    await activateMeshPeerToolsForSend(pi as never, activeCaller, async () => { persisted += 1; });
    assert.deepEqual(MESH_TOOLS.filter(name => !pi.active.includes(name)), []); assert.equal(new Set(pi.active).size, pi.active.length); assert.equal(persisted, 1);

    const incomplete = new PiMock(); for (const name of MESH_TOOLS) incomplete.registerTool({ name }); incomplete.active = ["read", "mesh_send", "mesh_report"]; const setActive = incomplete.setActiveTools.bind(incomplete); let denyReport = true; incomplete.setActiveTools = names => { if (denyReport && names.includes("mesh_report")) { denyReport = false; setActive(names.filter(name => name !== "mesh_report")); } else setActive(names); }; let incompletePersisted = 0;
    await assert.rejects(activateMeshPeerToolsForSend(incomplete as never, activeCaller, async () => { incompletePersisted += 1; }), /activation incomplete.*mesh_report/u); assert.deepEqual(incomplete.active, ["read", "mesh_send", "mesh_report"]); assert.equal(incompletePersisted, 0);

    const persistence = new PiMock(); for (const name of MESH_TOOLS) persistence.registerTool({ name }); persistence.active = ["read", "mesh_send", "mesh_report"];
    await assert.rejects(activateMeshPeerToolsForSend(persistence as never, activeCaller, async () => { throw new Error("status persistence failed"); }), /status persistence failed/u); assert.deepEqual(persistence.active, ["read", "mesh_send", "mesh_report"]);

    const legacy = new PiMock(); for (const name of MESH_TOOLS.filter(name => name !== "mesh_control")) legacy.registerTool({ name }); legacy.active = ["read", "mesh_send", "mesh_report"]; await assert.rejects(activateMeshPeerToolsForSend(legacy as never, activeCaller, async () => {}), /restart required.*mesh_control/u); assert.deepEqual(legacy.active, ["read", "mesh_send", "mesh_report"]);
});

// Admission: the first authorized child dispatch must expose the complete management surface before task mutation and persisted state must restore that surface after reload; Pi's registry mock and schemas do not guarantee either boundary.
// Given a fresh reviewer child, when its first send targets an authorized review-lens, the next request sees all peers, persistence restores them after reload, and pre-send persistence failure creates no task.
void test("reviewer first send unlocks all peers transactionally and reload restores them", async () => withRoot("mesh-staged-send-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["reviewer"], roles: { reviewer: settledAgentDefinition("reviewer"), "review-lens": settledAgentDefinition("review-lens"), validator: settledAgentDefinition("validator") } });
    const reviewer = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "reviewer" }); const lens = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "review-lens", parentAgentId: reviewer.agentId }); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${lens.agentId}`, kind: "agent", agentId: lens.agentId, harness: "pi", sessionId: "lens", sessionFile: join(root, "lens.jsonl") });
    const files = await writeRuntimeFiles(root); const sessionFile = join(root, "reviewer.jsonl"); await writeFile(sessionFile, ""); const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: reviewer.agentId, PI_AGENT_RESOLVED_AGENT: reviewer.envelopePath }; const ctx = { sessionManager: { getSessionId: () => "reviewer-session", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => false } as never;
    const liveExec = async (_command = "", args: string[] = []) => { if (args.includes("display-message")) return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("list-panes")) return { stdout: `${tmux.paneId}\t0\n`, stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; };
    const pi = new PiMock(); pi.exec = liveExec; await registerOrchestration(pi as never, { ...files, env, setInterval() { return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); assert.deepEqual(pi.active, ["read", "mesh_send", "mesh_report", "end_response"]);
    const registered = pi.tools.get("mesh_send")!; assert.equal(Value.Check(registered.parameters, { agent: "review-lens", access: "read", purpose: "synthetic purpose", message: "focused review" }), true); assert.equal(Value.Check(registered.parameters, { agent: "validator", access: "read", purpose: "synthetic purpose", message: "focused validation" }), true); assert.equal(Value.Check(registered.parameters, { agent: "worker", access: "read", purpose: "synthetic purpose", message: "forged" }), false);

    const currentEpoch = await readPolicyEpoch(root, mesh.meshId, epoch.epochId); const directDeps = { ...files, env, exec: liveExec, activeCaller: () => caller(mesh.meshId, currentEpoch, { identity: "agent:reviewer", agentId: reviewer.agentId, envelope: reviewer.envelope, endpointId: `agent:${reviewer.agentId}`, sessionFile }) }; const before = await readdir(meshPaths(root, mesh.meshId).tasks); const failing = createMeshSendTool(directDeps, { "review-lens": settledAgentDefinition("review-lens"), validator: settledAgentDefinition("validator") }, activeCaller => activateMeshPeerToolsForSend(pi as never, activeCaller, async () => { throw new Error("status persistence failed"); }));
    await assert.rejects(failing.execute("failed-staged-submit", { agentId: lens.agentId, message: "must not mutate lifecycle" }, undefined, undefined, { cwd: root } as never), /status persistence failed/u); assert.deepEqual(await readdir(meshPaths(root, mesh.meshId).tasks), before); assert.deepEqual(pi.active, ["read", "mesh_send", "mesh_report", "end_response"]);

    const submitted = await registered.execute("reviewer-to-lens", { agentId: lens.agentId, purpose: "inspect the bounded lens", message: "inspect the bounded lens" }, undefined, undefined, { cwd: root } as never); assert.equal((submitted.details as any).agent.childId, "review-lens"); assert.deepEqual(MESH_TOOLS.filter(name => !pi.active.includes(name)), []); assert.equal((await readAgentSnapshot(root, mesh.meshId, reviewer.agentId)).status.meshToolsEnabled, true);
    const submittedVisible = JSON.parse((submitted.content[0] as { text: string }).text) as { taskId: string; nextAction: { action: string; calls: string; keepCallerOpen: boolean } }; assert.deepEqual(submittedVisible.nextAction, { action: "continue_independent_work", yieldVia: "end_response", arguments: {}, calls: "once", keepCallerOpen: true });
    const pending = await createMeshGetTool(directDeps).execute("nested-not-ready", { taskId: submittedVisible.taskId }, undefined, undefined, {} as never); const pendingVisible = JSON.parse((pending.content[0] as { text: string }).text) as { resultAvailable: boolean; nextAction: { action: string; calls: string; keepCallerOpen: boolean } }; assert.equal(pendingVisible.resultAvailable, false); assert.deepEqual({ action: pendingVisible.nextAction.action, calls: pendingVisible.nextAction.calls, keepCallerOpen: pendingVisible.nextAction.keepCallerOpen }, { action: "continue_independent_work", calls: "once", keepCallerOpen: true });
    await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" }); const reloaded = new PiMock(); await registerOrchestration(reloaded as never, { ...files, env, setInterval() { return "timer"; }, clearInterval() {} }); await reloaded.handlers.get("session_start")![0]!({}, ctx); assert.deepEqual(MESH_TOOLS.filter(name => !reloaded.active.includes(name)), []); await reloaded.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Admission: nonterminal retrieval is a public control-plane boundary; only runtime execution can prove it neither accounts nor creates a receipt.
// Given a pending authorized task, mesh_get reports that its result is not ready without an accounting payload or receipt.
void test("mesh_get reports nonterminal work as not-ready without accounting", async () => withRoot("mesh-get-not-ready-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const endpointId = `root:${mesh.meshId}`; await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "root", harness: "pi", sessionId: "root", sessionFile });
    const task = await createTask(root, mesh.meshId, worker.agentId, { prompt: "still running", purpose: "synthetic purpose" }); const files = await writeRuntimeFiles(root); const exec = async (_command: string, args: string[]) => args.includes("display-message") ? { stdout: "10\n", stderr: "", code: 0 } : args.includes("list-panes") ? { stdout: `${tmux.paneId}\t0\n`, stderr: "", code: 0 } : { stdout: "", stderr: "", code: 0 }; const got = await createMeshGetTool({ ...files, env: {}, exec, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) }).execute("not-ready", { taskId: task.request.taskId }, undefined, undefined, {} as never);
    const visible = JSON.parse((got.content[0] as { text: string }).text) as { taskId: string; taskState: string; resultAvailable: boolean; nextAction: { action: string; resumeVia: string } }; assert.deepEqual({ taskId: visible.taskId, taskState: visible.taskState, resultAvailable: visible.resultAvailable }, { taskId: task.request.taskId, taskState: "created", resultAvailable: false }); assert.deepEqual({ action: visible.nextAction.action, calls: (visible.nextAction as any).calls }, { action: "continue_independent_work", calls: "once" }); assert.equal((got.details as any).accounting, undefined); assert.equal(await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile), undefined);
}));

// Admission: wait drain after explicit retrieval is owned at the mesh_get receipt boundary, not by notification injection.
void test("mesh_get receipt untracks wait tasks", async () => withRoot("mesh-get-untrack-wait-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, "");
    const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
    const worker = await publishWorker(root, mesh.meshId, epoch.epochId);
    const endpointId = `root:${mesh.meshId}`;
    await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "root", harness: "pi", sessionId: "root", sessionFile });
    const endpoint = await readMeshEndpoint(root, mesh.meshId, endpointId);
    const task = await createTaskStore(root, mesh.meshId, worker.agentId, { prompt: "retrieve", purpose: "synthetic purpose" }, { requesterEndpointId: endpointId, completion: { endpointId, endpointSessionFile: sessionFile, bindingId: endpoint.bindingId } });
    await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "done" });
    const untracked: string[] = [];
    const files = await writeRuntimeFiles(root);
    const got = await createMeshGetTool({ ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }), untrackWaitTask: (_caller, taskId) => { untracked.push(taskId); } }).execute("get", { taskId: task.request.taskId }, undefined, undefined, {} as never);
    assert.deepEqual(untracked, [task.request.taskId]);
    assert.ok((got.details as { accounting?: { receivedTaskIds?: string[] } }).accounting?.receivedTaskIds?.includes(task.request.taskId));
}));

// Admission: interrupt is execution control, not task cancellation; writing cancel.json would finish the held task after resume.
void test("mesh_control interrupt does not write cancel.json", async () => withRoot("mesh-control-interrupt-cancel-", async root => {
    const h = await waitRuntime(root);
    try {
        const result = await h.pi.tools.get("mesh_control")!.execute("interrupt", { agentId: h.worker.agentId, action: "interrupt" }, undefined, undefined, h.ctx);
        assert.equal((result.details as { action?: string }).action, "interrupt");
        await assert.rejects(access(taskPaths(root, h.mesh.meshId, h.task.request.taskId).cancel), /ENOENT/u);
        assert.equal((await readTask(root, h.mesh.meshId, h.task.request.taskId)).status.state, "created");
    } finally { await h.close(); }
}));

// Admission: coupling the caller's process gate to descendant store holds would pause the parent when a child is paused or limited; schemas cannot observe that process-local gate.
// Given a paused or limit-held child, the parent continues to admit provider work, parent input does not clear the child limit, and the child remains held.
void test("child pause and limit do not close the parent process gate", async () => withRoot("mesh-parent-child-gate-", async root => {
    const h = await waitRuntime(root);
    try {
        await h.pi.tools.get("mesh_control")!.execute("pause", { agentId: h.worker.agentId, action: "pause" }, undefined, undefined, h.ctx);
        assert.equal((await readAgentExecution(root, h.mesh.meshId, h.worker.agentId))?.holds.some(hold => hold.kind === "manual"), true);
        await bounded(h.invoke("before_provider_request"));
        await h.invoke("after_provider_response");
        await h.invoke("input", { text: "parent continues", source: "interactive", streamingBehavior: "steer" });
        assert.equal((await readAgentExecution(root, h.mesh.meshId, h.worker.agentId))?.holds.some(hold => hold.kind === "manual"), true);
        await applyAgentControl(root, h.mesh.meshId, h.worker.agentId, {
            action: "pause",
            source: "system",
            issuer: "limit",
            limitHold: { holdId: randomUUID(), kind: "limit", requestId: randomUUID(), source: "system", targetRoot: h.worker.agentId },
        });
        await h.invoke("input", { text: "must not clear child limit", source: "interactive", streamingBehavior: "steer" });
        await bounded(h.invoke("before_provider_request"));
        await h.invoke("after_provider_response");
        assert.equal((await readAgentExecution(root, h.mesh.meshId, h.worker.agentId))?.holds.some(hold => hold.kind === "limit"), true);
    } finally { await h.close(); }
}));

// Admission: compact result IDs recorded before a failed inject would omit those tasks from the next delivery; the pump is the consumer-visible packing boundary.
// Given an idle root whose first completion inject throws, a later pump includes the same compact result.
void test("failed completion inject retries compact results instead of dropping them", async () => withRoot("mesh-completion-inject-rollback-", async root => {
    const h = await waitRuntime(root);
    try {
        h.ctx.isIdle = () => true;
        const original = h.pi.sendMessage.bind(h.pi);
        let failures = 0;
        h.pi.sendMessage = (message, options) => {
            const raw = message as { customType?: string; details?: { kind?: string } };
            if (raw.customType === "mesh-event" && raw.details?.kind === "completion" && failures < 1) {
                failures += 1;
                throw new Error("inject failed");
            }
            return original(message, options);
        };
        await finishTask(root, h.mesh.meshId, h.task.request.taskId, { outcome: "succeeded", output: "inject-retry-visible" });
        await h.clock.advance(10_000);
        await h.clock.advance(10_000);
        assert.equal(failures, 1);
        const delivered = h.pi.messages.map(item => JSON.stringify(item.message)).join("\n");
        assert.match(delivered, /inject-retry-visible/u);
    } finally { await h.close(); }
}));

// Admission: production control must not drop a durable hold when the child runtime is gone; types cannot observe a missing binding.
// Given a paused child with no runtime binding, resume reports unavailable and leaves the hold in place.
void test("production resume without runtime binding is unavailable and keeps the hold", async () => withRoot("mesh-resume-unbound-", async root => {
    const h = await waitRuntime(root);
    try {
        await h.pi.tools.get("mesh_control")!.execute("pause", { agentId: h.worker.agentId, action: "pause" }, undefined, undefined, h.ctx);
        const binding = await readAgentRuntimeBinding(root, h.mesh.meshId, h.worker.agentId);
        assert.ok(binding);
        await unbindAgentRuntime(root, h.mesh.meshId, h.worker.agentId, binding.runtimeId);
        const result = await h.pi.tools.get("mesh_control")!.execute("resume", { agentId: h.worker.agentId, action: "resume" }, undefined, undefined, h.ctx);
        const targets = (result.details as { targets: Array<{ status: string; phase: string }> }).targets;
        assert.equal(targets[0]?.status, "unavailable");
        assert.equal(targets[0]?.phase, "unavailable");
        assert.equal((await readAgentExecution(root, h.mesh.meshId, h.worker.agentId))?.holds.some(hold => hold.kind === "manual"), true);
    } finally { await h.close(); }
}));

// Admission: an existing-agent send has distinct consumer outcomes for busy intervention and idle submission; schemas cannot observe its stable retry result.
// Given a direct child that is busy or idle, mesh_send durably intervenes or submits respectively, and retrying the intervention reuses its original handle.
void test("mesh_send intervenes when busy, submits when idle, and retries idempotently", async () => withRoot("mesh-send-state-aware-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${worker.agentId}`, kind: "agent", agentId: worker.agentId, harness: "pi", sessionId: "worker", sessionFile: join(root, "worker.jsonl") });
    const active = await createTask(root, mesh.meshId, worker.agentId, { prompt: "active work", purpose: "synthetic purpose" }); const files = await writeRuntimeFiles(root); const send = createMeshSendTool({ ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) }, { worker: settledAgentDefinition("worker") });
    const first = await send.execute("busy-send", { agentId: worker.agentId, message: "change direction" }, undefined, undefined, {} as never); const retry = await send.execute("busy-send", { agentId: worker.agentId, message: "change direction" }, undefined, undefined, {} as never);
    assert.deepEqual(retry.details, first.details); const { displayIdentity, fromEndpointId, toEndpointId, identities, ...protocolDetails } = first.details as any; assert.deepEqual(protocolDetails, { disposition: "intervened", agentId: worker.agentId, taskId: active.request.taskId, messageId: (first.details as any).messageId, sequence: 1, deliveryState: "pending" });
    const firstVisible = JSON.parse((first.content[0] as { text: string }).text) as Record<string, any>; const { nextAction: firstAction, ...firstProtocol } = firstVisible; assert.deepEqual(firstProtocol, protocolDetails); assert.deepEqual({ action: firstAction.action, calls: firstAction.calls }, { action: "continue_independent_work", calls: "once" }); assert.equal(fromEndpointId, `root:${mesh.meshId}`); assert.equal(toEndpointId, `agent:${worker.agentId}`); assert.deepEqual({ agentId: displayIdentity.agentId, publicAgent: displayIdentity.publicAgent, access: displayIdentity.access }, { agentId: worker.agentId, publicAgent: "worker", access: "read" }); assert.equal("role" in displayIdentity, false); assert.equal("profile" in displayIdentity, false); assert.equal(identities[worker.agentId].publicAgent, "worker"); assert.equal(identities[worker.agentId].access, "read");
    await finishTask(root, mesh.meshId, active.request.taskId, { outcome: "succeeded", output: "done" }); const submitted = await send.execute("idle-send", { agentId: worker.agentId, purpose: "new idle work", message: "new work" }, undefined, undefined, {} as never);
    assert.equal((submitted.details as any).task.request.prompt, "new work"); assert.equal((submitted.details as any).task.request.purpose, "new idle work"); assert.equal((submitted.details as any).task.status.state, "created"); const submittedVisible = JSON.parse((submitted.content[0] as { text: string }).text) as { nextAction: { action: string; calls: string }; purpose: string }; assert.equal(submittedVisible.purpose, "new idle work"); assert.deepEqual({ action: submittedVisible.nextAction.action, calls: submittedVisible.nextAction.calls }, { action: "continue_independent_work", calls: "once" });
}));

// Admission: leaf report availability and routing cross launch policy, live endpoint binding, and task ownership; no lower-level event test proves the tool is exposed to its consumer.
// Given a leaf child with a parent-routed active task, startup exposes only mesh_report and the report reaches that parent endpoint.
void test("leaf children register mesh_report and route active-task reports to their parent", async () => withRoot("mesh-leaf-report-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["reviewer"], roles: { reviewer: settledAgentDefinition("reviewer"), "review-lens": settledAgentDefinition("review-lens"), validator: settledAgentDefinition("validator") } });
    const parent = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "reviewer" }); const leaf = await publishWorker(root, mesh.meshId, epoch.epochId, { role: "review-lens", parentAgentId: parent.agentId }); const parentSession = join(root, "parent.jsonl"); await writeFile(parentSession, ""); const parentEndpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${parent.agentId}`, kind: "agent", agentId: parent.agentId, harness: "pi", sessionId: "parent", sessionFile: parentSession });
    const task = await createTaskStore(root, mesh.meshId, leaf.agentId, { prompt: "leaf work", purpose: "synthetic purpose" }, { requesterEndpointId: parentEndpoint.endpointId, requesterAgentId: parent.agentId, completion: { endpointId: parentEndpoint.endpointId, endpointSessionFile: parentSession } }); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "leaf.jsonl"); await writeFile(sessionFile, ""); const pi = new PiMock(); const ctx = { sessionManager: { getSessionId: () => "leaf", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => false } as never;
    await registerOrchestration(pi as never, { ...files, env: { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: leaf.agentId, PI_AGENT_RESOLVED_AGENT: leaf.envelopePath }, setInterval() { return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); assert.deepEqual(pi.active, ["read", "mesh_report", "end_response"]);
    const result = await pi.tools.get("mesh_report")!.execute("report", { summary: "bounded progress" }, undefined, undefined, {}); const { displayIdentity, fromEndpointId, toEndpointId, identities, ...protocolDetails } = result.details as any; assert.deepEqual(protocolDetails, { reportId: (result.details as any).reportId, taskId: task.request.taskId, state: "queued" }); assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), protocolDetails); assert.equal(fromEndpointId, `agent:${leaf.agentId}`); assert.equal(toEndpointId, parentEndpoint.endpointId); assert.deepEqual({ agentId: displayIdentity.agentId, publicAgent: displayIdentity.publicAgent, access: displayIdentity.access }, { agentId: leaf.agentId, publicAgent: "review-lens", access: "read" }); assert.equal("role" in displayIdentity, false); assert.equal("profile" in displayIdentity, false); assert.equal(identities[leaf.agentId].publicAgent, "review-lens"); assert.equal(identities[parent.agentId].publicAgent, "reviewer"); assert.equal(identities[parent.agentId].access, "read"); const reports = (await readEndpointDeliverySnapshot(root, mesh.meshId, parentEndpoint)).events.filter(event => event.kind === "report"); assert.equal(reports.length, 1); assert.equal(reports[0]!.payload.summary, "bounded progress"); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Admission: context acknowledgement is the runtime boundary that proves injected interventions become one parent-visible frontier rather than unacknowledged delivery state.
// Given two interventions for a busy child task in one context, the context hook acknowledges their shared sequence frontier with one delivery-ack bundle.
void test("intervention context acknowledgement bundles a shared delivery frontier", async () => withRoot("mesh-intervention-ack-", async root => {
    const rootSession = join(root, "root.jsonl"); await writeFile(rootSession, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: rootSession, recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
    const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const rootEndpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile: rootSession }); const task = await createTask(root, mesh.meshId, worker.agentId, { prompt: "active work", purpose: "synthetic purpose" }); const files = await writeRuntimeFiles(root); const childSession = join(root, "worker.jsonl"); await writeFile(childSession, ""); const pi = new PiMock(); const ctx = { sessionManager: { getSessionId: () => "worker", getSessionFile: () => childSession, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => false } as never;
    let tick!: () => Promise<void>; await registerOrchestration(pi as never, { ...files, env: { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: worker.agentId, PI_AGENT_RESOLVED_AGENT: worker.envelopePath }, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx);
    const send = createMeshSendTool({ ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile: rootSession }) }, { worker: settledAgentDefinition("worker") }); await send.execute("intervention-one", { agentId: worker.agentId, message: "first adjustment" }, undefined, undefined, {} as never); await send.execute("intervention-two", { agentId: worker.agentId, message: "second adjustment" }, undefined, undefined, {} as never);
    for (let attempt = 0; attempt < 5 && pi.messages.length < 2; attempt += 1) await tick(); const context = await pi.handlers.get("context")![0]!({ messages: pi.messages.map(item => item.message) }, ctx); assert.ok(context);
    const acknowledgements = (await readEndpointDeliverySnapshot(root, mesh.meshId, rootEndpoint)).events.filter(event => event.kind === "delivery-ack"); assert.equal(acknowledgements.length, 1); assert.equal(acknowledgements[0]!.payload.taskId, task.request.taskId); assert.equal(acknowledgements[0]!.payload.acknowledgedThrough, 2); assert.equal((acknowledgements[0]!.payload.messageIds as string[]).length, 2); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Admission: batching acknowledgments can attribute every intake to the first child. The runtime
// owns that display wiring; event schemas cannot detect the wrong human-visible sender.
// Given acknowledgments from two children, the delivered card identifies each original child
// and confirms intake, even while the acknowledgment notification itself is still pending.
void test("acknowledgment batches retain each child's direction and intake state", async () => withRoot("mesh-ack-display-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, "");
    const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets });
    const files = await writeRuntimeFiles(root); const pi = new PiMock(); const clock = new FakeMonotonicTimers();
    const branch = [{ type: "custom", customType: "mesh-root-binding-v11", data: { schemaVersion: 1, meshId: mesh.meshId } }];
    const ctx = { sessionManager: { getSessionId: () => "root", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { setStatus() {}, notify() {} }, isIdle: () => false } as never;
    await registerOrchestration(pi as never, { ...files, env: {}, now: () => clock.now, setInterval: clock.setTimeout, clearInterval: clock.clearTimeout, wake: { watch: () => ({ close() {}, on() { return this; }, unref() {} }) } });
    await pi.handlers.get("session_start")![0]!({}, ctx);
    const endpoint = await readMeshEndpoint(root, mesh.meshId, `root:${mesh.meshId}`);
    const agentIds = [randomUUID(), randomUUID()];
    for (const agentId of agentIds) {
        const eventId = randomUUID();
        await writeFile(join(meshPaths(root, mesh.meshId).events, `${eventId}.json`), JSON.stringify({ schemaVersion: 1, meshId: mesh.meshId, eventId, endpointId: endpoint.endpointId, endpointSessionFile: sessionFile, endpointBindingId: endpoint.bindingId, senderEndpointId: `agent:${agentId}`, senderEndpointSessionFile: join(root, `${agentId}.jsonl`), delivery: "steer", state: "pending", kind: "delivery-ack", payload: { eventId, ackId: eventId, agentId, taskId: randomUUID(), acknowledgedThrough: 1, messageIds: [randomUUID()] }, createdAt: new Date().toISOString() }));
        await indexEventCreation(root, mesh.meshId, { endpointId: endpoint.endpointId, endpointSessionFile: sessionFile, bindingId: endpoint.bindingId, eventId, createdAt: new Date().toISOString() }, true);
    }
    await clock.advance(2000);
    const message = pi.messages.find(item => (item.message as any).details?.kind === "delivery-ack")?.message as any;
    assert.ok(message);
    const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text } as never;
    const rendered = renderMeshEventMessage(message, { expanded: false }, theme, ["May"]).render(180).join("\n");
    for (const agentId of agentIds) assert.ok(rendered.includes(`${handleForAgentId(agentId, ["May"])} → root`), rendered);
    assert.match(rendered, /intake confirmed/u); assert.match(rendered, /acknowledged/u); assert.doesNotMatch(rendered, /pending|completed/u);
    await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Admission: root materialization and endpoint delivery are repository-owned production wiring; schemas cannot detect endpoint-count multiplication or a read pass that settles ledgers.
// Given a restored root and routed terminal work, startup and deadline advancement expose one-second materialization followed by a fixed five-second delivery window without duplicate settlement when another endpoint exists.
void test("root registration materializes once per deadline and opens a fixed delivery window", async () => withRoot("mesh-root-cadence-", async root => {
    const sessionFile = join(root, "root-session.jsonl"); await writeFile(sessionFile, "");
    const mesh = await initializeMesh(root, { rootSessionId: "root-session", rootSessionFile: sessionFile, recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
    const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const endpointId = `root:${mesh.meshId}`; const completion = { endpointId, endpointSessionFile: sessionFile };
    const files = await writeRuntimeFiles(root); const clock = new FakeMonotonicTimers(); const pi = new PiMock(); const branch = [{ type: "custom", customType: "mesh-root-binding-v11", data: { schemaVersion: 1, meshId: mesh.meshId } }]; const ctx = { sessionManager: { getSessionId: () => "root-session", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { setStatus() {}, notify() {} }, isIdle: () => true } as never;
    await registerOrchestration(pi as never, { ...files, env: {}, now: () => clock.now, setInterval: clock.setTimeout, clearInterval: clock.clearTimeout, wake: { watch: () => ({ close() {}, on() { return this; }, unref() {} }) } }); await pi.handlers.get("session_start")![0]!({}, ctx);
    const first = await createTaskStore(root, mesh.meshId, worker.agentId, { prompt: "first current-binding completion", purpose: "synthetic purpose" }, { requesterEndpointId: endpointId, completion }); await finishTask(root, mesh.meshId, first.request.taskId, { outcome: "succeeded" });
    assert.equal(pi.messages.length, 0); assert.equal(await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile), undefined);
    const extraAgentId = randomUUID(); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${extraAgentId}`, kind: "agent", agentId: extraAgentId, harness: "pi", sessionId: "extra", sessionFile: join(root, "extra.jsonl") });
    const second = await createTaskStore(root, mesh.meshId, worker.agentId, { prompt: "cadenced completion", purpose: "synthetic purpose" }, { requesterEndpointId: endpointId, completion }); await finishTask(root, mesh.meshId, second.request.taskId, { outcome: "failed" });
    await clock.advance(999); assert.equal(await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile), undefined); assert.equal(pi.messages.length, 0);
    await clock.advance(1); assert.equal((await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile))!.batches.length, 1); assert.equal(pi.messages.length, 0);
    await clock.advance(1000); assert.equal(pi.messages.length, 0); assert.equal((await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile))!.batches.length, 1);
    await clock.advance(5000); assert.equal(pi.messages.length, 1);
    await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Admission: delivery-window state spans durable sources and Pi routing; schemas cannot observe a fixed deadline, source grouping, or whether an unrelated routed event waits behind completions.
// Given completions before and after a fixed boundary plus a report during the first window, the endpoint observes two completion bundles while the report routes before the first deadline.
void test("delivery pump coalesces a fixed completion window without delaying a report", async () => withRoot("mesh-completion-bundle-", async root => {
    const sessionFile = join(root, "root-bundle.jsonl"); await writeFile(sessionFile, "");
    const mesh = await initializeMesh(root, { rootSessionId: "root-bundle", rootSessionFile: sessionFile, recoverable: true, budgets: { ...budgets, maxConcurrentTasks: 8 } });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
    const firstAgent = await publishWorker(root, mesh.meshId, epoch.epochId); const secondAgent = await publishWorker(root, mesh.meshId, epoch.epochId); const pendingAgent = await publishWorker(root, mesh.meshId, epoch.epochId);
    const endpointId = `root:${mesh.meshId}`; const completion = { endpointId, endpointSessionFile: sessionFile };
    const files = await writeRuntimeFiles(root); await writeFile(files.configPath, JSON.stringify({ ...runtimeConfig(root), budgets: { ...budgets, maxConcurrentTasks: 8 } })); const clock = new FakeMonotonicTimers(); const pi = new PiMock(); const branch = [{ type: "custom", customType: "mesh-root-binding-v11", data: { schemaVersion: 1, meshId: mesh.meshId } }];
    const ctx = { sessionManager: { getSessionId: () => "root-bundle", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { setStatus() {}, notify() {} }, isIdle: () => false } as never;
    await registerOrchestration(pi as never, { ...files, env: {}, now: () => clock.now, setInterval: clock.setTimeout, clearInterval: clock.clearTimeout, wake: { watch: () => ({ close() {}, on() { return this; }, unref() {} }) } }); await pi.handlers.get("session_start")![0]!({}, ctx); assert.equal(pi.messages.length, 0);
    const first = await createTaskStore(root, mesh.meshId, firstAgent.agentId, { prompt: "first private prompt", purpose: "synthetic purpose" }, { requesterEndpointId: endpointId, completion }); const second = await createTaskStore(root, mesh.meshId, secondAgent.agentId, { prompt: "second private prompt", purpose: "synthetic purpose" }, { requesterEndpointId: endpointId, completion }); const pending = await createTaskStore(root, mesh.meshId, pendingAgent.agentId, { prompt: "pending private prompt", purpose: "synthetic purpose" }, { requesterEndpointId: endpointId, completion });
    await finishTask(root, mesh.meshId, first.request.taskId, { outcome: "succeeded", output: "private first output" }); await clock.advance(1000);
    await finishTask(root, mesh.meshId, second.request.taskId, { outcome: "failed", error: "private second error" }); await clock.advance(1000);
    const liveEndpoint = await readMeshEndpoint(root, mesh.meshId, endpointId); const pendingSources = (await readEndpointDeliverySnapshot(root, mesh.meshId, liveEndpoint)).events.filter(event => event.kind === "completion"); assert.equal(pendingSources.length, 2); assert.equal(pendingSources.every(event => event.state === "pending"), true);
    const windowChildSession = join(root, "window-child.jsonl"); await writeFile(windowChildSession, "");
    const windowChildEndpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${firstAgent.agentId}`, kind: "agent", agentId: firstAgent.agentId, harness: "pi", sessionId: "window-child", sessionFile: windowChildSession });
    const windowChildTask = await createTaskStore(root, mesh.meshId, firstAgent.agentId, { prompt: "window child work", purpose: "synthetic purpose" }, { requesterEndpointId: endpointId });
    await registerMeshReport(root, mesh.meshId, { callerEndpointId: windowChildEndpoint.endpointId, callerEndpointSessionFile: windowChildEndpoint.sessionFile, toolCallId: "completion-window-report", endpoint: liveEndpoint, agentId: firstAgent.agentId, taskId: windowChildTask.request.taskId, summary: "unblocked", canonicalArguments: { summary: "unblocked" } }); await clock.advance(2000);
    const reportMessages = pi.messages.filter(item => (item.message as any).details?.kind === "report"); assert.equal(reportMessages.length, 1); assert.deepEqual(reportMessages[0]!.options, { deliverAs: "steer", triggerTurn: true }); assert.equal(pi.messages.filter(item => (item.message as any).details?.kind === "completion").length, 0);
    await clock.advance(2999); assert.equal(pi.messages.filter(item => (item.message as any).details?.kind === "completion").length, 0);
    await clock.advance(1);
    let completionMessages = pi.messages.filter(item => (item.message as any).details?.kind === "completion"); assert.equal(completionMessages.length, 1);
    const message = completionMessages[0]!.message as any; assert.equal(message.details.sources.length, 2);
    const restoredDetails = JSON.parse(JSON.stringify(message.details)); for (const agentId of [firstAgent.agentId, secondAgent.agentId, pendingAgent.agentId]) { assert.equal(restoredDetails.identities[agentId].agentId, agentId); assert.equal(restoredDetails.identities[agentId].publicAgent, "worker"); assert.equal(restoredDetails.identities[agentId].access, "read"); assert.equal("role" in restoredDetails.identities[agentId], false); assert.equal("profile" in restoredDetails.identities[agentId], false); }
    const firstDisplay = restoredDetails.display.tasks.find((task: { taskId: string }) => task.taskId === first.request.taskId);
    const secondDisplay = restoredDetails.display.tasks.find((task: { taskId: string }) => task.taskId === second.request.taskId);
    const pendingDisplay = restoredDetails.display.pendingTasks.find((task: { taskId: string }) => task.taskId === pending.request.taskId);
    assert.equal(firstDisplay.toEndpointId, endpointId);
    assert.equal(firstDisplay.purpose, "synthetic purpose");
    assert.equal(firstDisplay.preview, "private first output");
    assert.equal(secondDisplay.preview, "private second error");
    assert.equal(pendingDisplay.purpose, "synthetic purpose");
    assert.equal(pendingDisplay.toEndpointId, endpointId);
    const visible = JSON.parse(message.content) as { tasks: Array<{ taskId: string }>; pendingTasks: Array<{ taskId: string }> };
    assert.deepEqual(visible.tasks.map(task => task.taskId), [first.request.taskId, second.request.taskId]); assert.deepEqual(visible.pendingTasks.map(task => task.taskId), [pending.request.taskId]);
    assert.doesNotMatch(message.content, /prompt|output|error|usage/u); assert.deepEqual(completionMessages[0]!.options, { deliverAs: "steer", triggerTurn: true });
    await finishTask(root, mesh.meshId, pending.request.taskId, { outcome: "succeeded" }); await clock.advance(1000); await clock.advance(4999); assert.equal(pi.messages.filter(item => (item.message as any).details?.kind === "completion").length, 1); await clock.advance(1);
    completionMessages = pi.messages.filter(item => (item.message as any).details?.kind === "completion"); assert.equal(completionMessages.length, 2); assert.equal((completionMessages[1]!.message as any).details.sources.length, 1);
    await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Given direct task completions while the Pi runtime is idle and busy, the completion pump preserves steer delivery and requests a follow-up turn in both states.
void test("completion pump triggers a turn for idle and busy steer delivery", async () => withRoot("mesh-completion-trigger-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const lease = await attachRootMesh(root, mesh.meshId, { rootSessionId: "root", budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
    const receiver = await publishWorker(root, mesh.meshId, epoch.epochId); const peer = await publishWorker(root, mesh.meshId, epoch.epochId); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "completion-session.jsonl"); await writeFile(sessionFile, ""); const endpointId = `agent:${receiver.agentId}`; const completion = { endpointId, endpointSessionFile: sessionFile };
    let idle = true; const ctx = { sessionManager: { getSessionId: () => "completion-session", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => idle } as never; let tick!: () => Promise<void>; const pi = new PiMock();
    await registerOrchestration(pi as never, { ...files, env: { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: receiver.agentId, PI_AGENT_RESOLVED_AGENT: receiver.envelopePath }, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); const rebound = await readAgentRuntimeBinding(root, mesh.meshId, receiver.agentId); const reboundAt = new Date().toISOString(); await publishAgentActivity(root, mesh.meshId, receiver.agentId, { runtimeId: rebound!.runtimeId, phase: "starting", acceptingTask: false, pendingMessages: false, phaseSince: reboundAt, observedAt: reboundAt, heartbeatAt: reboundAt, context: availableContext(10, 100_000, 100) }); await publishAgentActivity(root, mesh.meshId, receiver.agentId, { runtimeId: rebound!.runtimeId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: reboundAt, observedAt: reboundAt, heartbeatAt: reboundAt, context: availableContext(10, 100_000, 100) });
    const requester = { requesterEndpointId: endpointId, requesterAgentId: receiver.agentId, completion }; const first = await createTaskStore(root, mesh.meshId, receiver.agentId, { prompt: "idle completion", purpose: "synthetic purpose" }, requester); const second = await createTaskStore(root, mesh.meshId, peer.agentId, { prompt: "busy completion", purpose: "synthetic purpose" }, requester);
    await finishTask(root, mesh.meshId, first.request.taskId, { outcome: "succeeded", output: "idle done" }); await materializeMeshCompletionEvents(root, mesh.meshId, lease.leaseId); for (let attempt = 0; attempt < 5 && pi.messages.length < 1; attempt += 1) await tick(); assert.deepEqual(pi.messages.at(-1)!.options, { deliverAs: "steer", triggerTurn: true });
    const projected = await pi.handlers.get("context")![0]!({ messages: [(pi.messages[0]!.message as object)] }, ctx) as { messages: unknown[] }; assert.equal(projected.messages.length, 1); const projectedCompletion = projected.messages[0] as { content: string }; const projectedBody = JSON.parse(projectedCompletion.content) as { pendingTasks?: Array<{ taskId: string }>; tasks?: unknown[] }; assert.equal(projectedBody.pendingTasks?.[0]?.taskId, second.request.taskId); const firstEventId = ((pi.messages[0]!.message as any).details.sources[0].eventId as string); assert.equal((JSON.parse(await readFile(join(meshPaths(root, mesh.meshId).events, `${firstEventId}.json`), "utf8")) as { state: string }).state, "acknowledged");
    idle = false; await finishTask(root, mesh.meshId, second.request.taskId, { outcome: "failed", error: "busy done" }); await materializeMeshCompletionEvents(root, mesh.meshId, lease.leaseId); for (let attempt = 0; attempt < 5 && pi.messages.length < 2; attempt += 1) await tick(); assert.deepEqual(pi.messages.at(-1)!.options, { deliverAs: "steer", triggerTurn: true }); assert.equal(pi.messages.length, 2);
    await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" });
}));

// Given an offline endpoint-targeted notice, when a newly bound TUI session starts, the user observes a durable entry and notification without any model-visible message; non-TUI polling leaves later notices pending.
void test("the TUI notice pump validates the live binding and never injects model context", async () => withRoot("mesh-tui-notice-pump-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "notice-session.jsonl"); await writeFile(sessionFile, ""); const endpointId = `agent:${worker.agentId}`;
    await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "agent", agentId: worker.agentId, harness: "pi", sessionId: "offline-session", sessionFile: join(root, "offline.jsonl") }); await setMeshEndpointOffline(root, mesh.meshId, endpointId);
    const first = await createExplicitStopNotice(root, mesh.meshId, { endpointId, requesterEndpointId: `root:${mesh.meshId}`, payload: { stopRequestId: randomUUID(), agentId: randomUUID(), agent: "reviewer", access: "read", source: "peer", reason: "parent-visible stop" } }); assert.ok(first);
    const notifications: string[] = []; const ctx: any = { mode: "tui", sessionManager: { getSessionId: () => "notice-session", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify(text: string) { notifications.push(text); } }, isIdle: () => true };
    let tick!: () => Promise<void>; const pi = new PiMock(); const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: worker.agentId, PI_AGENT_RESOLVED_AGENT: worker.envelopePath }; await registerOrchestration(pi as never, { ...files, env, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx);
    assert.equal(pi.entries.length, 1); assert.equal(pi.entries[0]!.customType, "mesh-tui-notice"); assert.match(notifications.join("\n"), /parent-visible stop/u); assert.deepEqual(pi.messages, []); assert.deepEqual(await listPendingTuiNotices(root, mesh.meshId, { endpointId }), []);
    const renderer = pi.entryRenderers.get("mesh-tui-notice")!; const component = renderer({ data: pi.entries[0]!.data }, { expanded: true }, { fg: (_role: string, text: string) => text }); for (const line of (component as { render(width: number): string[] }).render(24)) assert.ok(visibleWidth(line) <= 24);
    const second = await createExplicitStopNotice(root, mesh.meshId, { endpointId, requesterEndpointId: `root:${mesh.meshId}`, payload: { stopRequestId: randomUUID(), agentId: randomUUID(), agent: "worker", access: "read", source: "peer", reason: "stay pending outside TUI" } }); assert.ok(second); ctx.mode = "rpc"; await tick(); assert.equal((await listPendingTuiNotices(root, mesh.meshId, { endpointId })).length, 1); assert.equal(pi.entries.length, 1); await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "agent", agentId: worker.agentId, harness: "pi", sessionId: "replacement-session", sessionFile: join(root, "replacement.jsonl") }); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" }); assert.equal((await readMeshEndpoint(root, mesh.meshId, endpointId)).online, true);
}));

// Given two orchestration extension generations for the same durable child session, when each session_start crosses runtime binding, the second rotates once and fences callbacks holding the first generation.
void test("same-session reload rotates the Pi runtime once and fences the old generation", async () => withRoot("mesh-runtime-reload-", async root => { const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "same-session.jsonl"); await writeFile(sessionFile, ""); const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: worker.agentId, PI_AGENT_RESOLVED_AGENT: worker.envelopePath }; const ctx = { sessionManager: { getSessionId: () => "same-session", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => true } as never; const firstPi = new PiMock(); await registerOrchestration(firstPi as never, { ...files, env, setInterval() { return "first"; }, clearInterval() {} }); await firstPi.handlers.get("session_start")![0]!({}, ctx); const first = await readAgentRuntimeBinding(root, mesh.meshId, worker.agentId); assert.ok(first); const secondPi = new PiMock(); await registerOrchestration(secondPi as never, { ...files, env, setInterval() { return "second"; }, clearInterval() {} }); await secondPi.handlers.get("session_start")![0]!({}, ctx); const second = await readAgentRuntimeBinding(root, mesh.meshId, worker.agentId); assert.ok(second); assert.notEqual(second.runtimeId, first.runtimeId); const now = new Date().toISOString(); await assert.rejects(publishAgentActivity(root, mesh.meshId, worker.agentId, { runtimeId: first.runtimeId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: now, observedAt: now, heartbeatAt: now, context: availableContext(1, 100, 10) }), /stale or unbound/u); await publishAgentActivity(root, mesh.meshId, worker.agentId, { runtimeId: second.runtimeId, phase: "starting", acceptingTask: false, pendingMessages: false, phaseSince: now, observedAt: now, heartbeatAt: now, context: availableContext(1, 100, 10) }); await Promise.all([firstPi.handlers.get("session_shutdown")![0]!({ reason: "reload" }), secondPi.handlers.get("session_shutdown")![0]!({ reason: "reload" })]); }));

// Given a notice whose UI notification fails, when timer polling retries, the timer remains contained, the notice stays pending, and already-rendered output is not duplicated before recovery acknowledges it.
void test("notice pump contains failures, deduplicates presentation, and retains pending delivery", async () => withRoot("mesh-notice-failure-", async root => { const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const files = await writeRuntimeFiles(root); const sessionFile = join(root, "notice-failure.jsonl"); await writeFile(sessionFile, ""); const endpointId = `agent:${worker.agentId}`; const notice = await createExplicitStopNotice(root, mesh.meshId, { endpointId, requesterEndpointId: `root:${mesh.meshId}`, payload: { stopRequestId: randomUUID(), agentId: randomUUID(), agent: "worker", access: "read", source: "peer", reason: "retry display" } }); assert.ok(notice); let fail = true; const diagnostics: string[] = []; const ctx: any = { mode: "tui", sessionManager: { getSessionId: () => "notice-failure", getSessionFile: () => sessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify(text: string) { if (fail && text.includes("retry display")) throw new Error("notice UI unavailable"); diagnostics.push(text); } }, isIdle: () => true }; let tick!: () => Promise<void>; const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env: { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: worker.agentId, PI_AGENT_RESOLVED_AGENT: worker.envelopePath }, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); await tick(); assert.equal(pi.entries.length, 1); assert.equal((await listPendingTuiNotices(root, mesh.meshId, { endpointId })).length, 1); assert.equal(diagnostics.filter(text => text.includes("notice UI unavailable")).length, 1); fail = false; await tick(); assert.equal(pi.entries.length, 1); assert.deepEqual(await listPendingTuiNotices(root, mesh.meshId, { endpointId }), []); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" }); }));

// Given a root maintenance pass held across shutdown, when reload crosses the lifecycle boundary, shutdown aborts and awaits that pass before cancelling open admissions.
void test("root shutdown quiesces a held maintenance pass before admission cancellation", async () => withRoot("mesh-root-pass-shutdown-", async root => { const sessionFile = join(root, "root-session.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root-session", rootSessionFile: sessionFile, recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const requester = await publishWorker(root, mesh.meshId, epoch.epochId); const requesterRuntime = randomUUID(); await bindAgentRuntime(root, mesh.meshId, requester.agentId, { runtimeId: requesterRuntime, kind: "external" }); await patchAgentStatus(root, mesh.meshId, requester.agentId, { state: "busy" }); const requestId = randomUUID(); await requestPressureAdmission(root, mesh.meshId, { requestId, requesterAgentId: requester.agentId, requesterRuntimeId: requesterRuntime }); const files = await writeRuntimeFiles(root); const branch = [{ type: "custom", customType: "mesh-root-binding-v11", data: { schemaVersion: 1, meshId: mesh.meshId } }]; const ctx = { sessionManager: { getSessionId: () => "root-session", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { notify() {}, setStatus() {} }, isIdle: () => true } as never; let tick!: () => Promise<void>; const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env: {}, setInterval(callback) { tick = async () => { await callback(); }; return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); let unlock!: () => void; let acquired!: () => void; const acquiredPromise = new Promise<void>(resolve => { acquired = resolve; }); const gate = new Promise<void>(resolve => { unlock = resolve; }); const held = withMeshLock(root, mesh.meshId, async () => { acquired(); await gate; }); await acquiredPromise;
    const ticking = tick(); await Promise.resolve(); let shutdownDone = false; const shutdown = Promise.resolve(pi.handlers.get("session_shutdown")![0]!({ reason: "reload" })).finally(() => { shutdownDone = true; }); await Promise.resolve(); assert.equal(shutdownDone, false); unlock(); await Promise.all([held, ticking, shutdown]); assert.equal((await readPressureAdmission(root, mesh.meshId, requestId)).state, "cancelled"); }));

void test("failed pre-publication cleanup retains prepared capacity when process death cannot be confirmed", async () => withRoot("mesh-launch-cleanup-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const files = await writeRuntimeFiles(root); let cleanupInspection = false;
    const exec = async (_command: string, args: string[]) => { if (args.includes("display-message") && args.at(-1)?.includes("#{session_id}")) return { stdout: "10\t$root\tmain\t@root\t%root\tclient\n", stderr: "", code: 0 }; if (args.at(-1) === "#{pid}") return cleanupInspection ? { stdout: "", stderr: "temporary inspection failure", code: 2 } : { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("has-session")) return { stdout: "", stderr: "missing", code: 1 }; if (args.includes("new-session")) return { stdout: "$hub\t@agent\t%agent\n", stderr: "", code: 0 }; if (args.includes("@pi_mesh_schema")) { cleanupInspection = true; return { stdout: "", stderr: "metadata write failed", code: 2 }; } return { stdout: "", stderr: "", code: 0 }; };
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); const deps = { ...files, env: { TMUX: "/tmp/tmux,1,0" }, exec, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) }; const ctx = { cwd: root, sessionManager: { getSessionId: () => "root", getSessionFile: () => sessionFile }, modelRegistry: piTestRegistry() } as never;
    await assert.rejects(createMeshSendTool(deps, { worker: settledAgentDefinition("worker") }).execute("launch", { agent: "worker", access: "read", purpose: "synthetic purpose", message: "work" }, undefined, undefined, ctx), /cleanup.*remains incomplete/iu);
    const paths = meshPaths(root, mesh.meshId); const reservations = await readdir(paths.reservations); const agents = await readdir(paths.agents); assert.equal(reservations.length, 1); assert.equal(agents.length, 1); const reservation = JSON.parse(await readFile(join(paths.reservations, reservations[0]!), "utf8")) as { state: string }; assert.equal(reservation.state, "committed");
}));

// Given a published launch whose bridge never becomes ready, when normal launch cleanup crosses durable stop and tmux termination, callers observe the launch error while recovery state records a confirmed failed lifecycle with that reason.
void test("published launch failure durably confirms a failed agent outcome", async () => withRoot("mesh-published-launch-failure-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const files = await writeRuntimeFiles(root); let clock = -6000;
    const exec = async (_command: string, args: string[]) => { if (args.includes("display-message") && args.at(-1)?.includes("#{session_id}")) return { stdout: "10\t$root\tmain\t@root\t%root\tclient\n", stderr: "", code: 0 }; if (args.at(-1) === "#{pid}") return { stdout: "10\n", stderr: "", code: 0 }; if (args.includes("has-session")) return { stdout: "", stderr: "missing", code: 1 }; if (args.includes("new-session")) return { stdout: "$hub\t@agent\t%agent\n", stderr: "", code: 0 }; return { stdout: "", stderr: "", code: 0 }; };
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile }); const deps = { ...files, env: { TMUX: "/tmp/tmux,1,0" }, exec, now: () => clock += 6000, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) }; const ctx = { cwd: root, sessionManager: { getSessionId: () => "root", getSessionFile: () => sessionFile }, modelRegistry: piTestRegistry() } as never;
    await assert.rejects(createMeshSendTool(deps, { worker: settledAgentDefinition("worker") }).execute("launch", { agent: "worker", access: "read", purpose: "synthetic purpose", message: "work" }, undefined, undefined, ctx), /bridge readiness timed out/iu);
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
    const task = await createTask(root, mesh.meshId, worker.agentId, { prompt: "projection ownership", purpose: "synthetic purpose" }); await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "failed", output: "terminal output", error: "terminal error", usage: { input: 3, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 8, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const files = await writeRuntimeFiles(root); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) };
    const stopped = await createMeshStopTool(deps).execute("stop", { taskId: task.request.taskId }, undefined, undefined, {} as never); const stopText = (stopped.content[0] as { text: string }).text;
    assert.doesNotMatch(stopText, /terminal output|terminal error|usage/u);
    const got = await createMeshGetTool(deps).execute("get", { taskId: task.request.taskId }, undefined, undefined, {} as never); const getText = (got.content[0] as { text: string }).text;
    assert.match(getText, /terminal output/u); assert.match(getText, /terminal error/u); assert.deepEqual((got.details as any).accounting.claimedTaskIds, [task.request.taskId]); assert.equal(got.usage, undefined);
}));

// Admission: schemas and the aggregate serializer cannot prove the retrieval-mode boundary, durable-detail preservation, or usage idempotence.
// Given a UTF-8 terminal result above the compact task budget, omitted mesh_get mode returns a marked JSON-safe compact projection, full returns the complete projection, and only the first retrieval claims usage.
void test("mesh_get compact and full modes preserve durable output and claim usage once", async () => withRoot("mesh-get-output-mode-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile: sessionFile, recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile });
    const output = "🙂".repeat(4500); const error = "界".repeat(2000); const task = await createTask(root, mesh.meshId, worker.agentId, { prompt: "bounded retrieval", purpose: "synthetic purpose" }); await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "failed", output, error, usage: { input: 3, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 8, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const files = await writeRuntimeFiles(root); const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) }; const get = createMeshGetTool(deps);
    const compact = await get.execute("compact", { taskId: task.request.taskId }, undefined, undefined, {} as never); const compactTask = JSON.parse((compact.content[0] as { text: string }).text) as { output: string; error: string; outputTruncated: true; fullOutputAvailable: true };
    assert.equal(compactTask.outputTruncated, true); assert.equal(compactTask.fullOutputAvailable, true); assert.ok(Buffer.byteLength(JSON.stringify({ output: compactTask.output, error: compactTask.error, outputTruncated: true, fullOutputAvailable: true }), "utf8") <= 16 * 1024); assert.doesNotMatch(compactTask.output + compactTask.error, /\uFFFD/u); assert.equal((compact.details as any).task.result.output, output); assert.equal((compact.details as any).task.result.error, error); assert.equal(compact.usage, undefined);
    const full = await get.execute("full", { taskId: task.request.taskId, outputMode: "full" }, undefined, undefined, {} as never); const fullTask = JSON.parse((full.content[0] as { text: string }).text) as { output: string; error: string; outputTruncated?: true; fullOutputAvailable?: true };
    assert.equal(fullTask.output, output); assert.equal(fullTask.error, error); assert.equal(fullTask.outputTruncated, undefined); assert.equal(fullTask.fullOutputAvailable, undefined); assert.equal(full.usage, undefined); assert.deepEqual((full.details as any).accounting.claimedTaskIds, []);
}));

// Given a retained v1-era claim written by a retired tool, reads and startup reconciliation accept it alongside current retrieval-tool claims.
void test("historical usage claim without current schema is not readable as claimed", async () => withRoot("mesh-historical-usage-claim-", async root => {
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const task = await createTask(root, mesh.meshId, worker.agentId, { prompt: "historical claim", purpose: "synthetic purpose" }); await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "done" });
    await writeFile(taskPaths(root, mesh.meshId, task.request.taskId).usageClaim, JSON.stringify({ schemaVersion: 1, meshId: mesh.meshId, claimantSessionFile: sessionFile, toolCallId: "retained-call", toolName: "mesh_wait", agentId: worker.agentId, taskId: task.request.taskId, claimedAt: new Date().toISOString() }));
    await assert.rejects(readTask(root, mesh.meshId, task.request.taskId), /usage claim/u);
}));

void test("persisted root startup reconciles an unpersisted usage claim before tools can observe it", async () => withRoot("mesh-root-usage-reconcile-", async root => {
    const sessionFile = join(root, "root-session.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root-session", rootSessionFile: sessionFile, recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const task = await createTask(root, mesh.meshId, worker.agentId, { prompt: "account once", purpose: "synthetic purpose" }); await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "done" }); assert.equal((await claimTaskUsage(root, mesh.meshId, task.request.taskId, sessionFile, { source: "tool", toolCallId: "lost-call", toolName: "mesh_get" })).created, true);
    const files = await writeRuntimeFiles(root); const keybindings = await writeMeshKeybindings(root); const previous = process.env.PI_EXTENSION_KEYBINDINGS_PATH; process.env.PI_EXTENSION_KEYBINDINGS_PATH = keybindings; const branch = [{ type: "custom", customType: "mesh-root-binding-v11", data: { schemaVersion: 1, meshId: mesh.meshId } }]; const ctx = { sessionManager: { getSessionId: () => "root-session", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { notify() {}, setStatus() {} }, isIdle: () => true } as never;
    try { const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env: {} }); assert.equal(pi.messageRenderers.has("mesh-event"), true); await pi.handlers.get("session_start")![0]!({}, ctx); assert.equal((await claimTaskUsage(root, mesh.meshId, task.request.taskId, sessionFile, { source: "tool", toolCallId: "recovered-call", toolName: "mesh_get" })).created, true); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" }); }
    finally { if (previous === undefined) delete process.env.PI_EXTENSION_KEYBINDINGS_PATH; else process.env.PI_EXTENSION_KEYBINDINGS_PATH = previous; }
}));

// Given a receipt owned by a predecessor endpoint binding, root startup rotates the binding and leaves predecessor completion state ineligible rather than adopting it.
void test("persisted root startup fences predecessor completion receipts and tasks", async () => withRoot("mesh-root-receipt-reconcile-", async root => {
    const sessionFile = join(root, "root-session.jsonl"); await writeFile(sessionFile, ""); const mesh = await initializeMesh(root, { rootSessionId: "root-session", rootSessionFile: sessionFile, recoverable: true, budgets }); const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } }); const worker = await publishWorker(root, mesh.meshId, epoch.epochId); const endpointId = `root:${mesh.meshId}`; const predecessor = await bindMeshEndpoint(root, mesh.meshId, { endpointId, kind: "root", harness: "pi", sessionId: "root-session", sessionFile }); const completion = { endpointId, endpointSessionFile: sessionFile }; const task = await createTaskStore(root, mesh.meshId, worker.agentId, { prompt: "orphan receipt", purpose: "synthetic purpose" }, { requesterEndpointId: endpointId, completion }); await finishTask(root, mesh.meshId, task.request.taskId, { outcome: "succeeded", output: "visible after repair" }); await createCompletionReceipt(root, mesh.meshId, { endpointId, endpointSessionFile: sessionFile, claimantSessionFile: sessionFile, toolCallId: "lost-result", toolName: "mesh_get", canonicalArguments: { taskId: task.request.taskId }, taskIds: [task.request.taskId], maxTasksPerMesh: budgets.maxTasksPerMesh });
    const files = await writeRuntimeFiles(root); const keybindings = await writeMeshKeybindings(root); const previous = process.env.PI_EXTENSION_KEYBINDINGS_PATH; process.env.PI_EXTENSION_KEYBINDINGS_PATH = keybindings; const branch = [{ type: "custom", customType: "mesh-root-binding-v11", data: { schemaVersion: 1, meshId: mesh.meshId } }]; const ctx = { sessionManager: { getSessionId: () => "root-session", getSessionFile: () => sessionFile, getBranch: () => branch }, ui: { notify() {}, setStatus() {} }, isIdle: () => true } as never;
    try { const pi = new PiMock(); await registerOrchestration(pi as never, { ...files, env: {}, setInterval() { return "timer"; }, clearInterval() {} }); await pi.handlers.get("session_start")![0]!({}, ctx); assert.equal(await readCompletionLedger(root, mesh.meshId, endpointId, sessionFile), undefined); assert.equal(pi.messages.length, 0); const predecessorLedger = JSON.parse(await readFile(completionLedgerPath(root, mesh.meshId, endpointId, sessionFile, predecessor.bindingId), "utf8")) as { receipts: unknown[] }; assert.equal(predecessorLedger.receipts.length, 1); assert.equal((await readTask(root, mesh.meshId, task.request.taskId)).request.completion?.bindingId, predecessor.bindingId); await pi.handlers.get("session_shutdown")![0]!({ reason: "reload" }); }
    finally { if (previous === undefined) delete process.env.PI_EXTENSION_KEYBINDINGS_PATH; else process.env.PI_EXTENSION_KEYBINDINGS_PATH = previous; }
}));

void test("native child launch manifests order popup, orchestration, role contributions, and bridge", () => {
    const catalog = settledAgentCatalog();
    const meshId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const agentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const epochId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const roleSet = ["reviewer"];
    const manifest = ["/popup.ts", "/orchestration.ts", AGENT_ARTIFACT_EXTENSION, "/bridge.ts"];
    const config = runtimeConfig("/state");
    const settledManifest = buildChildExtensionManifest(config, catalog.children.reviewer!.contextPolicy, catalog.children.reviewer!.childExtensionContributions);
    assert.deepEqual(settledManifest, manifest);
    const providerManifest = buildChildExtensionManifest(config, catalog.children.reviewer!.contextPolicy, ["/provider.ts"]);
    assert.deepEqual(providerManifest, ["/popup.ts", "/orchestration.ts", "/provider.ts", "/bridge.ts"]);
    const promptOnlyManifest = buildChildExtensionManifest(config, "prompt-only", ["/provider.ts", "/orchestration.ts", "/popup.ts", "/bridge.ts"]);
    assert.deepEqual(promptOnlyManifest, ["/orchestration.ts", "/provider.ts", "/bridge.ts"]);
    const envelope: AgentLaunchEnvelope = buildLaunchEnvelope({ meshId, agentId, epochId, agent: "reviewer", mode: "ops", roleSet, catalog, childExtensions: { reviewer: manifest } });
    const launchFor = (tools: string[]) => piLaunchDescriptor(config, { meshId, agentId, agentDirectory: `/state/meshes/${meshId}/agents/${agentId}`, childId: "reviewer", taskPath: "/task", launchEnvelope: "/envelope.json", epochSnapshot: { ...envelope, self: { ...envelope.self, tools } } });
    const launch = launchFor([]);
    assert.deepEqual(launch.args.filter((value, index) => launch.args[index - 1] === "-e"), manifest);
    assert.equal(launch.args.includes("--no-extensions"), true);
    assert.equal(launch.args.some(value => value.endsWith("/mode.ts") || value === "mode.ts"), false);
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
        const launch = piLaunchDescriptor(runtimeConfig("/state"), { meshId, agentId, agentDirectory: `/state/meshes/${meshId}/agents/${agentId}`, childId: agent, taskPath: "/task", launchEnvelope: "/envelope.json", epochSnapshot: envelope });
        return launch.args.filter((value, index) => launch.args[index - 1] === "-e");
    };

    assert.deepEqual(launchExtensions("reviewer"), childExtensions.reviewer);
    assert.deepEqual(launchExtensions("worker"), childExtensions.worker);
});

// Admission: TypeBox schemas cannot observe the final Pi argv, and the previous basename filter dropped every added prompt-only provider before launch.
// Given a prompt-only envelope carrying a provider-equivalent contribution, when it crosses the native launch-descriptor boundary, Pi observes that path alongside the orchestration bridges with isolation flags intact.
void test("native launch preserves prompt-only contributions through the launch descriptor", () => {
    const meshId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const agentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const epochId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const roleSet = ["prompt-only"];
    const childExtensions = { "prompt-only": ["/orchestration.ts", "/provider.ts", "/bridge.ts"] };
    const config = runtimeConfig("/state");
    const built = buildChildExtensionManifest(config, "prompt-only", ["/provider.ts"]);
    assert.deepEqual(built, childExtensions["prompt-only"]);
    const envelope = buildLaunchEnvelope({ meshId, agentId, epochId, agent: "prompt-only", mode: "ops", roleSet, catalog, childExtensions });
    const launch = piLaunchDescriptor(config, { meshId, agentId, agentDirectory: `/state/meshes/${meshId}/agents/${agentId}`, childId: "prompt-only", taskPath: "/task", launchEnvelope: "/envelope.json", epochSnapshot: envelope });
    assert.equal(launch.args.includes("--no-extensions"), true);
    assert.deepEqual(launch.args.filter((value, index) => launch.args[index - 1] === "-e"), childExtensions["prompt-only"]);
    for (const flag of ["--no-context-files", "--no-skills", "--no-prompt-templates", "--no-tools"]) assert.equal(launch.args.includes(flag), true, flag);
    assert.equal(launch.args.includes("--tools"), false);
});

// Admission: configuration validation proves mapping coverage at startup, but not that dispatch resolves the selected mapping before consuming capacity.
// Given a selected Cursor profile whose mapping is absent, mesh_send rejects before persisting any reservation, agent, or task.
void test("Cursor mapping resolution rejects before capacity reservation", async () => withRoot("mesh-cursor-mapping-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const localCatalog: ChildCatalog = { schemaVersion: 1, children: { worker: { ...settledAgentDefinition("worker"), execution: cursorExecution } } };
    const localPolicy: CallPolicy = { modes: { ops: { targets: ["worker"] } } };
    const epoch = await ensurePolicyEpochStore(root, mesh.meshId, { mode: "ops", catalog: localCatalog, callPolicy: localPolicy });
    const files = await writeRuntimeFiles(root); const rawConfig = JSON.parse(await readFile(files.configPath, "utf8")) as OrchestrationConfig; rawConfig.harnesses["cursor-agent"]!.modelIds = {}; await writeFile(files.configPath, JSON.stringify(rawConfig));
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, ""); await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile });
    const deps = { ...files, env: {}, exec: absentTmux, activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) };
    const ctx = { cwd: root, sessionManager: { getSessionId: () => "root", getSessionFile: () => sessionFile } } as never;
    await assert.rejects(createMeshSendTool(deps, localCatalog.children).execute("missing-model-id", { agent: "worker", access: "read", purpose: "synthetic purpose", message: "work" }, undefined, undefined, ctx), /mapping is unavailable/u);
    const paths = meshPaths(root, mesh.meshId); assert.deepEqual(await readdir(paths.reservations), []); assert.deepEqual(await readdir(paths.agents), []); assert.deepEqual(await readdir(paths.tasks), []);
}));

// Admitted contract: given complete Pi candidate preflight exhaustion, mesh_send fails before creating durable agent or task state and releases the reservation.
void test("Pi launch preflight exhaustion fails mesh_send without durable agent or task state", async () => withRoot("mesh-preflight-exhaustion-", async root => {
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: true, budgets });
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, { mode: "ops", roleSet: ["worker"], roles: { worker: settledAgentDefinition("worker") } });
    const files = await writeRuntimeFiles(root);
    const sessionFile = join(root, "root.jsonl"); await writeFile(sessionFile, "");
    await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile });
    const deps = { ...files, env: { TMUX: "/tmp/tmux,1,0" }, exec: liveTmuxExec(), activeCaller: () => caller(mesh.meshId, epoch, { identity: "mode:ops", sessionFile }) };
    const ctx = { cwd: root, sessionManager: { getSessionId: () => "root", getSessionFile: () => sessionFile }, modelRegistry: piTestRegistry([]) } as never;
    await assert.rejects(createMeshSendTool(deps, { worker: settledAgentDefinition("worker") }).execute("launch", { agent: "worker", access: "read", purpose: "synthetic purpose", message: "work" }, undefined, undefined, ctx), /route_exhausted/u);
    const paths = meshPaths(root, mesh.meshId);
    assert.deepEqual(await readdir(paths.agents), []);
    assert.deepEqual(await readdir(paths.tasks), []);
    const reservations = await readdir(paths.reservations);
    assert.equal(reservations.length, 1);
    const reservation = JSON.parse(await readFile(join(paths.reservations, reservations[0]!), "utf8")) as { state: string };
    assert.equal(reservation.state, "released");
}));

function capabilityRole(agent: string, access: "read" | "write" = "read", extras: Partial<ChildDefinition> = {}): ChildDefinition {
    return { selector: { agent, access }, description: `Synthetic ${agent}`, tools: extras.tools ?? ["read"], instructions: extras.instructions ?? `Perform ${agent}.`, contextPolicy: extras.contextPolicy ?? (agent === "perspective" ? "prompt-only" : "project"), childExtensionContributions: extras.childExtensionContributions ?? [], execution: extras.execution ?? piExecution, targets: extras.targets ?? [], gc: extras.gc ?? childGc };
}

// Admission: schema and execute must share one selector resolver; accepting an internal role name, unauthorized write, or root search would launch the wrong immutable edge.
// Given recon-shaped public selectors, mesh_send accepts only those pairs, rejects internal names and write/search, and research-only search remains available to that caller.
void test("mesh_send publishes public selectors and rejects unauthorized write, search, and internal names", async () => {
    const roles: Record<string, ChildDefinition> = {
        "small-read": capabilityRole("small", "read"),
        "small-write": capabilityRole("small", "write"),
        "standard-read": capabilityRole("standard", "read"),
        "advanced-read": capabilityRole("advanced", "read"),
        research: capabilityRole("research"),
        perspective: capabilityRole("perspective", "read", { tools: [], contextPolicy: "prompt-only" }),
        search: capabilityRole("search", "read", { tools: [] }),
    };
    const inactive = () => undefined;
    const deps = { configPath: "/missing", env: {}, exec: absentTmux, activeCaller: inactive } as OrchestrationDependencies;
    const recon = createMeshSendTool(deps, {
        "small-read": roles["small-read"]!,
        "standard-read": roles["standard-read"]!,
        "advanced-read": roles["advanced-read"]!,
        research: roles.research!,
        perspective: roles.perspective!,
    });
    assert.equal(Value.Check(recon.parameters, { agent: "small", access: "read", purpose: "synthetic purpose", message: "inspect" }), true);
    assert.equal(Value.Check(recon.parameters, { agent: "research", access: "read", purpose: "synthetic purpose", message: "sources" }), true);
    assert.equal(Value.Check(recon.parameters, { agent: "perspective", access: "read", purpose: "synthetic purpose", message: "reframe" }), true);
    assert.equal(Value.Check(recon.parameters, { agent: "small-read", access: "read", purpose: "synthetic purpose", message: "internal role" }), false);
    assert.equal(Value.Check(recon.parameters, { agent: "small", access: "write", purpose: "synthetic purpose", message: "upgrade" }), false);
    assert.equal(Value.Check(recon.parameters, { agent: "search", access: "read", purpose: "synthetic purpose", message: "web" }), false);
    assert.equal(Value.Check(recon.parameters, { agent: "small", message: "missing access" }), false);
    const advanced = createMeshSendTool(deps, { "small-read": roles["small-read"]!, "standard-read": roles["standard-read"]!, research: roles.research!, perspective: roles.perspective! });
    assert.equal(Value.Check(advanced.parameters, { agent: "small", access: "write", purpose: "synthetic purpose", message: "child write" }), false);
    const research = createMeshSendTool(deps, { search: roles.search! });
    assert.equal(Value.Check(research.parameters, { agent: "search", access: "read", purpose: "synthetic purpose", message: "web" }), true);
    assert.equal(Value.Check(research.parameters, { agent: "search", message: "web" }), false);
});
