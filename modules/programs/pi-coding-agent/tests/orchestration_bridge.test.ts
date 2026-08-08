import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSubagentChildBridge } from "../extensions_src/orchestration_child_bridge.ts";
import { buildLaunchEnvelope, settledAgentCatalog, settledAgentDefinition } from "../extensions_src/utilities/agent_types.ts";
import { prepareAgent, publishAgent, readAgentSnapshot } from "../extensions_src/utilities/orchestration_store.ts";

const definition = settledAgentDefinition("worker");
const capabilities = { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true };
const tmux = { socket: "/tmp/tmux", serverPid: "1", sessionId: "$1", sessionName: "main", windowId: "@1", paneId: "%1", windowName: "worker" };

function reverseKeyInsertionOrder(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reverseKeyInsertionOrder);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([key, item]) => [key, reverseKeyInsertionOrder(item)]));
    return value;
}

async function bridgeFixture(options: { publish?: boolean; dependencies?: Parameters<typeof registerSubagentChildBridge>[2] } = {}) {
    const root = await mkdtemp(join(tmpdir(), "orchestration-bridge-"));
    const envelope = buildLaunchEnvelope("worker", settledAgentCatalog(), {}, ["/popup", "/orchestration", "/bridge"]);
    const prepared = await prepareAgent(root, { agent: "worker", harness: "pi", cwd: "/work", agentSnapshot: definition, launchEnvelope: join(root, "launch-envelope.json"), lineage: { callerIdentity: "mode:ops", targetAgent: "worker", depth: 1, originSessionId: "origin" }, capabilities });
    const envelopePath = join(prepared.paths.directory, "launch-envelope.json"); await writeFile(envelopePath, JSON.stringify(envelope));
    const publish = () => publishAgent(prepared.paths, { agentId: prepared.agentId, agent: "worker", harness: "pi", cwd: "/work", agentSnapshot: definition, launchEnvelope: envelopePath, callerIdentity: "mode:ops", targetAgent: "worker", depth: 1, originSessionId: "origin", tmux, capabilities });
    if (options.publish !== false) await publish();
    const handlers = new Map<string, (...args: any[]) => any>(); const eventHandlers: Array<(value: unknown) => void> = []; let shutdowns = 0;
    const pi = { on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); }, events: { on(_name: string, handler: (value: unknown) => void) { eventHandlers.push(handler); return () => {}; } }, sendUserMessage() {} } as unknown as ExtensionAPI;
    registerSubagentChildBridge(pi, { PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_AGENT_DIR: prepared.paths.directory, PI_AGENT_RESOLVED_AGENT: envelopePath }, { setInterval: () => 1, clearInterval() {}, ...options.dependencies });
    const start = () => handlers.get("session_start")?.({}, { sessionManager: { getSessionId: () => "child", getSessionFile: () => undefined }, shutdown() { shutdowns += 1; } });
    return { root, envelope, prepared, eventHandlers, start, publish, get shutdowns() { return shutdowns; } };
}

void test("native bridge readiness requires the complete immutable launch envelope event", async () => {
    const matching = await bridgeFixture(); for (const handler of matching.eventHandlers) handler({ schemaVersion: 1, identity: matching.envelope.identity, envelope: matching.envelope }); await matching.start(); const ready = await readAgentSnapshot(matching.root, matching.prepared.agentId); assert.equal(ready.status.bridgeReady, true); assert.equal(ready.status.state, "idle");
    const mismatch = await bridgeFixture(); const changed = structuredClone(mismatch.envelope); changed.childExtensions.worker![0] = "/changed-popup"; await writeFile(join(mismatch.prepared.paths.directory, "launch-envelope.json"), JSON.stringify(changed)); for (const handler of mismatch.eventHandlers) handler({ schemaVersion: 1, identity: changed.identity, envelope: changed }); await mismatch.start(); const failed = JSON.parse(await readFile(mismatch.prepared.paths.status, "utf8")); assert.equal(failed.bridgeReady, false); assert.equal(failed.state, "failed"); assert.equal(mismatch.shutdowns, 1);
});
void test("native bridge waits for delayed agent publication and fails after a bounded timeout", async () => {
    const delayed = await bridgeFixture({ publish: false, dependencies: { publicationTimeoutMs: 100, publicationRetryMs: 1 } });
    for (const handler of delayed.eventHandlers) handler({ schemaVersion: 1, identity: delayed.envelope.identity, envelope: delayed.envelope });
    const starting = delayed.start(); setTimeout(() => { void delayed.publish(); }, 10); await starting;
    assert.equal((await readAgentSnapshot(delayed.root, delayed.prepared.agentId)).status.bridgeReady, true); assert.equal(delayed.shutdowns, 0);

    let now = 0; const timedOut = await bridgeFixture({ publish: false, dependencies: { publicationTimeoutMs: 2, publicationRetryMs: 1, now: () => now, sleep: async milliseconds => { now += milliseconds; } } });
    for (const handler of timedOut.eventHandlers) handler({ schemaVersion: 1, identity: timedOut.envelope.identity, envelope: timedOut.envelope });
    await timedOut.start(); const failed = JSON.parse(await readFile(timedOut.prepared.paths.status, "utf8")); assert.equal(failed.bridgeReady, false); assert.equal(failed.state, "failed"); assert.match(failed.exitReason, /parent agent publication/u); assert.equal(timedOut.shutdowns, 1);
});

void test("native bridge accepts a semantically equivalent envelope with different key insertion order", async () => {
    const fixture = await bridgeFixture();
    const reordered = reverseKeyInsertionOrder(fixture.envelope);
    assert.notEqual(JSON.stringify(reordered), JSON.stringify(fixture.envelope));
    for (const handler of fixture.eventHandlers) handler({ schemaVersion: 1, identity: fixture.envelope.identity, envelope: reordered });
    await fixture.start();
    const ready = await readAgentSnapshot(fixture.root, fixture.prepared.agentId);
    assert.equal(ready.status.bridgeReady, true);
    assert.equal(ready.status.state, "idle");
});
