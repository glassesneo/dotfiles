import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMeshChildBridge, type MeshChildBridgeDependencies } from "../extensions_src/orchestration_child_bridge.ts";
import { buildLaunchEnvelope } from "../extensions_src/utilities/agent_types.ts";
import { FALLBACK_CONTINUE_CONTENT, FALLBACK_CONTINUE_CUSTOM_TYPE } from "../extensions_src/utilities/orchestration_profile_fallback.ts";
import { FakeMonotonicTimers, yieldToIO } from "./test_helpers.ts";
import { readAgentActivity } from "../extensions_src/utilities/orchestration_activity.ts";
import { claimPendingTask, createTask, ensurePolicyEpoch, initializeMesh, markAgentStopping, patchAgentStatus, prepareAgent, publishAgent, readAgentSnapshot, requestTaskCancellation, reserveMeshCapacity } from "../extensions_src/utilities/orchestration_store.ts";

const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, taskCancellation: true, usage: true, interactiveInterventions: true, terminalHistory: true };
const tmux = { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "main", windowId: "@1", paneId: "%1", windowName: "worker" };
const syntheticRole = (name = "worker", contextPolicy: "project" | "prompt-only" = "project") => ({ description: `Synthetic ${name}`, tools: [], instructions: "Return the bounded result.", contextPolicy, childExtensionContributions: [] });
const syntheticProfile = { models: ["provider/model"], thinkingLevel: "medium" as const, harness: "pi" as const };
const syntheticCatalog = (roles: Record<string, ReturnType<typeof syntheticRole>>) => ({ schemaVersion: 4 as const, roles });
const budgets = { maxLiveAgents: 4, maxConcurrentTasks: 4, maxTasksPerMesh: 20 };

function reverseKeyInsertionOrder(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reverseKeyInsertionOrder);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([key, item]) => [key, reverseKeyInsertionOrder(item)]));
    return value;
}

async function bridgeFixture(options: { publish?: boolean; contextPolicy?: "project" | "prompt-only"; dependencies?: MeshChildBridgeDependencies; profile?: { models: string[]; thinkingLevel: "medium"; harness: "pi" }; registry?: { find(provider: string, modelId: string): { provider: string; id: string; contextWindow: number } | undefined }; currentModel?: { provider: string; id: string; contextWindow: number }; setModel?: (model: { provider: string; id: string }) => Promise<boolean> } = {}) {
    const profile = options.profile ?? syntheticProfile;
    const root = await mkdtemp(join(tmpdir(), "orchestration-bridge-"));
    const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: false, budgets });
    const worker = syntheticRole("worker", options.contextPolicy);
    const roles = { worker };
    const epoch = await ensurePolicyEpoch(root, mesh.meshId, {
        mode: "ops",
        catalog: syntheticCatalog(roles),
        profiles: { schemaVersion: 2 as const, profiles: { "pi-medium": profile } },
        callPolicy: { modes: { ops: { targets: { worker: { profiles: ["pi-medium"] } } } }, roles: {} },
    });
    const reservation = await reserveMeshCapacity(root, mesh.meshId, "new-agent-task");
    const agentId = randomUUID();
    const envelope = buildLaunchEnvelope({ meshId: mesh.meshId, agentId, epochId: epoch.epochId, role: "worker", snapshot: epoch, childExtensions: { worker: ["/popup", "/orchestration", "/bridge"] } });
    const prepared = await prepareAgent(root, mesh.meshId, { reservationId: reservation.reservationId, agentId, role: "worker", selectedProfile: "pi-medium", harness: "pi", cwd: "/work", roleSnapshot: worker, profileSnapshot: profile, launchEnvelope: "pending", epochId: epoch.epochId, provenance: { creatorSessionId: "parent" }, capabilities });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json");
    await writeFile(envelopePath, JSON.stringify(envelope));
    const publish = () => publishAgent(root, mesh.meshId, prepared.paths, { agentId, epochId: epoch.epochId, role: "worker", selectedProfile: "pi-medium", harness: "pi", cwd: "/work", roleSnapshot: worker, profileSnapshot: profile, launchEnvelope: envelopePath, creatorSessionId: "parent", tmux, capabilities });
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
    const pi = {
        on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); },
        events: { on(_name: string, handler: (value: unknown) => void) { eventHandlers.push(handler); return () => {}; } },
        sendUserMessage(prompt: string) { delivered.push(prompt); },
        sendMessage(message: unknown, options: unknown) { sent.push({ message, options }); },
        async setModel(model: { provider: string; id: string }) { selected.push(`${model.provider}/${model.id}`); return options.setModel ? options.setModel(model) : true; },
        setThinkingLevel() {},
    } as unknown as ExtensionAPI;
    registerMeshChildBridge(pi, { PI_MESH_ID: mesh.meshId, PI_MESH_AGENT_ID: agentId, PI_MESH_AGENT_DIR: prepared.paths.directory, PI_MESH_EPOCH_ID: epoch.epochId, PI_AGENT_RESOLVED_AGENT: envelopePath }, {
        wake: { watch: () => ({ close() {}, on() { return this; }, unref() {} }) }, cadenceSetTimeout(callback) { intervalCallback = callback; return 1; }, cadenceClearTimeout() {}, resolveCompactionReserveTokens: () => 68, contextHeadroomTokens: 32, standaloneRuntimeBinding: true, idleClaimIntervalMs: 0, ...options.dependencies,
    });
    const activate = (value: unknown = envelope) => { for (const handler of eventHandlers) handler({ schemaVersion: 1, identity: envelope.identity, envelope: value }); };
    const start = () => handlers.get("session_start")?.({}, { cwd: "/work", model: options.currentModel, sessionManager: { getSessionId: () => "child", getSessionFile: () => join(root, "child.jsonl") }, getContextUsage: () => ({ tokens: usageTokens, contextWindow: 200, percent: 49.5 }), isIdle: () => idle, hasPendingMessages: () => pendingMessages, modelRegistry: options.registry, abort() { aborts += 1; }, shutdown() { shutdowns += 1; } });
    const tick = async () => { await intervalCallback?.(); };
    const emit = async (name: string, event: unknown = {}) => { await handlers.get(name)?.(event, {}); };
    return { root, meshId: mesh.meshId, envelope, envelopePath, prepared, agentId, activate, start, tick, emit, publish, delivered, sent, selected, setUsageTokens(value: number) { usageTokens = value; }, setIdle(value: boolean) { idle = value; }, setPendingMessages(value: boolean) { pendingMessages = value; }, get shutdowns() { return shutdowns; }, get aborts() { return aborts; } };
}

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
    const task = await createTask(fixture.root, fixture.meshId, fixture.agentId, "claim during shutdown", `root:${fixture.meshId}`);
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
    await createTask(fixture.root, fixture.meshId, fixture.agentId, "complete before store failure", `root:${fixture.meshId}`);
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
    fixture.activate(); await fixture.start(); await createTask(fixture.root, fixture.meshId, fixture.agentId, "wake task", `root:${fixture.meshId}`); changed!("change", "task.json"); await clock.advance(10); assert.deepEqual(fixture.delivered, ["wake task"]); await fixture.emit("session_shutdown", { reason: "reload" }); assert.equal(closed, 1); assert.equal(clock.pendingCount, 0);
});

// Admission: child claim cadence is repository-owned state behavior; types cannot distinguish an idle full-store claim from an active cancellation probe.
// Given an idle child and then an active task, cadence crossings defer full pickup for three seconds while retaining a 100 ms active cancellation deadline.
void test("Pi child separates idle task claims from active cancellation cadence", async () => {
    const clock = new FakeMonotonicTimers(); clock.now = Date.now();
    const fixture = await bridgeFixture({ dependencies: { now: () => clock.now, idleClaimIntervalMs: 3000, cadenceSetTimeout: clock.setTimeout, cadenceClearTimeout: clock.clearTimeout } });
    fixture.activate(); await fixture.start();
    const task = await createTask(fixture.root, fixture.meshId, fixture.agentId, "cadenced task", `root:${fixture.meshId}`);
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

    const complete = await createTask(fixture.root, fixture.meshId, fixture.agentId, "complete", `root:${fixture.meshId}`);
    await fixture.tick();
    assert.deepEqual(fixture.delivered, ["complete"]);
    await fixture.emit("before_agent_start", { prompt: "complete" });
    await fixture.emit("agent_start");
    await fixture.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", usage: { input: 2, output: 3, totalTokens: 5 } } });
    await fixture.emit("agent_settled");
    const completed = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, complete.request.taskId);
    assert.equal(completed.task?.result?.outcome, "succeeded");
    assert.equal(completed.task?.result?.output, "done");

    const cancel = await createTask(fixture.root, fixture.meshId, fixture.agentId, "cancel", `root:${fixture.meshId}`);
    await fixture.tick();
    await requestTaskCancellation(fixture.root, fixture.meshId, cancel.request.taskId, "caller cancelled");
    await fixture.tick();
    const cancelled = await readAgentSnapshot(fixture.root, fixture.meshId, fixture.agentId, cancel.request.taskId);
    assert.equal(cancelled.task?.result?.outcome, "stopped");

    const fail = await createTask(fixture.root, fixture.meshId, fixture.agentId, "fail", `root:${fixture.meshId}`);
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
    const task = await createTask(fixture.root, fixture.meshId, fixture.agentId, prompt, `root:${fixture.meshId}`);
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
    assert.equal(fixture.sent[0]?.message.content, FALLBACK_CONTINUE_CONTENT);
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
    await assert.rejects(createTask(fixture.root, fixture.meshId, fixture.agentId, "must not accept", `root:${fixture.meshId}`), /not accepting|failed|idle/iu);
});
