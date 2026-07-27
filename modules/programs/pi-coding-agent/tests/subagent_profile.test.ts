import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createSubagentStartTool, loadAgentProfileConfig, registerProfileController } from "../extensions_src/subagent.ts";
import type { SubagentRuntimeConfig } from "../extensions_src/utilities/subagent_types.ts";

function runtime(root: string): SubagentRuntimeConfig {
    return {
        schemaVersion: 2,
        stateRoot: join(root, "runs"),
        runner: { node: process.execPath, script: "/runner.ts", extension: "/subagent.ts" },
        harnesses: { pi: { command: "/pi" } },
        defaultProfile: "full",
        profileCycle: ["scout", "full"],
        maxDepth: 3,
        profiles: {
            scout: {
                harness: "pi", model: "provider/model", thinkingLevel: "low", allowAllTools: false,
                tools: ["read", "subagent_start", "subagent_get", "subagent_wait"], allowedSubagents: ["scout"],
                instructions: "Scout only.",
            },
            full: {
                harness: "pi", model: "provider/model", thinkingLevel: "medium", allowAllTools: true,
                tools: [], allowedSubagents: ["scout", "full"],
            },
        },
    };
}

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "agent-profile-"));
    const config = runtime(root);
    const path = join(root, "agent-profiles.json");
    await writeFile(path, JSON.stringify(config));
    return { root, config, path };
}

function fakeControllerPi(flag = "scout") {
    const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
    const commands: Record<string, { handler: (args: string, ctx: any) => Promise<void> }> = {};
    const shortcuts: Record<string, { handler: (ctx: any) => Promise<void> }> = {};
    const entries: any[] = [];
    let activeTools: string[] = [];
    let thinking = "off";
    let modelSucceeds = true;
    const allTools = ["read", "bash", "edit", "write", "subagent_start", "subagent_get", "subagent_wait", "project_tool"];
    const pi = {
        registerFlag() {},
        getFlag: () => flag,
        registerCommand(name: string, value: any) { commands[name] = value; },
        registerShortcut(key: string, value: any) { shortcuts[key] = value; },
        on(name: string, handler: any) { (handlers[name] ??= []).push(handler); },
        getAllTools: () => allTools.map(name => ({ name })),
        getActiveTools: () => activeTools,
        setActiveTools(names: string[]) { activeTools = [...names]; },
        async setModel() { return modelSucceeds; },
        setThinkingLevel(value: string) { thinking = value; },
        appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
    } as unknown as ExtensionAPI;
    const ctx = {
        cwd: "/work", hasUI: true, isIdle: () => true,
        modelRegistry: { find: () => ({ provider: "provider", id: "model" }) },
        sessionManager: { getBranch: () => entries, getEntries: () => entries, getSessionId: () => "session", getSessionFile: () => "/session.jsonl" },
        ui: { notify() {}, setStatus() {}, select: async () => undefined },
    } as unknown as ExtensionContext;
    return {
        pi, ctx, handlers, commands, shortcuts, entries,
        activeTools: () => activeTools, thinking: () => thinking,
        forceActiveTools: (names: string[]) => { activeTools = [...names]; },
        failModel: () => { modelSucceeds = false; }, passModel: () => { modelSucceeds = true; },
    };
}

test("profile controller applies CLI, guards scout, cycles, and restores active branch", async () => {
    const { path } = await fixture();
    const fake = fakeControllerPi("scout");
    registerProfileController(fake.pi, path);
    await fake.handlers.session_start[0]({ reason: "startup" }, fake.ctx);

    assert.deepEqual(fake.activeTools(), ["read", "subagent_start", "subagent_get", "subagent_wait"]);
    assert.equal(fake.thinking(), "low");
    assert.equal(fake.entries.at(-1)?.data.name, "scout");
    assert.deepEqual(fake.handlers.tool_call[0]({ toolName: "bash" }, fake.ctx), {
        block: true, reason: "Tool bash is not allowed by profile scout",
    });
    const promptPatch = await fake.handlers.before_agent_start[0]({ systemPrompt: "base" }, fake.ctx);
    assert.equal(promptPatch.systemPrompt, "base\n\nScout only.");

    fake.failModel();
    await fake.commands.profile.handler("full", fake.ctx);
    assert.deepEqual(fake.activeTools(), ["read", "subagent_start", "subagent_get", "subagent_wait"]);
    fake.passModel();
    await fake.shortcuts["shift+tab"].handler(fake.ctx);
    const allTools = ["read", "bash", "edit", "write", "subagent_start", "subagent_get", "subagent_wait", "project_tool"];
    assert.deepEqual(fake.activeTools(), allTools);
    fake.forceActiveTools(["read"]);
    await fake.handlers.input[0]({ text: "next turn" }, fake.ctx);
    assert.deepEqual(fake.activeTools(), allTools);
    fake.forceActiveTools(["read"]);
    await fake.handlers.before_agent_start[0]({ systemPrompt: "base" }, fake.ctx);
    assert.deepEqual(fake.activeTools(), allTools);

    fake.entries.push({ type: "custom", customType: "agent-profile-state", data: { name: "scout" } });
    await fake.handlers.session_tree[0]({}, fake.ctx);
    assert.deepEqual(fake.activeTools(), ["read", "subagent_start", "subagent_get", "subagent_wait"]);
});

function toolContext(root: string): ExtensionContext {
    return {
        cwd: root,
        sessionManager: { getSessionId: () => "session", getSessionFile: () => join(root, "session.jsonl") },
    } as ExtensionContext;
}

test("child profile policy stays pinned to persisted resolved metadata", async () => {
    const { path } = await fixture();
    const persistedScout = {
        harness: "pi", model: "provider/pinned", thinkingLevel: "low", allowAllTools: false,
        tools: ["read"], allowedSubagents: ["scout"], instructions: "pinned",
    };
    const loaded = await loadAgentProfileConfig(path, {
        PI_SUBAGENT_RESOLVED_PROFILE: JSON.stringify({ name: "scout", profile: persistedScout }),
    });
    assert.deepEqual(loaded.profiles.scout, persistedScout);
    assert.equal(loaded.profiles.full.allowAllTools, true);
});

test("delegation policy rejects profile and depth before state or tmux allocation", async () => {
    const { root, config, path } = await fixture();
    let execCalls = 0;
    const exec = async () => { execCalls += 1; return { stdout: "$0\tmain\t%1\n", stderr: "", code: 0 }; };

    await assert.rejects(
        createSubagentStartTool({ configPath: path, env: { TMUX: "yes" }, exec, activeProfile: () => "scout" }).execute(
            "call", { profile: "full", prompt: "task" }, undefined, undefined, toolContext(root),
        ),
        /not allowed/,
    );
    await assert.rejects(
        createSubagentStartTool({ configPath: path, env: { TMUX: "yes", PI_SUBAGENT_DEPTH: "3" }, exec, activeProfile: () => "full" }).execute(
            "call", { profile: "scout", prompt: "task" }, undefined, undefined, toolContext(root),
        ),
        /exceeds maxDepth/,
    );
    await assert.rejects(access(config.stateRoot));
    assert.equal(execCalls, 0);
});
