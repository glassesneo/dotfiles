import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadAgentProfileConfig, registerProfileController } from "../extensions_src/profile.ts";
import { createSubagentStartTool, registerSubagent } from "../extensions_src/subagent.ts";
import { ACTIVE_PROFILE_EVENT, onActiveProfile } from "../extensions_src/utilities/profile_events.ts";
import type { AgentProfileConfig } from "../extensions_src/utilities/profile_types.ts";
import type { SubagentRuntimeConfig } from "../extensions_src/utilities/subagent_types.ts";

function profiles(): AgentProfileConfig {
    return {
        schemaVersion: 2,
        defaultProfile: "full",
        profileCycle: ["scout", "full"],
        profiles: {
            scout: {
                model: "provider/model", description: "Read-only exploration.", thinkingLevel: "low", allowAllTools: false,
                tools: ["read", "subagent_start", "subagent_get", "subagent_wait"], instructions: "Scout only.",
                extensions: { subagent: { allowedTargets: ["scout"] } },
            },
            full: {
                model: "provider/model", description: "Broad coding work.", thinkingLevel: "medium", allowAllTools: true, tools: [],
                extensions: { subagent: { allowedTargets: ["scout", "full"] } },
            },
        },
    };
}

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "agent-profile-"));
    const profileConfig = profiles();
    const subagentConfig: SubagentRuntimeConfig = {
        schemaVersion: 1,
        stateRoot: join(root, "runs"),
        runner: { node: process.execPath, script: "/runner.ts", extensions: ["/profile.ts", "/subagent.ts"] },
        harnesses: { pi: { command: "/pi" } },
        maxDepth: 3,
    };
    const profilePath = join(root, "agent-profiles.json");
    const subagentPath = join(root, "subagent.json");
    await writeFile(profilePath, JSON.stringify(profileConfig));
    await writeFile(subagentPath, JSON.stringify(subagentConfig));
    return { root, profileConfig, subagentConfig, profilePath, subagentPath };
}

function fakeControllerPi(flag = "scout") {
    const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
    const commands: Record<string, { handler: (args: string, ctx: any) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown }> = {};
    const shortcuts: Record<string, { handler: (ctx: any) => Promise<void> }> = {};
    const entries: any[] = [];
    const events: any[] = [];
    let activeTools: string[] = [];
    let thinking = "off";
    let modelSucceeds = true;
    const allTools = ["read", "bash", "edit", "write", "subagent_start", "subagent_get", "subagent_wait", "project_tool"];
    const pi = {
        registerFlag() {}, getFlag: () => flag,
        registerCommand(name: string, value: any) { commands[name] = value; },
        registerShortcut(key: string, value: any) { shortcuts[key] = value; },
        on(name: string, handler: any) { (handlers[name] ??= []).push(handler); },
        events: { on() {}, emit(name: string, payload: unknown) { events.push({ name, payload }); } },
        getAllTools: () => allTools.map(name => ({ name })), getActiveTools: () => activeTools,
        setActiveTools(names: string[]) { activeTools = [...names]; },
        async setModel() { return modelSucceeds; }, setThinkingLevel(value: string) { thinking = value; },
        appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
    } as unknown as ExtensionAPI;
    const ctx = {
        cwd: "/work", hasUI: true, isIdle: () => true,
        modelRegistry: { find: () => ({ provider: "provider", id: "model" }) },
        sessionManager: { getBranch: () => entries, getEntries: () => entries, getSessionId: () => "session", getSessionFile: () => "/session.jsonl" },
        ui: { notify() {}, setStatus() {}, select: async () => undefined },
    } as unknown as ExtensionContext;
    return {
        pi, ctx, handlers, commands, shortcuts, entries, events,
        activeTools: () => activeTools, thinking: () => thinking,
        forceActiveTools: (names: string[]) => { activeTools = [...names]; },
        failModel: () => { modelSucceeds = false; }, passModel: () => { modelSucceeds = true; },
    };
}

test("profile extension applies CLI, guards tools, restores branches, and emits only successful applies", async () => {
    const { profilePath } = await fixture();
    const fake = fakeControllerPi("scout");
    registerProfileController(fake.pi, profilePath);
    await fake.handlers.session_start![0]!({ reason: "startup" }, fake.ctx);

    assert.deepEqual(fake.activeTools(), ["read", "subagent_start", "subagent_get", "subagent_wait"]);
    assert.equal(fake.thinking(), "low");
    assert.equal(fake.events.length, 1);
    assert.deepEqual((fake.events[0]!.payload as any).profile.extensions.subagent.allowedTargets, ["scout"]);
    assert.equal((fake.events[0]!.payload as any).reason, "startup");
    assert.deepEqual(fake.commands.profile!.getArgumentCompletions?.("sc"), [
        { value: "scout", label: "scout", description: "Read-only exploration." },
    ]);
    assert.deepEqual(fake.handlers.tool_call![0]!({ toolName: "bash" }, fake.ctx), { block: true, reason: "Tool bash is not allowed by profile scout" });
    const patch = await fake.handlers.before_agent_start![0]!({ systemPrompt: "base" }, fake.ctx);
    assert.equal(patch.systemPrompt, "base\n\nScout only.");

    fake.failModel();
    await fake.commands.profile!.handler("full", fake.ctx);
    assert.equal(fake.events.length, 1);
    fake.passModel();
    await fake.shortcuts["shift+tab"]!.handler(fake.ctx);
    assert.equal(fake.events.length, 2);
    assert.equal((fake.events.at(-1)!.payload as any).reason, "switch");

    fake.entries.push({ type: "custom", customType: "agent-profile-state", data: { name: "scout" } });
    await fake.handlers.session_tree![0]!({}, fake.ctx);
    assert.equal((fake.events.at(-1)!.payload as any).reason, "restore");
});

test("active-profile event wrapper validates the complete payload", () => {
    let eventHandler: ((value: unknown) => void) | undefined;
    const pi = {
        events: {
            on(name: string, handler: (value: unknown) => void) {
                assert.equal(name, ACTIVE_PROFILE_EVENT);
                eventHandler = handler;
            },
        },
    } as unknown as ExtensionAPI;
    const accepted: unknown[] = [];
    const errors: string[] = [];
    onActiveProfile(pi, event => accepted.push(event), error => errors.push(error.message));

    eventHandler!({ schemaVersion: 1, name: "scout", reason: "startup", profile: profiles().profiles.scout });
    eventHandler!({ schemaVersion: 1, name: "scout", reason: "startup", profile: { model: "provider/model" } });
    eventHandler!({ schemaVersion: 99, name: "scout", reason: "startup", profile: profiles().profiles.scout });
    eventHandler!({ schemaVersion: 1, name: "scout", reason: "startup", profile: profiles().profiles.scout, unexpected: true });

    assert.equal(accepted.length, 1);
    assert.match(errors[0] ?? "", /allowAllTools|unknown keys|extensions/);
    assert.match(errors[1] ?? "", /schemaVersion/);
    assert.match(errors[2] ?? "", /unknown keys/);
});

test("resolved child profile overlays the generic profile snapshot", async () => {
    const { profilePath } = await fixture();
    const pinned = {
        model: "provider/pinned", description: "Pinned exploration.", thinkingLevel: "low" as const, allowAllTools: false,
        tools: ["read"], instructions: "pinned", extensions: { subagent: { allowedTargets: ["scout"] } },
    };
    const loaded = await loadAgentProfileConfig(profilePath, {
        PI_AGENT_RESOLVED_PROFILE: JSON.stringify({ name: "scout", profile: pinned }),
    });
    assert.deepEqual(loaded.profiles.scout, pinned);
    assert.equal(loaded.profiles.full!.allowAllTools, true);
});

function toolContext(root: string): ExtensionContext {
    return { cwd: root, sessionManager: { getSessionId: () => "session", getSessionFile: () => join(root, "session.jsonl") } } as ExtensionContext;
}

test("subagent routing catalog exposes only active allowed targets in the model-facing prompt", async () => {
    const value = await fixture();
    const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
    const eventHandlers: Record<string, Array<(value: unknown) => void>> = {};
    const pi = {
        registerTool() {}, registerCommand() {},
        on(name: string, handler: any) { (handlers[name] ??= []).push(handler); },
        events: {
            on(name: string, handler: (value: unknown) => void) { (eventHandlers[name] ??= []).push(handler); return () => {}; },
            emit(name: string, value: unknown) { for (const handler of eventHandlers[name] ?? []) handler(value); },
        },
        getActiveTools: () => ["subagent_start"],
        async exec() { return { stdout: "$0\tmain\t%1\n", stderr: "", code: 0, killed: false }; },
    } as unknown as ExtensionAPI;
    assert.equal(await registerSubagent(pi, { configPath: value.subagentPath, profileConfigPath: value.profilePath, env: { TMUX: "yes" } }), true);
    eventHandlers[ACTIVE_PROFILE_EVENT]![0]!({ schemaVersion: 1, name: "scout", reason: "startup", profile: value.profileConfig.profiles.scout });
    const patch = await handlers.before_agent_start![0]!({ systemPrompt: "base" }, {});
    assert.match(patch.systemPrompt, /Available subagent routing profiles:/);
    assert.match(patch.systemPrompt, /scout: Read-only exploration\./);
    assert.doesNotMatch(patch.systemPrompt, /full: Broad coding work/);
});

test("delegation fails closed and rejects policy or depth before resource allocation", async () => {
    const fixtureValue = await fixture();
    let execCalls = 0;
    const exec = async () => { execCalls += 1; return { stdout: "$0\tmain\t%1\n", stderr: "", code: 0 }; };
    const base = { configPath: fixtureValue.subagentPath, profileConfigPath: fixtureValue.profilePath, env: { TMUX: "yes" }, exec };

    await assert.rejects(createSubagentStartTool(base).execute("call", { profile: "scout", purpose: "Policy task", prompt: "task" }, undefined, undefined, toolContext(fixtureValue.root)), /no active-profile event/);
    await assert.rejects(createSubagentStartTool({ ...base, activeProfile: () => ({ name: "scout", error: "malformed facet" }) }).execute("call", { profile: "scout", purpose: "Policy task", prompt: "task" }, undefined, undefined, toolContext(fixtureValue.root)), /malformed facet/);
    await assert.rejects(createSubagentStartTool({ ...base, activeProfile: () => ({ name: "scout", facet: { allowedTargets: ["scout"] } }) }).execute("call", { profile: "full", purpose: "Policy task", prompt: "task" }, undefined, undefined, toolContext(fixtureValue.root)), /not allowed/);
    await assert.rejects(createSubagentStartTool({ ...base, env: { TMUX: "yes", PI_SUBAGENT_DEPTH: "3" }, activeProfile: () => ({ name: "full", facet: { allowedTargets: ["scout"] } }) }).execute("call", { profile: "scout", purpose: "Policy task", prompt: "task" }, undefined, undefined, toolContext(fixtureValue.root)), /exceeds maxDepth/);
    await assert.rejects(access(fixtureValue.subagentConfig.stateRoot));
    assert.equal(execCalls, 0);
});
