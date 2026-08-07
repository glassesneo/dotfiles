import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSubagentChildBridge } from "../extensions_src/subagent_child_bridge.ts";
import { createTask, finishTask, patchAgentStatus, prepareAgent, publishAgent, readAgentSnapshot, taskPaths } from "../extensions_src/utilities/subagent_store.ts";
import { controlledBridgeScheduler, nativeProfile as profile, nativeTmux as tmux, subagentTestRoot } from "./subagent_native_helpers.ts";

void test("child bridge defers parent task delivery until an idle human turn settles and preserves model failure", async () => {
    const root = await subagentTestRoot("native-bridge-");
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    const handlers = new Map<string, (event?: Record<string, unknown>) => unknown>();
    const delivered: string[] = [];
    const api = { on(name: string, handler: (event?: Record<string, unknown>) => unknown) { handlers.set(name, handler); }, events: { on() { return () => {}; } }, sendUserMessage(prompt: string) { delivered.push(prompt); } } as unknown as ExtensionAPI;
    const scheduler = controlledBridgeScheduler();
    assert.equal(registerSubagentChildBridge(api, { PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_AGENT_DIR: prepared.paths.directory }, scheduler.dependencies), true);
    await handlers.get("session_start")?.({});
    await handlers.get("input")?.({ source: "interactive", text: "human turn", images: [] });
    const task = await createTask(root, prepared.agentId, "parent", "parent task");
    await scheduler.tick();
    assert.deepEqual(delivered, []);
    assert.equal((await readAgentSnapshot(root, prepared.agentId, task.request.taskId)).task?.status.state, "created");
    await handlers.get("agent_settled")?.({});
    assert.deepEqual(delivered, ["parent task"]);
    await handlers.get("message_end")?.({ message: { role: "assistant", content: [{ type: "text", text: "provider failed" }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "error", errorMessage: "provider unavailable" } });
    await handlers.get("agent_settled")?.({});
    const failed = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
    assert.equal(failed.task?.status.state, "failed");
    assert.equal(failed.task?.result?.error, "provider unavailable");
    const truncatedTask = await createTask(root, prepared.agentId, "truncated", "produce a long answer");
    await scheduler.tick();
    await handlers.get("message_end")?.({ message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "length" } });
    await handlers.get("agent_settled")?.({});
    const truncated = await readAgentSnapshot(root, prepared.agentId, truncatedTask.request.taskId);
    assert.equal(truncated.task?.status.state, "failed");
    assert.match(truncated.task?.result?.error ?? "", /token limit/u);
    await handlers.get("session_shutdown")?.({});
});
void test("child bridge retries task-delivery failure persistence after session-start dispatch rejects", async () => {
    const root = await subagentTestRoot("native-bridge-delivery-retry-");
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    const handlers = new Map<string, (event?: Record<string, unknown>) => unknown>();
    const api = { on(name: string, handler: (event?: Record<string, unknown>) => unknown) { handlers.set(name, handler); }, events: { on() { return () => {}; } }, sendUserMessage() { throw new Error("delivery rejected"); } } as unknown as ExtensionAPI;
    let attempts = 0;
    const injectedFinish: typeof finishTask = async (...args) => { attempts += 1; if (attempts === 1) throw new Error("persistence rejected"); return finishTask(...args); };
    const scheduler = controlledBridgeScheduler();
    registerSubagentChildBridge(api, { PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_AGENT_DIR: prepared.paths.directory }, { ...scheduler.dependencies, finishTask: injectedFinish });
    try {
        await assert.rejects(Promise.resolve(handlers.get("session_start")?.({})), /persistence rejected/u);
        await scheduler.tick();
        const repaired = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
        assert.equal(repaired.status.state, "idle");
        assert.equal(repaired.task?.status.state, "failed");
        assert.match(repaired.task?.result?.error ?? "", /delivery rejected/u);
        assert.ok(attempts >= 2);
    } finally { await handlers.get("session_shutdown")?.({}); }
});
void test("child bridge terminalizes an asynchronously rejected delivery that emits no Pi events", async () => {
    const root = await subagentTestRoot("native-bridge-async-delivery-");
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    const task = await createTask(root, prepared.agentId, "first", "inspect");
    const handlers = new Map<string, (event?: Record<string, unknown>) => unknown>();
    const api = { on(name: string, handler: (event?: Record<string, unknown>) => unknown) { handlers.set(name, handler); }, events: { on() { return () => {}; } }, sendUserMessage() {} } as unknown as ExtensionAPI;
    const scheduler = controlledBridgeScheduler();
    registerSubagentChildBridge(api, { PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_AGENT_DIR: prepared.paths.directory }, { ...scheduler.dependencies, deliveryAckTimeoutMs: 20 });
    try {
        await handlers.get("session_start")?.({ reason: "startup" });
        await handlers.get("input")?.({ source: "extension", text: "inspect" });
        scheduler.advance(20);
        await scheduler.tick();
        const failed = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
        assert.equal(failed.status.state, "idle");
        assert.equal(failed.task?.status.state, "failed");
        assert.match(failed.task?.result?.error ?? "", /did not accept/u);
    } finally { await handlers.get("session_shutdown")?.({ reason: "quit" }); }
});
void test("child bridge reload fails only the active task and replacement bridge remains usable", async () => {
    const root = await subagentTestRoot("native-bridge-reload-");
    const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
    await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
    const first = await createTask(root, prepared.agentId, "first", "inspect");
    const handlers = new Map<string, (event?: Record<string, unknown>) => unknown>();
    const delivered: string[] = [];
    const api = { on(name: string, handler: (event?: Record<string, unknown>) => unknown) { handlers.set(name, handler); }, events: { on() { return () => {}; } }, sendUserMessage(prompt: string) { delivered.push(prompt); } } as unknown as ExtensionAPI;
    const firstScheduler = controlledBridgeScheduler();
    registerSubagentChildBridge(api, { PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_AGENT_DIR: prepared.paths.directory }, firstScheduler.dependencies);
    await handlers.get("session_start")?.({ reason: "startup" });
    await handlers.get("input")?.({ source: "extension", text: "inspect" });
    await handlers.get("session_shutdown")?.({ reason: "reload" });
    const reloaded = await readAgentSnapshot(root, prepared.agentId, first.request.taskId);
    assert.equal(reloaded.status.state, "idle");
    assert.equal(reloaded.task?.status.state, "failed");
    assert.match(reloaded.task?.result?.error ?? "", /replaced \(reload\)/u);
    const secondScheduler = controlledBridgeScheduler();
    registerSubagentChildBridge(api, { PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_AGENT_DIR: prepared.paths.directory }, secondScheduler.dependencies);
    await handlers.get("session_start")?.({ reason: "reload" });
    const second = await createTask(root, prepared.agentId, "second", "retest");
    await secondScheduler.tick();
    assert.equal(delivered.at(-1), "retest");
    await handlers.get("input")?.({ source: "extension", text: "retest" });
    await handlers.get("message_end")?.({ message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
    await handlers.get("agent_settled")?.({});
    assert.equal((await readAgentSnapshot(root, prepared.agentId, second.request.taskId)).task?.status.state, "succeeded");
    await handlers.get("session_shutdown")?.({ reason: "quit" });
});
void test("child bridge autonomously retries every interrupted completion phase", async () => {
    for (const phase of ["before-result", "result", "accounting", "task-status", "agent-final"] as const) {
        const root = await subagentTestRoot(`native-completion-${phase}-`);
        const prepared = await prepareAgent(root, { profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, lineage: { callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" }, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true } });
        await publishAgent(prepared.paths, { agentId: prepared.agentId, profile: "tester", purpose: "first", harness: "pi", cwd: "/work", profileSnapshot: profile, tmux, capabilities: { nativeScreen: true, taskDelivery: true, taskCompletion: true, usage: true, interactiveInterventions: true }, callerProfile: "taskmaster", targetProfile: "tester", depth: 1, originSessionId: "origin" });
        const task = await createTask(root, prepared.agentId, "first", "inspect");
        const handlers = new Map<string, (event?: Record<string, unknown>) => unknown>();
        const api = { on(name: string, handler: (event?: Record<string, unknown>) => unknown) { handlers.set(name, handler); }, events: { on() { return () => {}; } }, sendUserMessage() {} } as unknown as ExtensionAPI;
        let attempts = 0;
        const injectedFinish: typeof finishTask = async (stateRoot, agentId, taskId, input) => {
            attempts += 1;
            if (attempts > 1) return finishTask(stateRoot, agentId, taskId, input);
            if (phase === "before-result") throw new Error("injected before result");
            const snapshot = await readAgentSnapshot(stateRoot, agentId, taskId);
            const files = taskPaths(stateRoot, agentId, taskId);
            const finishedAt = new Date().toISOString();
            const result = { schemaVersion: 1 as const, agentId, taskId, outcome: input.outcome, output: input.output ?? "", usage: input.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, turns: input.turns ?? 0, interventions: [], startedAt: snapshot.task!.status.startedAt!, finishedAt, ...(input.error ? { error: input.error } : {}) };
            await writeFile(files.result, `${JSON.stringify(result)}\n`);
            if (phase === "result") throw new Error("injected after result");
            await patchAgentStatus(prepared.paths, { agentUsage: result.usage, accountedTaskIds: [taskId] });
            if (phase === "accounting") throw new Error("injected after accounting");
            await writeFile(files.status, `${JSON.stringify({ ...snapshot.task!.status, state: input.outcome, finishedAt })}\n`);
            if (phase === "task-status") throw new Error("injected after task status");
            await patchAgentStatus(prepared.paths, { state: "idle", activeTaskId: undefined });
            throw new Error("injected after final agent status");
        };
        const scheduler = controlledBridgeScheduler();
        registerSubagentChildBridge(api, { PI_SUBAGENT_AGENT_ID: prepared.agentId, PI_SUBAGENT_AGENT_DIR: prepared.paths.directory }, { ...scheduler.dependencies, finishTask: injectedFinish });
        try {
            await handlers.get("session_start")?.({});
            await handlers.get("message_end")?.({ message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } });
            await assert.rejects(Promise.resolve(handlers.get("agent_settled")?.({})), /injected/u);
            await scheduler.tick();
            const repaired = await readAgentSnapshot(root, prepared.agentId, task.request.taskId);
            assert.equal(repaired.status.state, "idle", phase);
            assert.equal(repaired.task?.status.state, "succeeded", phase);
            assert.equal(repaired.status.agentUsage.input, 2, phase);
            assert.deepEqual(repaired.status.accountedTaskIds, [task.request.taskId], phase);
            assert.ok(attempts >= 2, phase);
        } finally { await handlers.get("session_shutdown")?.({}); }
    }
});
