import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerOrchestration, createMeshSendTool, type ActiveCaller } from "../extensions_src/orchestration.ts";
import { registerMeshChildBridge, type MeshChildBridgeDependencies } from "../extensions_src/orchestration_child_bridge.ts";
import { buildLaunchEnvelope } from "../extensions_src/utilities/agent_types.ts";
import { bindMeshEndpoint, materializeMeshCompletionEvents } from "../extensions_src/utilities/orchestration_events.ts";
import { FALLBACK_CONTINUE_CUSTOM_TYPE, formatFallbackContinueContent } from "../extensions_src/utilities/orchestration_profile_fallback.ts";
import { EXECUTION_RESUME_CONTENT, EXECUTION_RESUME_CUSTOM_TYPE } from "../extensions_src/utilities/orchestration_execution.ts";
import { FakeMonotonicTimers, yieldToIO } from "./test_helpers.ts";
import { availableContext, publishAgentActivity, readAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { bindAgentRuntime } from "../extensions_src/utilities/orchestration_runtime.ts";
import { attachRootMesh, applyAgentControl, claimPendingTask, createTask, ensurePolicyEpoch, failAgent as persistAgentFailure, finishTask as persistTaskCompletion, initializeMesh, markAgentStopping, patchAgentStatus, prepareAgent, publishAgent, readAgentExecution, readAgentSnapshot, readTask, requestTaskCancellation, reserveMeshCapacity, taskPaths } from "../extensions_src/utilities/orchestration_store.ts";
import { formatUsualIdentityLine, MESH_CHILD_IDENTITY_STATUS, NATURE_HANDLE_WORDS } from "../extensions_src/utilities/orchestration_identity.ts";

const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };
const tmux = { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "main", windowId: "@1", paneId: "%1", windowName: "worker" };
const syntheticGc = { collectAt: 2, retain: 1, pressureFloor: 0 };
const syntheticExecution = { models: ["provider/model"], thinkingLevel: "medium" as const, harness: "pi" as const };
const syntheticChild = (name = "worker", extra: { contextPolicy?: "project" | "prompt-only"; execution?: typeof syntheticExecution; targets?: string[] } = {}) => ({ selector: { agent: name, access: "read" as const }, description: `Synthetic ${name}`, tools: [], instructions: "Return the bounded result.", contextPolicy: extra.contextPolicy ?? "project" as const, childExtensionContributions: [] as string[], execution: extra.execution ?? syntheticExecution, targets: extra.targets ?? [], gc: syntheticGc });
const syntheticCatalog = (children: Record<string, ReturnType<typeof syntheticChild>>) => ({ schemaVersion: 1 as const, children });
const budgets = { maxLiveAgents: 4, maxConcurrentTasks: 4, maxTasksPerMesh: 20 };

function reverseKeyInsertionOrder(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reverseKeyInsertionOrder);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([key, item]) => [key, reverseKeyInsertionOrder(item)]));
    return value;
}

async function bridgeFixture(options: { publish?: boolean; contextPolicy?: "project" | "prompt-only"; dependencies?: MeshChildBridgeDependencies; profile?: { models: string[]; thinkingLevel: "medium"; harness: "pi" }; registry?: { find(provider: string, modelId: string): { provider: string; id: string; contextWindow: number } | undefined }; currentModel?: { provider: string; id: string; contextWindow: number }; setModel?: (model: { provider: string; id: string }) => Promise<boolean> } = {}) {
    const execution = options.profile ?? syntheticExecution;
    const root = await mkdtemp(join(tmpdir(), "orchestration-bridge-"));
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: false, budgets });
    const worker = syntheticChild("worker", { contextPolicy: options.contextPolicy, execution });
    const children = { worker };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, {
        mode: "ops",
        catalog: syntheticCatalog(children),
        callPolicy: { modes: { ops: { targets: ["worker"] } } },
    });
    const reservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task");
    const agentId = randomUUID();
    const envelope = buildLaunchEnvelope({ meshId: mesh.meshId, agentId, epochId: epoch.epochId, childId: "worker", snapshot: epoch, childExtensions: { worker: ["/popup", "/orchestration", "/bridge"] } });
    const prepared = await prepareAgent(root, mesh.meshId, { reservationId: reservation.reservationId, agentId, childId: "worker", harness: "pi", cwd: "/work", definitionSnapshot: worker, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { creatorSessionId: "parent" }, capabilities });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(envelope));
    const publish = () => publishAgent(root, mesh.meshId, prepared.paths, { agentId, epochId: epoch.epochId, childId: "worker", harness: "pi", cwd: "/work", definitionSnapshot: worker, launchEnvelope: envelopePath, creatorSessionId: "parent", tmux, capabilities });
    if (options.publish !== false) await publish();

    const handlers = new Map<string, (...args: any[]) => any>();
    const eventHandlers: Array<(value: unknown) => void> = [];
    let intervalCallback: (() => void | Promise<void>) | undefined;
    let shutdowns = 0;
    let aborts = 0;
    let idle = true;
    let pendingMessages = false;
    let usageTokens = 99;
    const delivered: string[] = [];
    const sent: Array<{ message: any; options: any }> = [];
    const selected: string[] = [];
    const identityStatus: string[] = [];
    const pi = {
        on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); },
        events: { on(_name: string, handler: (value: unknown) => void) { eventHandlers.push(handler); return () => {}; } },
        sendUserMessage(prompt: string) { delivered.push(prompt); },
        sendMessage(message: unknown, options: unknown) { sent.push({ message, options }); },
        async setModel(model: { provider: string; id: string }) { selected.push(`${model.provider}/${model.id}`); return options.setModel ? options.setModel(model) : true; },
        setThinkingLevel() {},
    } as unknown as ExtensionAPI;
    registerMeshChildBridge(pi, { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: agentId, PI_MESH_AGENT_DIR: prepared.paths.directory, PI_MESH_EPOCH_ID: epoch.epochId, PI_AGENT_RESOLVED_AGENT: envelopePath }, {
        wake: { watch: () => ({ close() {}, on() { return this; }, unref() {} }) }, cadenceSetTimeout(callback) { intervalCallback = callback; return 1; }, cadenceClearTimeout() {}, resolveCompactionReserveTokens: () => 68, contextHeadroomTokens: 32, standaloneRuntimeBinding: true, idleClaimIntervalMs: 0, natureHandleWords: NATURE_HANDLE_WORDS, ...options.dependencies,
    });
    const activate = (value: unknown = envelope) => { for (const handler of eventHandlers) handler({ schemaVersion: 1, identity: envelope.identity, envelope: value }); };
    const start = () => handlers.get("session_start")?.({}, { cwd: "/work", model: options.currentModel, sessionManager: { getSessionId: () => "child", getSessionFile: () => join(root, "child.jsonl") }, getContextUsage: () => ({ tokens: usageTokens, contextWindow: 200, percent: 49.5 }), isIdle: () => idle, hasPendingMessages: () => pendingMessages, modelRegistry: options.registry, ui: { setStatus(id: string, text?: string) { if (id === MESH_CHILD_IDENTITY_STATUS && typeof text === "string") identityStatus.push(text); }, notify() {} }, abort() { aborts += 1; }, shutdown() { shutdowns += 1; } });
    const tick = async () => { await intervalCallback?.(); };
    const emit = async (name: string, event: unknown = {}) => { await handlers.get(name)?.(event, {}); };
    return { root, meshId: mesh.meshId, envelope, envelopePath, prepared, agentId, activate, start, tick, emit, publish, delivered, sent, selected, identityStatus, setUsageTokens(value: number) { usageTokens = value; }, setIdle(value: boolean) { idle = value; }, setPendingMessages(value: boolean) { pendingMessages = value; }, get shutdowns() { return shutdowns; }, get aborts() { return aborts; } };
}

// Admission: orchestration owns the awaited child wait while the bridge alone owns task completion; isolated wait and bridge tests cannot detect early parent-task settlement across their shared Pi lifecycle.
// Given a child with an active parent task and delegated grandchild work, when its registered orchestration waits at agent_end and a parent intervention plus terminal completion cross the live endpoints, the parent observes the same active task until one final bridge settlement.
void test("child orchestration wait preserves the active parent task through intervention and grandchild completion", async () => {
    const root = await mkdtemp(join(tmpdir(), "orchestration-bridge-wait-"));
    const rootSessionFile = join(root, "root.jsonl"); const childSessionFile = join(root, "child.jsonl"); const grandchildSessionFile = join(root, "grandchild.jsonl");
    await writeFile(rootSessionFile, ""); await writeFile(childSessionFile, ""); await writeFile(grandchildSessionFile, "");
    const mesh = await initializeMesh(root, { rootSessionId: "root", rootSessionFile, recoverable: true, budgets });
    const lease = await attachRootMesh(root, mesh.meshId, { rootSessionId: "root", rootSessionFile, budgets });
    const worker = syntheticChild("worker", { targets: ["grandchild"] }); const grandchildRole = syntheticChild("grandchild");
    const children = { worker, grandchild: grandchildRole };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, {
        mode: "ops",
        catalog: syntheticCatalog(children),
        callPolicy: { modes: { ops: { targets: ["worker"] } } },
    });
    const publishChild = async (role: "worker" | "grandchild", parentAgentId?: string) => {
        const definition = children[role]; const reservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task"); const agentId = randomUUID();
        const envelope = buildLaunchEnvelope({ meshId: mesh.meshId, agentId, epochId: epoch.epochId, childId: role, snapshot: epoch, childExtensions: { worker: ["/orchestration", "/bridge"], grandchild: ["/orchestration", "/bridge"] } });
        const prepared = await prepareAgent(root, mesh.meshId, { reservationId: reservation.reservationId, agentId, childId: role, harness: "pi", cwd: root, definitionSnapshot: definition, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { ...(parentAgentId ? { parentAgentId } : {}), creatorSessionId: "root" }, capabilities });
        const envelopePath = join(prepared.paths.directory, "launch-envelope.json"); await writeFile(envelopePath, JSON.stringify(envelope));
        await publishAgent(root, mesh.meshId, prepared.paths, { agentId, epochId: epoch.epochId, childId: role, harness: "pi", cwd: root, definitionSnapshot: definition, launchEnvelope: envelopePath, creatorSessionId: "root", ...(parentAgentId ? { parentAgentId } : {}), tmux, capabilities });
        return { agentId, envelope, envelopePath, directory: prepared.paths.directory };
    };
    const child = await publishChild("worker"); const grandchild = await publishChild("grandchild", child.agentId); const grandchildRuntimeId = randomUUID(); const grandchildObservedAt = new Date().toISOString();
    await bindAgentRuntime(root, mesh.meshId, grandchild.agentId, { runtimeId: grandchildRuntimeId, kind: "pi", sessionId: "grandchild", sessionFile: grandchildSessionFile });
    await publishAgentActivity(root, mesh.meshId, grandchild.agentId, { runtimeId: grandchildRuntimeId, phase: "starting", acceptingTask: false, pendingMessages: false, phaseSince: grandchildObservedAt, observedAt: grandchildObservedAt, heartbeatAt: grandchildObservedAt, context: availableContext(10, 100_000, 68, 32) });
    await patchAgentStatus(root, mesh.meshId, grandchild.agentId, { state: "idle", bridgeReady: true });
    await publishAgentActivity(root, mesh.meshId, grandchild.agentId, { runtimeId: grandchildRuntimeId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: grandchildObservedAt, observedAt: grandchildObservedAt, heartbeatAt: grandchildObservedAt, context: availableContext(10, 100_000, 68, 32) });
    await bindMeshEndpoint(root, mesh.meshId, { endpointId: `agent:${grandchild.agentId}`, kind: "agent", agentId: grandchild.agentId, harness: "pi", sessionId: "grandchild", sessionFile: grandchildSessionFile });
    const rootEndpoint = await bindMeshEndpoint(root, mesh.meshId, { endpointId: `root:${mesh.meshId}`, kind: "root", harness: "pi", sessionId: "root", sessionFile: rootSessionFile });
    let parentTask!: Awaited<ReturnType<typeof createTask>>;
    const configPath = join(root, "orchestration.json"); const catalogPath = join(root, "catalog.json"); const modePath = join(root, "modes.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: 6, stateRoot: root, tmux: "/tmux", returnParentCommand: "/parent", parentNavigationHint: "parent", historyViewerExtension: "/history", popupExtension: "/popup", orchestrationExtension: "/orchestration", childBridgeExtension: "/bridge", harnesses: { pi: { adapter: "pi-native", command: "/pi" } }, natureHandleWords: ["May"], callPolicy: { modes: { ops: { targets: ["worker"] } } }, budgets, gc: { contextHeadroomTokens: 32, periodicIntervalMs: 5000, activityHeartbeatMs: 2000, activityStaleMs: 10000 } }));
    await writeFile(catalogPath, JSON.stringify(syntheticCatalog(children))); await writeFile(modePath, JSON.stringify({ schemaVersion: 4, defaultMode: "ops", execution: syntheticExecution, modes: { ops: { description: "ops", tools: [], skillOptIns: [], instructions: "Use ops." } } }));

    class IntegratedPi {
        readonly tools = new Map<string, any>(); readonly handlers = new Map<string, Array<(...args: any[]) => unknown>>(); readonly eventHandlers = new Map<string, Array<(value: unknown) => unknown>>();
        readonly messages: Array<{ message: any; options: any }> = []; readonly delivered: string[] = []; active: string[] = [];
        readonly events = { on: (name: string, handler: (value: unknown) => unknown) => { const list = this.eventHandlers.get(name) ?? []; list.push(handler); this.eventHandlers.set(name, list); return () => {}; }, emit: (name: string, value: unknown) => { for (const handler of this.eventHandlers.get(name) ?? []) handler(value); return true; } };
        registerTool(tool: any) { this.tools.set(tool.name, tool); if (!this.active.includes(tool.name)) this.active.push(tool.name); } getAllTools() { return [...this.tools.values()]; } getActiveTools() { return [...this.active]; } setActiveTools(names: string[]) { this.active = [...names]; }
        on(name: string, handler: (...args: any[]) => unknown) { const list = this.handlers.get(name) ?? []; list.push(handler); this.handlers.set(name, list); } registerCommand() {} registerEntryRenderer() {} registerMessageRenderer() {} appendEntry() {}
        sendUserMessage(prompt: string) { this.delivered.push(prompt); } sendMessage(message: any, options: any) { this.messages.push({ message, options }); } async setModel() { return true; } setThinkingLevel() {}
        exec = async () => ({ stdout: "", stderr: "", code: 1 });
    }
    const clock = new FakeMonotonicTimers(); clock.now = Date.now(); let finishes = 0; const pi = new IntegratedPi(); const signal = new AbortController();
    const ctx = { cwd: root, sessionManager: { getSessionId: () => "child", getSessionFile: () => childSessionFile, getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, isIdle: () => false, hasPendingMessages: () => false, signal: signal.signal, getContextUsage: () => ({ tokens: 10, contextWindow: 100_000, percent: 0.01 }), modelRegistry: { find: () => ({ provider: "provider", id: "model", contextWindow: 100_000 }) }, shutdown() {}, abort() {} } as never;
    const env = { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: child.agentId, PI_MESH_AGENT_DIR: child.directory, PI_MESH_EPOCH_ID: epoch.epochId, PI_AGENT_RESOLVED_AGENT: child.envelopePath };
    await registerOrchestration(pi as never, { configPath, catalogPath, modePath, env, now: () => clock.now, setInterval: clock.setTimeout, clearInterval: clock.clearTimeout, wake: { watch: () => ({ close() {}, on() { return this; }, unref() {} }) } });
    registerMeshChildBridge(pi as never, env, { now: () => clock.now, resolveCompactionReserveTokens: () => 68, cadenceSetTimeout: clock.setTimeout, cadenceClearTimeout: clock.clearTimeout, wake: { watch: () => ({ close() {}, on() { return this; }, unref() {} }) }, finishTask: async (...args) => { if (args[2] === parentTask.request.taskId) finishes += 1; return persistTaskCompletion(...args); } });
    const invoke = async (name: string, event: unknown = {}) => { for (const handler of pi.handlers.get(name) ?? []) await handler(event, ctx); };
    const consume = async () => { const messages = pi.messages.splice(0).map(item => item.message); await invoke("context", { messages }); return messages; };
    await invoke("session_start");
    const readyChild = await readAgentSnapshot(root, mesh.meshId, child.agentId); assert.equal(readyChild.status.state, "idle", readyChild.status.exitReason);
    parentTask = await createTask(root, mesh.meshId, child.agentId, { prompt: "coordinate grandchild", purpose: "synthetic purpose" }, { requesterEndpointId: rootEndpoint.endpointId, completion: { endpointId: rootEndpoint.endpointId, endpointSessionFile: rootEndpoint.sessionFile, bindingId: rootEndpoint.bindingId } });
    await clock.advance(3_000);
    assert.deepEqual(pi.delivered, ["coordinate grandchild"]); await invoke("before_agent_start", { prompt: "coordinate grandchild" }); await invoke("agent_start");
    const delegated = await pi.tools.get("mesh_send")!.execute("delegate-grandchild", { agentId: grandchild.agentId, purpose: "inspect dependency", message: "inspect dependency" }, undefined, undefined, ctx); const grandchildTaskId = JSON.parse(delegated.content[0].text).taskId as string;
    await invoke("message_end", { message: { role: "assistant", content: [{ type: "text", text: "waiting" }], stopReason: "stop" } });
    let firstEndResolved = false; const firstEnd = invoke("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] }).then(() => { firstEndResolved = true; }); await yieldToIO();
    assert.equal(firstEndResolved, false); assert.equal(finishes, 0); assert.equal((await readAgentSnapshot(root, mesh.meshId, child.agentId)).status.activeTaskId, parentTask.request.taskId);
    const parentCaller: ActiveCaller = { identity: "mode:ops", meshId: mesh.meshId, epoch, catalog: syntheticCatalog(children), endpointId: rootEndpoint.endpointId, sessionFile: rootSessionFile };
    const intervention = await createMeshSendTool({ configPath, catalogPath, modePath, env: {}, exec: pi.exec, activeCaller: () => parentCaller }, { worker }).execute("parent-intervention", { agentId: child.agentId, message: "include the urgent constraint" }, undefined, undefined, ctx);
    assert.equal((intervention.details as any).disposition, "intervened"); assert.equal((intervention.details as any).taskId, parentTask.request.taskId);
    await clock.advance(2_000); await firstEnd; assert.equal(finishes, 0); const interventionMessages = await consume(); assert.equal((interventionMessages[0] as any).details.payload.taskId, parentTask.request.taskId);
    await invoke("message_end", { message: { role: "assistant", content: [{ type: "text", text: "still waiting" }], stopReason: "stop" } });
    let secondEndResolved = false; const secondEnd = invoke("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] }).then(() => { secondEndResolved = true; }); await yieldToIO(); assert.equal(secondEndResolved, false); assert.equal(finishes, 0);
    await persistTaskCompletion(root, mesh.meshId, grandchildTaskId, { outcome: "succeeded", output: "dependency result" }); await materializeMeshCompletionEvents(root, mesh.meshId, lease.leaseId); await clock.advance(6_000); await secondEnd; assert.equal(finishes, 0);
    const completionMessages = await consume(); assert.equal((completionMessages[0] as any).details.kind, "completion");
    await invoke("message_end", { message: { role: "assistant", content: [{ type: "text", text: "final result" }], stopReason: "stop" } }); await invoke("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
    assert.equal(finishes, 0); await invoke("agent_settled"); assert.equal(finishes, 1);
    const completed = await readAgentSnapshot(root, mesh.meshId, child.agentId, parentTask.request.taskId); assert.equal(completed.task?.result?.outcome, "succeeded"); assert.equal(completed.task?.result?.output, "final result");
    await invoke("session_shutdown", { reason: "reload" });
});

void test("child readiness accepts the activated immutable epoch snapshot independent of JSON key order", async () => {
    const fixture = await bridgeFixture();
    const reordered = reverseKeyInsertionOrder(fixture.envelope);
    assert.notEqual(JSON.stringify(reordered), JSON.stringify(fixture.envelope));
    fixture.activate(reordered);
    await fixture.start();
    const ready = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId);
    assert.equal(ready.status.bridgeReady, true);
    assert.equal(ready.status.state, "idle");
});

// Admission: prompt-only child startup is repository-owned, failure prevents the role from running, and existing launch/runtime tests do not exercise bridge readiness for this policy.
// Given a prompt-only launch envelope, when the child bridge starts, the mesh caller observes a ready idle child without the bridge taking ownership of runtime tool policy.
void test("prompt-only child bridge reaches readiness under launch-owned isolation", async () => {
    const fixture = await bridgeFixture({ contextPolicy: "prompt-only" });
    fixture.activate();
    await fixture.start();
    const ready = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId);
    assert.equal(ready.status.bridgeReady, true);
    assert.equal(ready.status.state, "idle");
});

void test("Pi lifecycle events publish running, compaction health, and settled activity", async () => {
    const fixture = await bridgeFixture({ dependencies: { resolveCompactionReserveTokens: () => 68, contextHeadroomTokens: 32 } });
    fixture.activate(); await fixture.start();
    const ready = await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId);
    assert.deepEqual({ phase: ready?.phase, health: ready?.context.health, until: ready?.context.tokensUntilCompaction }, { phase: "idle", health: "healthy", until: 33 });
    await fixture.emit("agent_start");
    assert.equal((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, "running");
    const controller = new AbortController(); await fixture.emit("session_before_compact", { reason: "threshold", signal: controller.signal });
    assert.deepEqual({ phase: (await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, reason: (await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.compactionReason }, { phase: "compacting", reason: "threshold" });
    await fixture.emit("agent_settled");
    assert.equal((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, "idle");
    const manual = new AbortController(); await fixture.emit("session_before_compact", { reason: "manual", signal: manual.signal }); await fixture.emit("session_compact", { reason: "manual", willRetry: false }); assert.equal((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, "compacting"); await fixture.emit("agent_settled"); assert.equal((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, "idle");
});

// Given a completed manual idle compaction, when a later tick observes Pi idle with no queued work, the mesh consumer sees the child become idle without requiring agent_settled.
void test("manual idle compaction settles on a later quiescent observation", async () => {
    const fixture = await bridgeFixture(); fixture.activate(); await fixture.start();
    const manual = new AbortController(); await fixture.emit("session_before_compact", { reason: "manual", signal: manual.signal }); await fixture.emit("session_compact", { reason: "manual", willRetry: false });
    assert.equal((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, "compacting");
    fixture.setIdle(false); await fixture.tick(); assert.equal((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, "compacting");
    fixture.setIdle(true); fixture.setPendingMessages(true); await fixture.tick(); assert.equal((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, "compacting");
    fixture.setPendingMessages(false); await fixture.tick(); assert.equal((await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId))?.phase, "idle");
});

// Admission: claimed-task ownership across recursive child polling and shutdown is a durable lifecycle contract that types and persistence validation cannot observe.
// Given a real task claimed while shutdown awaits the in-flight pass plus a captured stale callback, reload fails the owned task without prompt delivery, timeout resurrection, or post-unbind polling.
void test("Pi child shutdown fences in-flight and stale cadence callbacks", async () => {
    const clock = new FakeMonotonicTimers(); clock.now = Date.now();
    let claims = 0; let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const inFlight = new Promise<void>(resolve => { entered = resolve; });
    const fixture = await bridgeFixture({ dependencies: {
        now: () => clock.now,
        idleClaimIntervalMs: 3000,
        cadenceSetTimeout: clock.setTimeout,
        cadenceClearTimeout: clock.clearTimeout,
        claimPendingTask: async (...args) => { claims += 1; if (claims === 2) { entered(); await gate; } return claimPendingTask(...args); },
    } });
    fixture.activate(); await fixture.start();
    assert.equal(claims, 1);
    const task = await createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "claim during shutdown", purpose: "synthetic purpose" }, `root:${fixture.meshId}`);
    const stale = clock.captureNextCallback()!;
    const advancing = clock.advance(3000); await inFlight;
    const shutdown = fixture.emit("session_shutdown", { reason: "reload" }); await yieldToIO();
    release(); await Promise.all([advancing, shutdown]);
    const settled = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId);
    assert.deepEqual(fixture.delivered, []);
    assert.equal(settled.task?.status.state, "failed");
    assert.equal(settled.task?.result?.outcome, "failed");
    assert.match(settled.task?.result?.error ?? "", /replaced \(reload\) during the task/u);
    assert.equal(clock.pendingCount, 0);
    await stale(); await clock.advance(10_000);
    assert.equal(claims, 2);
    assert.equal(clock.pendingCount, 0);
});

// Given a durable root stop, when child shutdown crosses the bridge boundary, lifecycle remains stopping for root tmux confirmation.
void test("Pi bridge never terminalizes a root-managed stopping agent", async () => { const fixture = await bridgeFixture(); fixture.activate(); await fixture.start(); await markAgentStopping(fixture.root, fixture.meshId, fixture.agentId); await fixture.emit("session_shutdown", { reason: "quit" }); assert.equal((await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId)).status.state, "stopping"); });

void test("Pi settings resolution failure preserves readiness with unknown context health", async () => {
    const fixture = await bridgeFixture({ dependencies: { resolveCompactionReserveTokens: () => { throw new Error("settings unavailable"); } } });
    fixture.activate(); await fixture.start();
    const activity = await readAgentActivity(fixture.root, fixture.meshId, fixture.agentId);
    assert.deepEqual({ bridgeReady: (await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId)).status.bridgeReady, context: activity?.context.state, health: activity?.context.health }, { bridgeReady: true, context: "unknown", health: "unknown" });
});

void test("child readiness rejects a different activated epoch snapshot and bounds publication waiting", async () => {
    const mismatch = await bridgeFixture();
    const changed = structuredClone(mismatch.envelope);
    changed.childExtensions.worker![0] = "/changed-popup";
    mismatch.activate(changed);
    await mismatch.start();
    const failed = JSON.parse(await readFile(mismatch.prepared.paths.status, "utf8")) as { bridgeReady: boolean; state: string };
    assert.equal(failed.bridgeReady, false);
    assert.equal(failed.state, "failed");
    assert.equal(mismatch.shutdowns, 1);

    let now = 0;
    const timedOut = await bridgeFixture({ publish: false, dependencies: { publicationTimeoutMs: 2, publicationRetryMs: 1, now: () => now, sleep: async (milliseconds: number) => { now += milliseconds; } } });
    timedOut.activate();
    await timedOut.start();
    const timeoutStatus = JSON.parse(await readFile(timedOut.prepared.paths.status, "utf8")) as { bridgeReady: boolean; state: string; exitReason: string };
    assert.equal(timeoutStatus.bridgeReady, false);
    assert.equal(timeoutStatus.state, "failed");
    assert.match(timeoutStatus.exitReason, /mesh agent publication/u);
    assert.equal(timedOut.shutdowns, 1);
});

void test("child initialization failure requests shutdown even when failure persistence is unavailable", async () => {
    const fixture = await bridgeFixture({ dependencies: {
        recordChildSessionIdentity: async () => { throw new Error("mesh store unavailable"); },
        failAgent: async () => { throw new Error("mesh store still unavailable"); },
    } });
    fixture.activate();
    await fixture.start();
    assert.equal(fixture.shutdowns, 1);
});

void test("stalled completion persistence shuts down the settled child after a bounded window", async () => {
    let now = Date.now(); let expire!: () => void; let timerScheduled!: () => void; const scheduled = new Promise<void>(resolve => { timerScheduled = resolve; });
    const fixture = await bridgeFixture({ dependencies: {
        completionPersistenceTimeoutMs: 2,
        now: () => now,
        finishTask: () => new Promise<never>(() => {}),
        setTimeout(callback) { expire = callback; timerScheduled(); return 1; },
        clearTimeout() {},
    } });
    fixture.activate();
    await fixture.start();
    await createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "complete before store failure", purpose: "synthetic purpose" }, `root:${fixture.meshId}`);
    await fixture.tick();
    await fixture.emit("before_agent_start", { prompt: "complete before store failure" });
    await fixture.emit("agent_start");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" } });
    const settling = fixture.emit("agent_settled");
    await scheduled; assert.equal(fixture.shutdowns, 0);
    now += 2; expire(); await settling;
    assert.equal(fixture.shutdowns, 1);
    await fixture.emit("session_shutdown", { reason: "quit" });
});

// Given a healthy task-inbox watcher, a child observes newly indexed work after debounce without waiting for the three-second correctness fallback, and shutdown closes the watcher.
void test("Pi child task-inbox wake immediately runs the idempotent claim pass and closes", async () => {
    const clock = new FakeMonotonicTimers(); clock.now = Date.now(); let changed: ((event: string, filename: string | Buffer | null) => void) | undefined; let closed = 0;
    const fixture = await bridgeFixture({ dependencies: { now: () => clock.now, idleClaimIntervalMs: 3000, cadenceSetTimeout: clock.setTimeout, cadenceClearTimeout: clock.clearTimeout, wake: { watch: (_path, _options, listener) => { changed = listener; return { close() { closed += 1; }, on() { return this; }, unref() {} }; }, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout } } });
    fixture.activate(); await fixture.start(); await createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "wake task", purpose: "synthetic purpose" }, `root:${fixture.meshId}`); changed!("change", "task.json"); await clock.advance(10); assert.deepEqual(fixture.delivered, ["wake task"]); await fixture.emit("session_shutdown", { reason: "reload" }); assert.equal(closed, 1); assert.equal(clock.pendingCount, 0);
});

// Admission: child claim cadence is repository-owned state behavior; types cannot distinguish an idle full-store claim from an active cancellation probe.
// Given an idle child and then an active task, cadence crossings defer full pickup for three seconds while retaining a 100 ms active cancellation deadline.
void test("Pi child separates idle task claims from active cancellation cadence", async () => {
    const clock = new FakeMonotonicTimers(); clock.now = Date.now();
    const fixture = await bridgeFixture({ dependencies: { now: () => clock.now, idleClaimIntervalMs: 3000, cadenceSetTimeout: clock.setTimeout, cadenceClearTimeout: clock.clearTimeout } });
    fixture.activate(); await fixture.start();
    const task = await createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "cadenced task", purpose: "synthetic purpose" }, `root:${fixture.meshId}`);
    await clock.advance(2999); assert.deepEqual(fixture.delivered, []);
    await clock.advance(1); assert.deepEqual(fixture.delivered, ["cadenced task"]); assert.equal(clock.nextDelay(), 100);
    await requestTaskCancellation(fixture.root, fixture.meshId, task.request.taskId, "cadence cancellation");
    await clock.advance(99); assert.equal((await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId)).task?.status.state, "running");
    await clock.advance(1); assert.equal((await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId)).task?.status.state, "stopped");
});

void test("Pi child tasks preserve completion, cancellation, and failure outcomes", async () => {
    const fixture = await bridgeFixture();
    fixture.activate();
    await fixture.start();

    const complete = await createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "complete", purpose: "synthetic purpose" }, `root:${fixture.meshId}`);
    await fixture.tick();
    assert.deepEqual(fixture.delivered, ["complete"]);
    await fixture.emit("before_agent_start", { prompt: "complete" });
    await fixture.emit("agent_start");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", usage: { input: 2, output: 3, totalTokens: 5 } } });
    await fixture.emit("agent_settled");
    const completed = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, complete.request.taskId);
    assert.equal(completed.task?.result?.outcome, "succeeded");
    assert.equal(completed.task?.result?.output, "done");

    const cancel = await createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "cancel", purpose: "synthetic purpose" }, `root:${fixture.meshId}`);
    await fixture.tick();
    await requestTaskCancellation(fixture.root, fixture.meshId, cancel.request.taskId, "caller cancelled");
    await fixture.tick();
    const cancelled = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, cancel.request.taskId);
    assert.equal(cancelled.task?.result?.outcome, "stopped");

    const fail = await createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "fail", purpose: "synthetic purpose" }, `root:${fixture.meshId}`);
    await fixture.tick();
    await fixture.emit("before_agent_start", { prompt: "fail" });
    await fixture.emit("agent_start");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "model failed", usage: { input: 1, output: 1, totalTokens: 2 } } });
    await fixture.emit("agent_settled");
    const failedTask = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, fail.request.taskId);
    assert.equal(failedTask.task?.result?.outcome, "failed");
    assert.match(failedTask.task?.result?.error ?? "", /fallback exhausted/u);
    assert.doesNotMatch(failedTask.task?.result?.error ?? "", /model failed/u);
    assert.equal(failedTask.status.state, "failed");
});

// Admission: Pi child usual status is the live identity a user reads in the child terminal; session_start-only projection leaves reused purpose/state as the first task, and types cannot observe setStatus.
// Given two successive tasks on a live Pi child, when claim and settlement cross the existing bridge hooks, the status consumer observes the current purpose and textual agent state.
void test("Pi child usual status refreshes purpose and textual state across task reuse", async () => {
    const fixture = await bridgeFixture();
    fixture.activate();
    await fixture.start();
    const idle = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId);
    assert.equal(fixture.identityStatus.at(-1), formatUsualIdentityLine(idle, NATURE_HANDLE_WORDS));
    assert.match(fixture.identityStatus.at(-1) ?? "", /Idle/u);
    assert.doesNotMatch(fixture.identityStatus.at(-1) ?? "", /first purpose|second purpose/u);

    const first = await createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "first", purpose: "first purpose" }, `root:${fixture.meshId}`);
    await fixture.tick();
    const runningFirst = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, first.request.taskId);
    assert.equal(fixture.identityStatus.at(-1), formatUsualIdentityLine(runningFirst, NATURE_HANDLE_WORDS));
    assert.match(fixture.identityStatus.at(-1) ?? "", /first purpose/u);
    assert.match(fixture.identityStatus.at(-1) ?? "", /Running/u);
    await fixture.emit("before_agent_start", { prompt: "first" });
    await fixture.emit("agent_start");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "first done" }], stopReason: "stop" } });
    await fixture.emit("agent_settled");
    const idleFirst = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId);
    assert.equal(fixture.identityStatus.at(-1), formatUsualIdentityLine(idleFirst, NATURE_HANDLE_WORDS));
    assert.match(fixture.identityStatus.at(-1) ?? "", /first purpose/u);
    assert.match(fixture.identityStatus.at(-1) ?? "", /Idle/u);

    const second = await createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "second", purpose: "second purpose" }, `root:${fixture.meshId}`);
    await fixture.tick();
    const runningSecond = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, second.request.taskId);
    assert.equal(fixture.identityStatus.at(-1), formatUsualIdentityLine(runningSecond, NATURE_HANDLE_WORDS));
    assert.match(fixture.identityStatus.at(-1) ?? "", /second purpose/u);
    assert.doesNotMatch(fixture.identityStatus.at(-1) ?? "", /first purpose/u);
    assert.match(fixture.identityStatus.at(-1) ?? "", /Running/u);
    await fixture.emit("before_agent_start", { prompt: "second" });
    await fixture.emit("agent_start");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "second done" }], stopReason: "stop" } });
    await fixture.emit("agent_settled");
    const idleSecond = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId);
    assert.equal(fixture.identityStatus.at(-1), formatUsualIdentityLine(idleSecond, NATURE_HANDLE_WORDS));
    assert.match(fixture.identityStatus.at(-1) ?? "", /second purpose/u);
    assert.doesNotMatch(fixture.identityStatus.at(-1) ?? "", /first purpose/u);
    assert.match(fixture.identityStatus.at(-1) ?? "", /Idle/u);
    await fixture.emit("session_shutdown", { reason: "reload" });
});

void test("idle child turns aggregate both assistant and mesh tool-result usage", async () => {
    const fixture = await bridgeFixture();
    fixture.activate();
    await fixture.start();
    await fixture.emit("message_end", { message: { role: "assistant", content: [], usage: { input: 1, output: 2, totalTokens: 3 } } });
    await fixture.emit("message_end", { message: { role: "toolResult", toolName: "mesh_get", usage: { input: 4, output: 1, totalTokens: 5 } } });
    const snapshot = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId);
    assert.equal(snapshot.status.agentUsage.totalTokens, 8);
    assert.equal(snapshot.status.agentUsage.input, 5);
    assert.equal(snapshot.status.agentUsage.output, 3);
});

function registryWindows(windows: Record<string, number>) {
    return {
        find(provider: string, id: string) {
            const contextWindow = windows[`${provider}/${id}`];
            return contextWindow === undefined ? undefined : { provider, id, contextWindow };
        },
    };
}

async function claimAndStart(fixture: Awaited<ReturnType<typeof bridgeFixture>>, prompt: string) {
    const task = await createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt, purpose: "synthetic purpose" }, `root:${fixture.meshId}`);
    await fixture.tick();
    await fixture.emit("before_agent_start", { prompt });
    await fixture.emit("agent_start");
    return task;
}

// Admitted contract: given a child reload with a persisted later route while Pi runs primary, startup restores or advances only from that route; exhausted restoration fails the child rather than moving backward.
void test("child reload preserves sticky forward routing or fails closed", async () => {
    const profile = { models: ["provider/primary", "provider/fallback", "provider/last"], thinkingLevel: "medium" as const, harness: "pi" as const };
    for (const outcome of ["restored", "missing-promotes", "rejected-promotes", "exhausted"] as const) {
        const fixture = await bridgeFixture({
            profile,
            currentModel: { provider: "provider", id: "primary", contextWindow: 200 },
            registry: registryWindows(outcome === "missing-promotes" ? { "provider/primary": 200, "provider/last": 200 } : { "provider/primary": 200, "provider/fallback": 200, "provider/last": 200 }),
            setModel: async model => outcome === "restored" || (outcome !== "exhausted" && model.id === "last"),
        });
        await patchAgentStatus(fixture.root, fixture.meshId, fixture.agentId, { modelRoute: { activeIndex: 1, activeModel: "provider/fallback", attempts: [] } });
        fixture.activate(); await fixture.start();
        const snapshot = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId);
        if (outcome === "restored") {
            assert.equal(snapshot.status.modelRoute?.activeIndex, 1);
            assert.deepEqual(fixture.selected, ["provider/fallback"]);
            continue;
        }
        if (outcome === "exhausted") {
            assert.equal(snapshot.status.state, "failed");
            assert.equal(fixture.shutdowns, 1);
            assert.notEqual(snapshot.status.modelRoute?.activeIndex, 0);
            assert.deepEqual(fixture.selected, ["provider/fallback", "provider/last"]);
            continue;
        }
        assert.equal(snapshot.status.modelRoute?.activeIndex, 2, outcome);
        assert.notEqual(snapshot.status.modelRoute?.activeIndex, 0, outcome);
        assert.equal(snapshot.status.modelRoute?.attempts[0]?.index, 1, outcome);
        assert.deepEqual(fixture.selected, outcome === "missing-promotes" ? ["provider/last"] : ["provider/fallback", "provider/last"], outcome);
    }
});

// Admitted contract: given a persisted child route behind Pi's current candidate, reload reconciles the route forward and never selects the earlier persisted model.
void test("child reload never moves the current model backward", async () => {
    const profile = { models: ["provider/primary", "provider/fallback", "provider/last"], thinkingLevel: "medium" as const, harness: "pi" as const };
    const fixture = await bridgeFixture({
        profile,
        currentModel: { provider: "provider", id: "last", contextWindow: 200 },
        registry: registryWindows({ "provider/primary": 200, "provider/fallback": 200, "provider/last": 200 }),
    });
    await patchAgentStatus(fixture.root, fixture.meshId, fixture.agentId, { modelRoute: { activeIndex: 1, activeModel: "provider/fallback", attempts: [] } });
    fixture.activate(); await fixture.start();
    const snapshot = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId);
    assert.equal(snapshot.status.modelRoute?.activeIndex, 2);
    assert.equal(snapshot.status.modelRoute?.activeModel, "provider/last");
    assert.deepEqual(fixture.selected, ["provider/last"]);
    assert.ok(!fixture.selected.includes("provider/fallback"));
});

// Admitted contract: given an active task whose final model call settles with error, when a later candidate succeeds, the caller observes one successful logical task with cumulative accounting, sticky reuse, and no intermediate completion.
void test("error settlement continues the same child task on a later candidate without intermediate completion", async () => {
    const profile = { models: ["provider/primary", "provider/fallback"], thinkingLevel: "medium" as const, harness: "pi" as const };
    const fixture = await bridgeFixture({ profile, registry: registryWindows({ "provider/primary": 200, "provider/fallback": 200 }) });
    fixture.activate();
    await fixture.start();
    const task = await claimAndStart(fixture, "continue once");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "primary failed", usage: { input: 2, output: 2, totalTokens: 4 } } });
    await fixture.emit("agent_settled");
    const mid = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId);
    assert.equal(mid.task?.status.state, "running");
    assert.equal(mid.status.state, "busy");
    assert.equal(fixture.sent.length, 1);
    assert.equal(fixture.sent[0]?.message.customType, FALLBACK_CONTINUE_CUSTOM_TYPE);
    assert.equal(fixture.sent[0]?.message.content, formatFallbackContinueContent("continue once"));
    assert.match(fixture.sent[0]?.message.content ?? "", /Active task:\ncontinue once$/u);
    assert.equal(fixture.sent[0]?.message.display, false);
    assert.deepEqual(fixture.sent[0]?.options, { triggerTurn: true });
    assert.doesNotMatch(fixture.sent[0]?.message.content, /provider\/|primary|fallback/u);
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", usage: { input: 3, output: 5, totalTokens: 8 } } });
    await fixture.emit("agent_settled");
    const completed = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId);
    assert.equal(completed.task?.result?.outcome, "succeeded");
    assert.equal(completed.task?.result?.output, "done");
    assert.equal(completed.task?.result?.turns, 2);
    assert.equal(completed.task?.result?.usage.totalTokens, 12);
    assert.equal(completed.status.modelRoute?.activeIndex, 1);
    const next = await claimAndStart(fixture, "sticky reuse");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "again" }], stopReason: "stop", usage: { input: 1, output: 1, totalTokens: 2 } } });
    await fixture.emit("agent_settled");
    const reused = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, next.request.taskId);
    assert.equal(reused.task?.result?.outcome, "succeeded");
    assert.equal(fixture.sent.length, 1);
    assert.equal(reused.status.modelRoute?.activeIndex, 1);
});

// Admitted contract: given a tool-result error in the settling turn, the child completes the task without promoting, while a restored model selection does not suspend a later provider-error fallback.
void test("tool-result errors suppress child fallback and restore selections remain eligible", async () => {
    const profile = { models: ["provider/primary", "provider/fallback"], thinkingLevel: "medium" as const, harness: "pi" as const };
    const fixture = await bridgeFixture({ profile, registry: registryWindows({ "provider/primary": 200, "provider/fallback": 200 }) });
    fixture.activate(); await fixture.start();
    const toolFailure = await claimAndStart(fixture, "tool failure");
    await fixture.emit("message_end", { message: { role: "toolResult", toolName: "read", isError: true } });
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "tool failed" }], stopReason: "error", errorMessage: "tool failed" } });
    await fixture.emit("agent_settled");
    const failed = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, toolFailure.request.taskId);
    assert.equal(fixture.sent.length, 0);
    assert.equal(failed.task?.result?.outcome, "failed");
    assert.deepEqual(fixture.selected, []);

    const restored = await claimAndStart(fixture, "restored route");
    await fixture.emit("model_select", { model: { provider: "provider", id: "primary" }, source: "restore" });
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "primary failed" }], stopReason: "error" } });
    await fixture.emit("agent_settled");
    assert.deepEqual(fixture.selected, ["provider/fallback"]);
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" } });
    await fixture.emit("agent_settled");
    assert.equal((await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, restored.request.taskId)).task?.result?.outcome, "succeeded");
});

// Admitted contract: given cancellation or shutdown while a child promotion awaits Pi or status persistence, the caller observes a stopped task and no fallback continuation.
void test("cancellation and shutdown fence in-progress child promotions", async () => {
    const profile = { models: ["provider/primary", "provider/fallback"], thinkingLevel: "medium" as const, harness: "pi" as const };
    for (const race of ["setModel", "status", "shutdown"] as const) {
        let release!: () => void;
        let entered!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const blocked = new Promise<void>(resolve => { entered = resolve; });
        const fixture = await bridgeFixture({
            profile,
            registry: registryWindows({ "provider/primary": 200, "provider/fallback": 200 }),
            setModel: async () => { if (race === "setModel" || race === "shutdown") { entered(); await gate; } return true; },
            dependencies: race === "status" ? { patchAgentStatus: async (...args) => { if ((args[3].modelRoute as { activeIndex?: number } | undefined)?.activeIndex === 1) { entered(); await gate; } return patchAgentStatus(...args); } } : undefined,
        });
        fixture.activate(); await fixture.start();
        const task = await claimAndStart(fixture, `promotion ${race}`);
        await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "primary failed" } });
        const settling = fixture.emit("agent_settled");
        await blocked;
        const shutdown = race === "shutdown" ? fixture.emit("session_shutdown", { reason: "quit" }) : undefined;
        if (race !== "shutdown") await requestTaskCancellation(fixture.root, fixture.meshId, task.request.taskId, `cancel during ${race}`);
        release();
        await settling;
        await shutdown;
        const stopped = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId);
        assert.equal(stopped.task?.result?.outcome, "stopped", race);
        assert.equal(fixture.sent.length, 0, race);
    }
});

// Admission: route persistence after a successful setModel is a repository-owned child lifecycle; types cannot observe an escaped settlement that leaves the task busy.
// Given a successful promotion setModel, when subsequent route status persistence rejects, the mesh caller observes a failed task with preserved output/usage, no continuation, and an agent that cannot accept another task.
void test("route persistence rejection fails the active task without continuation or reuse", async () => {
    const profile = { models: ["provider/primary", "provider/fallback"], thinkingLevel: "medium" as const, harness: "pi" as const };
    const fixture = await bridgeFixture({
        profile,
        registry: registryWindows({ "provider/primary": 200, "provider/fallback": 200 }),
        dependencies: {
            patchAgentStatus: async (...args) => {
                if ((args[3].modelRoute as { activeIndex?: number } | undefined)?.activeIndex === 1) throw new Error("route persist rejected");
                return patchAgentStatus(...args);
            },
        },
    });
    fixture.activate(); await fixture.start();
    const task = await claimAndStart(fixture, "persist reject");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "primary failed", usage: { input: 1, output: 1, totalTokens: 2 } } });
    await fixture.emit("agent_settled");
    const failed = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId);
    assert.equal(fixture.sent.length, 0);
    assert.equal(failed.task?.result?.outcome, "failed");
    assert.match(failed.task?.result?.error ?? "", /route_persistence_failed/u);
    assert.equal(failed.task?.result?.output, "partial");
    assert.equal(failed.task?.result?.usage.totalTokens, 2);
    assert.equal(failed.status.state, "failed");
    assert.equal(failed.status.activeTaskId, undefined);
    await assert.rejects(createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "must not accept", purpose: "synthetic purpose" }, `root:${fixture.meshId}`), /not accepting|failed|idle/iu);
});

// Admission: cancellation lookup failure after route persistence rejection is a repository-owned exception boundary; types cannot observe an escaped settlement that leaves durable work busy.
// Given rejected route persistence followed by unavailable cancellation state, the bridge queues failed completion and retirement so the caller observes terminal task and agent state without continuation.
void test("route persistence rejection terminalizes when cancellation lookup also rejects", async () => {
    const profile = { models: ["provider/primary", "provider/fallback"], thinkingLevel: "medium" as const, harness: "pi" as const };
    const fixture = await bridgeFixture({
        profile,
        registry: registryWindows({ "provider/primary": 200, "provider/fallback": 200 }),
        dependencies: {
            patchAgentStatus: async (...args) => {
                if ((args[3].modelRoute as { activeIndex?: number } | undefined)?.activeIndex === 1) throw new Error("route persist rejected");
                return patchAgentStatus(...args);
            },
            readTaskCancellation: async () => { throw new Error("cancellation state unavailable"); },
        },
    });
    fixture.activate(); await fixture.start();
    const task = await claimAndStart(fixture, "persist and cancellation lookup reject");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "primary failed" } });
    await fixture.emit("agent_settled");
    const failed = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId);
    assert.equal(fixture.sent.length, 0);
    assert.equal(failed.task?.result?.outcome, "failed");
    assert.match(failed.task?.result?.error ?? "", /route_persistence_failed/u);
    assert.equal(failed.status.state, "failed");
    assert.equal(failed.status.activeTaskId, undefined);
});

// Admission: cancellation versus route-persist rejection is a distinct consumer result from failed retirement; the existing blocked-success race does not observe a throwing persist.
// Given cancellation requested while promoted-route persistence rejects, the mesh caller observes a stopped task and stopped agent, no fallback continuation, and no further task acceptance.
void test("cancellation takes precedence over route persistence rejection", async () => {
    const profile = { models: ["provider/primary", "provider/fallback"], thinkingLevel: "medium" as const, harness: "pi" as const };
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const blocked = new Promise<void>(resolve => { entered = resolve; });
    const fixture = await bridgeFixture({
        profile,
        registry: registryWindows({ "provider/primary": 200, "provider/fallback": 200 }),
        dependencies: {
            patchAgentStatus: async (...args) => {
                if ((args[3].modelRoute as { activeIndex?: number } | undefined)?.activeIndex === 1) { entered(); await gate; throw new Error("route persist rejected"); }
                return patchAgentStatus(...args);
            },
        },
    });
    fixture.activate(); await fixture.start();
    const task = await claimAndStart(fixture, "cancel persist reject");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "primary failed", usage: { input: 1, output: 1, totalTokens: 2 } } });
    const settling = fixture.emit("agent_settled");
    await blocked;
    await requestTaskCancellation(fixture.root, fixture.meshId, task.request.taskId, "cancel during persist reject");
    release();
    await settling;
    const stopped = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId);
    assert.equal(stopped.task?.result?.outcome, "stopped");
    assert.equal(stopped.task?.result?.output, "partial");
    assert.equal(stopped.task?.result?.usage.totalTokens, 2);
    assert.equal(fixture.sent.length, 0);
    assert.equal(stopped.status.state, "stopped");
    assert.equal(stopped.status.activeTaskId, undefined);
    await assert.rejects(createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "must not reuse stopped agent", purpose: "synthetic purpose" }, `root:${fixture.meshId}`), /not accepting|stopped|idle/iu);
});

// Admission: cancellation can become durable after retirement is queued; a captured pre-finish disposition cannot safely determine the terminal agent state.
// Given cancellation requested after failed retirement is queued but before finishTask resolves, the durable stopped result makes the bridge retire the agent as stopped rather than failed.
void test("durable completion outcome determines queued promotion retirement", async () => {
    const profile = { models: ["provider/primary", "provider/fallback"], thinkingLevel: "medium" as const, harness: "pi" as const };
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const blocked = new Promise<void>(resolve => { entered = resolve; });
    const fixture = await bridgeFixture({
        profile,
        registry: registryWindows({ "provider/primary": 200, "provider/fallback": 200 }),
        dependencies: {
            patchAgentStatus: async (...args) => {
                if ((args[3].modelRoute as { activeIndex?: number } | undefined)?.activeIndex === 1) throw new Error("route persist rejected");
                return patchAgentStatus(...args);
            },
            finishTask: async (...args) => { entered(); await gate; return persistTaskCompletion(...args); },
        },
    });
    fixture.activate(); await fixture.start();
    const task = await claimAndStart(fixture, "late cancellation");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "primary failed" } });
    const settling = fixture.emit("agent_settled");
    await blocked;
    await requestTaskCancellation(fixture.root, fixture.meshId, task.request.taskId, "cancel after retirement queued");
    release();
    await settling;
    const stopped = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId);
    assert.equal(stopped.task?.result?.outcome, "stopped");
    assert.equal(stopped.status.state, "stopped");
    assert.equal(stopped.status.activeTaskId, undefined);
    assert.equal(fixture.sent.length, 0);
    await assert.rejects(createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "must not reuse late-stopped agent", purpose: "synthetic purpose" }, `root:${fixture.meshId}`), /not accepting|stopped|idle/iu);
});

// Admission: finishTask-to-failAgent is a repository-owned child lifecycle; types cannot observe swallowed retirement that republishes idle and pumps new work.
// Given route-persistence failure whose task completion writes and whose failAgent then rejects, when settlement crosses the child bridge, the mesh caller observes shutdown without a continuation or a further pumped task, and cannot submit another task.
void test("failAgent rejection after route-persistence completion shuts down without pumping", async () => {
    const profile = { models: ["provider/primary", "provider/fallback"], thinkingLevel: "medium" as const, harness: "pi" as const };
    let now = Date.now();
    const fixture = await bridgeFixture({
        profile,
        registry: registryWindows({ "provider/primary": 200, "provider/fallback": 200 }),
        dependencies: {
            completionPersistenceTimeoutMs: 2,
            now: () => now,
            setTimeout() { return 1; },
            clearTimeout() {},
            patchAgentStatus: async (...args) => {
                if ((args[3].modelRoute as { activeIndex?: number } | undefined)?.activeIndex === 1) throw new Error("route persist rejected");
                return patchAgentStatus(...args);
            },
            failAgent: async () => { now += 2; throw new Error("retirement rejected"); },
        },
    });
    fixture.activate(); await fixture.start();
    const task = await claimAndStart(fixture, "retire reject");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "primary failed", usage: { input: 1, output: 1, totalTokens: 2 } } });
    await fixture.emit("agent_settled");
    const snapshot = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId);
    assert.equal(fixture.sent.length, 0);
    assert.equal(fixture.shutdowns, 1);
    assert.deepEqual(fixture.delivered, ["retire reject"]);
    assert.equal(snapshot.task?.result?.outcome, "failed");
    assert.match(snapshot.task?.result?.error ?? "", /route_persistence_failed/u);
    assert.equal(snapshot.task?.result?.output, "partial");
    assert.equal(snapshot.task?.result?.usage.totalTokens, 2);
    assert.equal(snapshot.activity.acceptingTask, false);
    assert.notEqual(snapshot.status.state, "busy");
    await assert.rejects(createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "must not pump", purpose: "synthetic purpose" }, `root:${fixture.meshId}`), /not accepting|failed|runtime|idle/iu);
    await fixture.tick();
    assert.deepEqual(fixture.delivered, ["retire reject"]);
    assert.equal(fixture.sent.length, 0);
    await fixture.emit("session_shutdown", { reason: "quit" });
    await assert.rejects(createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "must not reuse", purpose: "synthetic purpose" }, `root:${fixture.meshId}`), /not accepting|failed|runtime|idle/iu);
    await fixture.tick();
    assert.deepEqual(fixture.delivered, ["retire reject"]);
});

// Admitted contract: given current tokens plus native compaction reserve, an undersized middle candidate is skipped and the next fitting candidate continues.
void test("capacity checks skip an undersized middle candidate in configured order", async () => {
    const profile = { models: ["provider/primary", "provider/small", "provider/wide"], thinkingLevel: "medium" as const, harness: "pi" as const };
    const fixture = await bridgeFixture({ profile, registry: registryWindows({ "provider/primary": 200, "provider/small": 167, "provider/wide": 200 }) });
    fixture.activate();
    await fixture.start();
    const task = await claimAndStart(fixture, "skip small");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "primary failed", usage: { input: 1, output: 1, totalTokens: 2 } } });
    await fixture.emit("agent_settled");
    assert.deepEqual(fixture.selected, ["provider/wide"]);
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" } });
    await fixture.emit("agent_settled");
    const completed = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId);
    assert.equal(completed.task?.result?.outcome, "succeeded");
    assert.equal(completed.status.modelRoute?.attempts.find(attempt => attempt.index === 1)?.category, "context");
});

// Admitted contract: non-error stop reasons and cancellation do not promote.
void test("non-error settlement and cancellation do not promote profile candidates", async () => {
    const profile = { models: ["provider/primary", "provider/fallback"], thinkingLevel: "medium" as const, harness: "pi" as const };
    for (const stopReason of ["length", "toolUse", "aborted", "stop"] as const) {
        const fixture = await bridgeFixture({ profile, registry: registryWindows({ "provider/primary": 200, "provider/fallback": 200 }) });
        fixture.activate();
        await fixture.start();
        const task = await claimAndStart(fixture, stopReason);
        await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason, errorMessage: "ignored" } });
        await fixture.emit("agent_settled");
        assert.equal(fixture.sent.length, 0, stopReason);
        const snapshot = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId);
        assert.notEqual(snapshot.task?.status.state, "running");
    }
    const fixture = await bridgeFixture({ profile, registry: registryWindows({ "provider/primary": 200, "provider/fallback": 200 }) });
    fixture.activate();
    await fixture.start();
    const task = await claimAndStart(fixture, "cancelled");
    await requestTaskCancellation(fixture.root, fixture.meshId, task.request.taskId, "caller cancelled");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "primary failed" } });
    await fixture.emit("agent_settled");
    assert.equal(fixture.sent.length, 0);
    const cancelled = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId);
    assert.equal(cancelled.task?.result?.outcome, "stopped");
});

// Admission: exhaustion retirement shares the repository-owned bounded completion lifecycle; type and store validation cannot detect a rejected retirement being discarded after task completion.
// Given exhausted fallback whose initial retirement writes reject transiently, the bridge retains the retirement, does not accept or pump new work, and a later retry terminalizes the agent.
void test("runtime exhaustion retains retirement through transient persistence failure", async () => {
    const profile = { models: ["provider/primary", "provider/fallback"], thinkingLevel: "medium" as const, harness: "pi" as const };
    let retirementAttempts = 0;
    const fixture = await bridgeFixture({
        profile,
        registry: registryWindows({ "provider/primary": 200, "provider/fallback": 200 }),
        dependencies: {
            failAgent: async (...args) => {
                retirementAttempts += 1;
                if (retirementAttempts <= 2) throw new Error("transient retirement rejection");
                return persistAgentFailure(...args);
            },
        },
    });
    fixture.activate(); await fixture.start();
    const task = await claimAndStart(fixture, "transient exhaustion retirement");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "primary failed" } });
    await fixture.emit("agent_settled");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "still failing" }], stopReason: "error", errorMessage: "fallback failed" } });
    await fixture.emit("agent_settled");
    assert.equal(retirementAttempts, 2);
    assert.deepEqual(fixture.delivered, ["transient exhaustion retirement"]);
    await assert.rejects(createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "must not enter retry window", purpose: "synthetic purpose" }, `root:${fixture.meshId}`), /not accepting|runtime|idle/iu);
    await fixture.tick();
    const recovered = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId);
    assert.equal(retirementAttempts, 3);
    assert.equal(recovered.task?.result?.outcome, "failed");
    assert.equal(recovered.status.state, "failed");
    assert.equal(recovered.status.activeTaskId, undefined);
    assert.deepEqual(fixture.delivered, ["transient exhaustion retirement"]);
});

// Admission: a permanently rejected exhaustion retirement must reach the existing bounded shutdown path rather than exposing idle activity or pumping queued work.
// Given exhausted fallback whose retirement write remains unavailable through its deadline, the bridge shuts down with the failed task retained and does not pump another task.
void test("runtime exhaustion retirement rejection reaches bounded shutdown", async () => {
    const profile = { models: ["provider/primary", "provider/fallback"], thinkingLevel: "medium" as const, harness: "pi" as const };
    let now = Date.now();
    const fixture = await bridgeFixture({
        profile,
        registry: registryWindows({ "provider/primary": 200, "provider/fallback": 200 }),
        dependencies: {
            completionPersistenceTimeoutMs: 2,
            now: () => now,
            setTimeout() { return 1; },
            clearTimeout() {},
            failAgent: async () => { now += 2; throw new Error("retirement unavailable"); },
        },
    });
    fixture.activate(); await fixture.start();
    const task = await claimAndStart(fixture, "permanent exhaustion retirement");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "primary failed" } });
    await fixture.emit("agent_settled");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "still failing" }], stopReason: "error", errorMessage: "fallback failed" } });
    await fixture.emit("agent_settled");
    const failed = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId);
    assert.equal(fixture.shutdowns, 1);
    assert.equal(failed.task?.result?.outcome, "failed");
    assert.equal(failed.activity.acceptingTask, false);
    assert.deepEqual(fixture.delivered, ["permanent exhaustion retirement"]);
    await assert.rejects(createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "must not enter shutdown window", purpose: "synthetic purpose" }, `root:${fixture.meshId}`), /not accepting|runtime|idle/iu);
    await fixture.tick();
    assert.deepEqual(fixture.delivered, ["permanent exhaustion retirement"]);
});

// Admitted contract: when all candidates fail, the caller observes one failed task and a failed agent that cannot accept another task.
void test("runtime exhaustion fails the active task and the agent", async () => {
    const profile = { models: ["provider/primary", "provider/fallback"], thinkingLevel: "medium" as const, harness: "pi" as const };
    const fixture = await bridgeFixture({ profile, registry: registryWindows({ "provider/primary": 200, "provider/fallback": 200 }) });
    fixture.activate();
    await fixture.start();
    const task = await claimAndStart(fixture, "exhaust");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "primary failed" } });
    await fixture.emit("agent_settled");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "still failing" }], stopReason: "error", errorMessage: "fallback failed" } });
    await fixture.emit("agent_settled");
    const failed = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId);
    assert.equal(failed.task?.result?.outcome, "failed");
    assert.match(failed.task?.result?.error ?? "", /fallback exhausted/u);
    assert.equal(failed.status.state, "failed");
    await assert.rejects(createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "must not accept", purpose: "synthetic purpose" }, `root:${fixture.meshId}`), /not accepting|failed|idle/iu);
});

// Admission: recoverable limit exhaustion must not finish the task; a later explicit user resume starts a new attempt cycle without replaying the original prompt.
void test("limit exhaustion holds the task and user resume continues with a new attempt cycle", async () => {
    const profile = { models: ["provider/primary", "provider/fallback"], thinkingLevel: "medium" as const, harness: "pi" as const };
    const fixture = await bridgeFixture({ profile, registry: registryWindows({ "provider/primary": 200, "provider/fallback": 200 }) });
    fixture.activate();
    await fixture.start();
    const task = await claimAndStart(fixture, "keep this held");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "limited" }], stopReason: "error", errorMessage: "You have hit your ChatGPT usage limit. Try again later." } });
    await fixture.emit("agent_settled");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "still limited" }], stopReason: "error", errorMessage: "You have hit your ChatGPT usage limit. Try again later." } });
    await fixture.emit("agent_settled");
    const held = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, task.request.taskId);
    assert.equal(held.task?.status.state, "running");
    assert.equal(held.status.state, "busy");
    const execution = await readAgentExecution(fixture.root, fixture.meshId, fixture.agentId);
    assert.equal(execution?.holds.some(hold => hold.kind === "limit"), true);
    assert.equal(execution?.limitHistory?.length, 2);
    assert.equal(await claimPendingTask(fixture.root, fixture.meshId, fixture.agentId), null);
    await applyAgentControl(fixture.root, fixture.meshId, fixture.agentId, { action: "resume", source: "user", issuer: "root", clearLimitHolds: true });
    await fixture.tick();
    assert.equal(fixture.sent.at(-1)?.message.customType, EXECUTION_RESUME_CUSTOM_TYPE);
    assert.equal(fixture.sent.at(-1)?.message.content, EXECUTION_RESUME_CONTENT);
    assert.deepEqual(fixture.delivered, ["keep this held"]);
    const cycled = await readAgentExecution(fixture.root, fixture.meshId, fixture.agentId);
    assert.equal(cycled?.limitCycle, 1);
    assert.equal(cycled?.limitHistory?.length, 2);
    assert.equal((await readTask(fixture.root, fixture.meshId, task.request.taskId)).status.state, "running");
});

// Admission: interrupt must abort the current run through execution control; leftover cancel.json would stop the same task after resume.
void test("interrupt aborts the current Pi run without writing cancel.json", async () => {
    const fixture = await bridgeFixture();
    fixture.activate();
    await fixture.start();
    const task = await claimAndStart(fixture, "stay assigned");
    await applyAgentControl(fixture.root, fixture.meshId, fixture.agentId, { action: "interrupt", source: "user", issuer: "root" });
    await fixture.tick();
    assert.equal(fixture.aborts, 1);
    await assert.rejects(access(taskPaths(fixture.root, fixture.meshId, task.request.taskId).cancel), /ENOENT/u);
    await fixture.emit("agent_settled");
    assert.equal((await readTask(fixture.root, fixture.meshId, task.request.taskId)).status.state, "running");
    await applyAgentControl(fixture.root, fixture.meshId, fixture.agentId, { action: "resume", source: "user", issuer: "root" });
    await fixture.tick();
    assert.equal(fixture.sent.at(-1)?.message.customType, EXECUTION_RESUME_CUSTOM_TYPE);
    assert.deepEqual(fixture.delivered, ["stay assigned"]);
    await assert.rejects(access(taskPaths(fixture.root, fixture.meshId, task.request.taskId).cancel), /ENOENT/u);
});

// Admission: child interactive input must not reopen a process gate still held by limit or a failed store resume.
// Given a paused child, interactive input opens the gate only after a successful manual-hold release and leaves a limit hold closed.
void test("child interactive input opens the gate only after store manual-hold release", async () => {
    const fixture = await bridgeFixture();
    fixture.activate();
    await fixture.start();
    await applyAgentControl(fixture.root, fixture.meshId, fixture.agentId, { action: "pause", source: "user", issuer: "root" });
    await fixture.tick();
    let admitted = false;
    const waiting = fixture.emit("before_provider_request").then(() => { admitted = true; });
    await yieldToIO();
    assert.equal(admitted, false);
    await fixture.emit("input", { text: "resume manual", source: "interactive", streamingBehavior: "steer" });
    await waiting;
    assert.equal(admitted, true);
    assert.equal((await readAgentExecution(fixture.root, fixture.meshId, fixture.agentId))?.holds.length, 0);
    await fixture.emit("after_provider_response");
    await applyAgentControl(fixture.root, fixture.meshId, fixture.agentId, {
        action: "pause",
        source: "system",
        issuer: "limit",
        limitHold: { holdId: randomUUID(), kind: "limit", requestId: randomUUID(), source: "system", targetRoot: fixture.agentId },
    });
    await fixture.tick();
    admitted = false;
    const waitingLimit = fixture.emit("before_provider_request").then(() => { admitted = true; });
    await yieldToIO();
    assert.equal(admitted, false);
    await fixture.emit("input", { text: "must not clear limit", source: "interactive", streamingBehavior: "steer" });
    await yieldToIO();
    assert.equal(admitted, false);
    assert.equal((await readAgentExecution(fixture.root, fixture.meshId, fixture.agentId))?.holds.some(hold => hold.kind === "limit"), true);
    await applyAgentControl(fixture.root, fixture.meshId, fixture.agentId, { action: "resume", source: "user", issuer: "root", clearLimitHolds: true });
    await fixture.emit("input", { text: "operator resume", source: "interactive", streamingBehavior: "steer" });
    await waitingLimit;
});

// Admission: a delivery timeout during pause would finish the task, and clearing awaitingDelivery on interrupt deadlocks resume; the bridge tick owns both.
// Given a claimed task still awaiting Pi acceptance, pause keeps it nonterminal past the ack deadline, and interrupt confirms without finishing or aborting.
void test("delivery pause skips timeout and interrupt confirms without clearing into deadlock", async () => {
    let now = Date.now();
    const fixture = await bridgeFixture({
        dependencies: { now: () => now, deliveryAckTimeoutMs: 5, retryIntervalMs: 1, idleClaimIntervalMs: 0 },
    });
    fixture.activate();
    await fixture.start();
    const task = await createTask(fixture.root, fixture.meshId, fixture.agentId, { prompt: "await acceptance", purpose: "synthetic purpose" }, `root:${fixture.meshId}`);
    await fixture.tick();
    assert.deepEqual(fixture.delivered, ["await acceptance"]);
    await applyAgentControl(fixture.root, fixture.meshId, fixture.agentId, { action: "pause", source: "user", issuer: "root" });
    now += 50;
    await fixture.tick();
    assert.equal((await readTask(fixture.root, fixture.meshId, task.request.taskId)).status.state, "running");
    assert.equal((await readTask(fixture.root, fixture.meshId, task.request.taskId)).result, null);
    await applyAgentControl(fixture.root, fixture.meshId, fixture.agentId, { action: "interrupt", source: "user", issuer: "root" });
    now += 50;
    await fixture.tick();
    const interrupted = await readAgentExecution(fixture.root, fixture.meshId, fixture.agentId);
    assert.equal(interrupted?.interruptConfirmed, true);
    assert.equal((await readTask(fixture.root, fixture.meshId, task.request.taskId)).status.state, "running");
    assert.equal(fixture.aborts, 0);
    await applyAgentControl(fixture.root, fixture.meshId, fixture.agentId, { action: "resume", source: "user", issuer: "root" });
    now += 50;
    await fixture.tick();
    assert.equal((await readTask(fixture.root, fixture.meshId, task.request.taskId)).status.state, "running");
    assert.equal((await readTask(fixture.root, fixture.meshId, task.request.taskId)).result, null);
});
