import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { availableContext, externalContext, projectAgentActivity, publishAgentActivity, readProjectedAgentActivity, type AgentActivityContext } from "../extensions_src/utilities/orchestration_activity.ts";
import { initializeMesh, meshPaths, requestAgentStop } from "../extensions_src/utilities/orchestration_store.ts";
import { emptyUsage, type AgentStatus } from "../extensions_src/utilities/orchestration_types.ts";
import { setOrchestrationLockObserverForTest, type OrchestrationLockObservation } from "../extensions_src/utilities/orchestration_lock.ts";
import { bindAgentRuntime } from "../extensions_src/utilities/orchestration_runtime.ts";

const budgets = { maxLiveAgents: 2, maxConcurrentTasks: 2, maxTasksPerMesh: 8 };
function status(meshId: string, agentId: string, state: AgentStatus["state"] = "idle"): AgentStatus {
    return { schemaVersion: 1, meshId, agentId, state, bridgeReady: true, meshToolsEnabled: false, agentUsage: emptyUsage(), accountedTaskIds: [], updatedAt: "2026-08-09T12:00:00.000Z" };
}
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "mesh-activity-")); const mesh = await initializeMesh(root, { rootSessionId: "root", recoverable: false, budgets }); const agentId = randomUUID(); const directory = join(meshPaths(root, mesh.meshId).agents, agentId); await mkdir(directory); await writeFile(join(directory, "status.json"), JSON.stringify(status(mesh.meshId, agentId))); return { root, meshId: mesh.meshId, agentId, directory };
}

void test("activity publication is monotonic and rejects delayed or post-stop non-terminal observations", async () => {
    const f = await fixture();
    try {
        const runtimeId = randomUUID(); await bindAgentRuntime(f.root, f.meshId, f.agentId, { runtimeId, kind: "external" }); const base = { runtimeId, phase: "idle" as const, acceptingTask: true, pendingMessages: false, phaseSince: "2026-08-09T12:00:00.000Z", observedAt: "2026-08-09T12:00:01.000Z", heartbeatAt: "2026-08-09T12:00:01.000Z", context: externalContext() };
        const first = await publishAgentActivity(f.root, f.meshId, f.agentId, base);
        const second = await publishAgentActivity(f.root, f.meshId, f.agentId, { ...base, observedAt: "2026-08-09T12:00:02.000Z", heartbeatAt: "2026-08-09T12:00:02.000Z" });
        assert.deepEqual([first.sequence, second.sequence], [1, 2]);
        await assert.rejects(publishAgentActivity(f.root, f.meshId, f.agentId, { ...base, observedAt: "2026-08-09T12:00:00.500Z" }), /older/u);
        await writeFile(join(f.directory, "status.json"), JSON.stringify(status(f.meshId, f.agentId, "stopping")));
        await assert.rejects(publishAgentActivity(f.root, f.meshId, f.agentId, { ...base, phase: "running", observedAt: "2026-08-09T12:00:03.000Z", heartbeatAt: "2026-08-09T12:00:03.000Z" }), /non-terminal/u);
    } finally { await rm(f.root, { recursive: true, force: true }); }
});

// Behavioral admission: concurrent activity and lifecycle publication is repository-owned durable state; a lock-order regression can deadlock a mesh or let a heartbeat race a lifecycle transition. The public publication and runtime-binding APIs are the stable boundary, and neither types nor atomic JSON writes establish their ordering.
// Given parallel activity publications and a mixed runtime binding, when they acquire orchestration locks, callers observe agent-only serialized activity and mesh→agent mixed ordering.
void test("activity publication uses only the serialized agent lock", async () => {
    const f = await fixture();
    const events: OrchestrationLockObservation[] = [];
    let blockActivity = false;
    let firstActivityLockHeld = false;
    let firstActivityLockHeldResolve!: () => void;
    const firstActivityLockHeldPromise = new Promise<void>(resolve => { firstActivityLockHeldResolve = resolve; });
    let secondActivityWaitingResolve!: () => void;
    const secondActivityWaiting = new Promise<void>(resolve => { secondActivityWaitingResolve = resolve; });
    let releaseFirstActivityLock!: () => void;
    const releaseFirstActivityLockPromise = new Promise<void>(resolve => { releaseFirstActivityLock = resolve; });
    const resetObserver = setOrchestrationLockObserverForTest(async event => {
        events.push(event);
        if (!blockActivity || event.scope !== "agent") return;
        if (event.phase === "acquired" && !firstActivityLockHeld) {
            firstActivityLockHeld = true;
            firstActivityLockHeldResolve();
            await releaseFirstActivityLockPromise;
        }
        if (event.phase === "waiting" && firstActivityLockHeld) secondActivityWaitingResolve();
    });
    try {
        const runtimeId = randomUUID();
        await bindAgentRuntime(f.root, f.meshId, f.agentId, { runtimeId, kind: "external" });
        assert.deepEqual(events.filter(event => event.phase === "acquired").map(event => event.scope), ["mesh", "agent"]);
        events.length = 0;
        blockActivity = true;
        const base = { runtimeId, phase: "idle" as const, acceptingTask: true, pendingMessages: false, phaseSince: "2026-08-09T12:00:00.000Z", context: externalContext() };
        const first = publishAgentActivity(f.root, f.meshId, f.agentId, { ...base, observedAt: "2026-08-09T12:00:01.000Z", heartbeatAt: "2026-08-09T12:00:01.000Z" });
        await firstActivityLockHeldPromise;
        const second = publishAgentActivity(f.root, f.meshId, f.agentId, { ...base, observedAt: "2026-08-09T12:00:02.000Z", heartbeatAt: "2026-08-09T12:00:02.000Z" });
        await secondActivityWaiting;
        assert.deepEqual(events.map(event => event.scope), ["agent", "agent", "agent"]);
        assert.equal(events.filter(event => event.phase === "acquired").length, 1);
        releaseFirstActivityLock();
        assert.deepEqual((await Promise.all([first, second])).map(activity => activity.sequence), [1, 2]);
    } finally {
        resetObserver();
        await rm(f.root, { recursive: true, force: true });
    }
});

// Given a stop request holding mesh→agent locks, when a current runtime's non-terminal heartbeat waits for the agent lock, the heartbeat is rejected after the stop persists stopping state.
void test("stop request fences a stale non-terminal heartbeat", async () => {
    const f = await fixture();
    const runtimeId = randomUUID();
    const at = "2026-08-09T12:00:00.000Z";
    await bindAgentRuntime(f.root, f.meshId, f.agentId, { runtimeId, kind: "external" });
    await publishAgentActivity(f.root, f.meshId, f.agentId, { runtimeId, phase: "idle", acceptingTask: true, pendingMessages: false, phaseSince: at, observedAt: at, heartbeatAt: at, context: externalContext() });
    let meshAcquired = false;
    let stopAgentLockHeld = false;
    let stopAgentLockHeldResolve!: () => void;
    const stopAgentLockHeldPromise = new Promise<void>(resolve => { stopAgentLockHeldResolve = resolve; });
    let releaseStopAgentLock!: () => void;
    const releaseStopAgentLockPromise = new Promise<void>(resolve => { releaseStopAgentLock = resolve; });
    const resetObserver = setOrchestrationLockObserverForTest(async event => {
        if (event.phase === "acquired" && event.scope === "mesh" && event.meshId === f.meshId) meshAcquired = true;
        if (meshAcquired && !stopAgentLockHeld && event.phase === "acquired" && event.scope === "agent" && event.agentId === f.agentId) {
            stopAgentLockHeld = true;
            stopAgentLockHeldResolve();
            await releaseStopAgentLockPromise;
        }
    });
    try {
        const stopping = requestAgentStop(f.root, f.meshId, f.agentId, { source: "peer", reason: "deterministic stale heartbeat race" });
        await stopAgentLockHeldPromise;
        const staleHeartbeat = publishAgentActivity(f.root, f.meshId, f.agentId, { runtimeId, phase: "running", acceptingTask: false, pendingMessages: false, phaseSince: "2026-08-09T12:00:01.000Z", observedAt: "2026-08-09T12:00:01.000Z", heartbeatAt: "2026-08-09T12:00:01.000Z", context: externalContext() });
        releaseStopAgentLock();
        await stopping;
        await assert.rejects(staleHeartbeat, /cannot publish non-terminal/u);
    } finally {
        resetObserver();
        await rm(f.root, { recursive: true, force: true });
    }
});

void test("activity projection derives context retirement, external acceptance, and conservative unknown freshness", async () => {
    const meshId = randomUUID(); const agentId = randomUUID(); const idle = status(meshId, agentId); const heartbeatAt = "2026-08-09T12:00:00.000Z";
    const raw = (context: AgentActivityContext) => ({ schemaVersion: 1 as const, meshId, agentId, runtimeId: randomUUID(), sequence: 1, phase: "idle" as const, acceptingTask: true, pendingMessages: false, phaseSince: heartbeatAt, observedAt: heartbeatAt, heartbeatAt, context });
    const retirement = projectAgentActivity(idle, raw(availableContext(100, 200, 68)), { now: Date.parse(heartbeatAt) });
    assert.equal(retirement.context.tokensUntilCompaction, 32);
    assert.equal(retirement.context.health, "retire");
    assert.equal(retirement.acceptingTask, false);
    const healthy = projectAgentActivity(idle, raw(availableContext(99, 200, 68, 32)), { now: Date.parse(heartbeatAt) });
    assert.equal(healthy.context.health, "healthy");
    assert.equal(healthy.acceptingTask, true);
    assert.equal(projectAgentActivity(idle, raw(externalContext()), { now: Date.parse(heartbeatAt) }).acceptingTask, true);
    const stale = projectAgentActivity(idle, raw(externalContext()), { now: Date.parse(heartbeatAt) + 10_001, staleMs: 10_000 });
    assert.deepEqual({ phase: stale.phase, acceptingTask: stale.acceptingTask, context: stale.context.state }, { phase: "unknown", acceptingTask: false, context: "unknown" });
});

void test("missing or malformed durable activity projects as unknown", async () => {
    const f = await fixture();
    try {
        assert.equal((await readProjectedAgentActivity(f.root, status(f.meshId, f.agentId))).phase, "unknown");
        await writeFile(join(f.directory, "activity.json"), "{ malformed");
        assert.equal((await readProjectedAgentActivity(f.root, status(f.meshId, f.agentId))).acceptingTask, false);
    } finally { await rm(f.root, { recursive: true, force: true }); }
});
