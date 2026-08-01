import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadAgentProfileConfig, registerProfileController, routedProfileForInput } from "../extensions_src/profile.ts";
import { createSubagentSubmitTool, registerSubagent } from "../extensions_src/subagent.ts";
import { ACTIVE_PROFILE_EVENT, onActiveProfile } from "../extensions_src/utilities/profile_events.ts";
import { validateProfileConfig, type AgentProfileConfig } from "../extensions_src/utilities/profile_types.ts";
import { validateSubagentRuntimeConfig, type SubagentRuntimeConfig } from "../extensions_src/utilities/subagent_types.ts";

function profiles(): AgentProfileConfig {
    return {
        schemaVersion: 3,
        defaultProfile: "full",
        profileCycle: ["scout", "artisan", "operator", "full"],
        promptRoutes: { act: "artisan", impl: "full", operate: "operator", review: "scout" },
        profiles: {
            scout: {
                model: "provider/model", availability: ["top-level", "subagent"] as ("top-level" | "subagent")[], description: "Read-only exploration.", thinkingLevel: "low", allowAllTools: false,
                tools: ["read", "subagent_submit", "subagent_get", "subagent_wait"], instructions: "Scout only.",
                extensions: { subagent: { allowedTargets: ["scout"] } },
            },
            artisan: {
                model: "provider/model", availability: ["top-level"] as ("top-level" | "subagent")[], description: "Bounded implementation.", thinkingLevel: "xhigh", allowAllTools: false,
                tools: ["read", "bash", "edit", "write", "save_agent_artifact", "subagent_submit", "subagent_get", "subagent_wait", "subagent_stop"], instructions: "Implement and validate directly.",
                extensions: { subagent: { allowedTargets: ["focused-reviewer"] } },
            },
            operator: {
                model: "provider/model", availability: ["top-level", "subagent"] as ("top-level" | "subagent")[], description: "Delegated assurance.", thinkingLevel: "medium", allowAllTools: false,
                tools: ["read", "subagent_submit", "subagent_get", "subagent_wait"], instructions: "Operate.",
                extensions: { subagent: { allowedTargets: ["scout"] } },
            },
            "focused-reviewer": {
                model: "provider/model", availability: ["subagent"] as ("top-level" | "subagent")[], description: "Focused review.", thinkingLevel: "medium", allowAllTools: false,
                tools: ["read", "grep", "find", "ls", "bash"], instructions: "Review one lens.",
                extensions: { subagent: { allowedTargets: [] } },
            },
            full: {
                model: "provider/model", availability: ["top-level", "subagent"] as ("top-level" | "subagent")[], description: "Broad coding work.", thinkingLevel: "medium", allowAllTools: true, tools: [],
                extensions: { subagent: { allowedTargets: ["scout", "full"] } },
            },
        },
    };
}

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "agent-profile-"));
    const profileConfig = profiles();
    const subagentConfig: SubagentRuntimeConfig = {
        schemaVersion: 7,
        stateRoot: join(root, "state"),
        tmux: "/tmux",
        historyViewerExtension: "/history-viewer.ts",
        childExtensions: ["/profile.ts", "/subagent.ts", "/bridge.ts"],
        harnesses: { pi: { adapter: "pi-native", command: "/pi" } },
        maxDepth: 3,
        childExcludedTools: ["question"],
        natureHandleWords: ["Maple", "Cedar"],
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
    const notifications: string[] = [];
    let activeTools: string[] = [];
    let thinking = "off";
    let modelSucceeds = true;
    let toolApplicationFails = false;
    let activeToolApplications = 0;
    let allTools = ["read", "bash", "edit", "write", "save_agent_artifact", "subagent_submit", "subagent_get", "subagent_wait", "subagent_stop", "project_tool"];
    const pi = {
        registerFlag() {}, getFlag: () => flag,
        registerCommand(name: string, value: any) { commands[name] = value; },
        registerShortcut(key: string, value: any) { shortcuts[key] = value; },
        on(name: string, handler: any) { (handlers[name] ??= []).push(handler); },
        events: { on() {}, emit(name: string, payload: unknown) { events.push({ name, payload }); } },
        getAllTools: () => allTools.map(name => ({ name })), getActiveTools: () => activeTools,
        setActiveTools(names: string[]) {
            activeToolApplications += 1;
            if (toolApplicationFails) {
                toolApplicationFails = false;
                activeTools = [...names];
                throw new Error("injected tool application failure");
            }
            activeTools = [...names];
        },
        async setModel() { return modelSucceeds; }, getThinkingLevel: () => thinking, setThinkingLevel(value: string) { thinking = value; },
        appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
    } as unknown as ExtensionAPI;
    const ctx = {
        cwd: "/work", hasUI: true, isIdle: () => true,
        modelRegistry: { find: () => ({ provider: "provider", id: "model" }) },
        sessionManager: { getBranch: () => entries, getEntries: () => entries, getSessionId: () => "session", getSessionFile: () => "/session.jsonl" },
        ui: { notify(message: string) { notifications.push(message); }, setStatus() {}, select: async () => undefined },
    } as unknown as ExtensionContext;
    return {
        pi, ctx, handlers, commands, shortcuts, entries, events, notifications,
        activeTools: () => activeTools, activeToolApplications: () => activeToolApplications, thinking: () => thinking,
        forceActiveTools: (names: string[]) => { activeTools = [...names]; },
        forceAllTools: (names: string[]) => { allTools = [...names]; },
        failModel: () => { modelSucceeds = false; }, passModel: () => { modelSucceeds = true; },
        failNextToolApplication: () => { toolApplicationFails = true; },
    };
}

void test("profile extension applies CLI, guards tools, restores branches, and emits only successful applies", async () => {
    const { profilePath } = await fixture();
    const fake = fakeControllerPi("scout");
    registerProfileController(fake.pi, profilePath, {});
    await fake.handlers.session_start![0]!({ reason: "startup" }, fake.ctx);

    assert.deepEqual(fake.activeTools(), ["read", "subagent_submit", "subagent_get", "subagent_wait"]);
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

void test("active tool synchronization is ordered, idempotent, and recovers drift", async () => {
    const { profilePath } = await fixture();
    const fake = fakeControllerPi("scout");
    registerProfileController(fake.pi, profilePath, {});
    await fake.handlers.session_start![0]!({ reason: "startup" }, fake.ctx);

    const scoutTools = ["read", "subagent_submit", "subagent_get", "subagent_wait"];
    assert.equal(fake.activeToolApplications(), 1);
    assert.deepEqual(await fake.handlers.input![0]!({ text: "ordinary text", source: "interactive" }, fake.ctx), { action: "continue" });
    await fake.handlers.before_agent_start![0]!({ systemPrompt: "base" }, fake.ctx);
    assert.equal(fake.activeToolApplications(), 1);

    for (const drift of [
        scoutTools.slice(0, -1),
        [...scoutTools, "bash"],
        [scoutTools[1]!, scoutTools[0]!, ...scoutTools.slice(2)],
    ]) {
        fake.forceActiveTools(drift);
        assert.deepEqual(await fake.handlers.input![0]!({ text: "ordinary text", source: "interactive" }, fake.ctx), { action: "continue" });
        assert.deepEqual(fake.activeTools(), scoutTools);
    }
    assert.equal(fake.activeToolApplications(), 4);

    await fake.commands.profile!.handler("full", fake.ctx);
    assert.equal(fake.activeToolApplications(), 5);
    const expandedTools = [...fake.activeTools(), "dynamic_tool"];
    fake.forceAllTools(expandedTools);
    await fake.handlers.before_agent_start![0]!({ systemPrompt: "base" }, fake.ctx);
    assert.deepEqual(fake.activeTools(), expandedTools);
    assert.equal(fake.activeToolApplications(), 6);
    await fake.handlers.before_agent_start![0]!({ systemPrompt: "base" }, fake.ctx);
    assert.equal(fake.activeToolApplications(), 6);
});

void test("artisan profile wiring is top-level-only and delegates only focused review", async () => {
    const [profileNix, subagentNix, artifactNix] = await Promise.all([
        readFile(join(import.meta.dirname, "..", "extensions", "profile", "default.nix"), "utf8"),
        readFile(join(import.meta.dirname, "..", "extensions", "subagent", "default.nix"), "utf8"),
        readFile(join(import.meta.dirname, "..", "extensions", "agent_artifact", "default.nix"), "utf8"),
    ]);
    const artisanStart = profileNix.indexOf("        artisan = {");
    const artisan = profileNix.slice(artisanStart, profileNix.indexOf("        scout = {", artisanStart));
    const subagentStart = subagentNix.indexOf("      artisan = {");
    const subagent = subagentNix.slice(subagentStart, subagentNix.indexOf("      operator = {", subagentStart));

    assert.match(profileNix, /profileCycle = listOfOption str \["scout" "taskmaster" "artisan"/);
    assert.match(profileNix, /act = "artisan"/);
    assert.match(artisan, /model = "openai-codex\/gpt-5\.6-luna"/);
    assert.match(artisan, /availability = \["top-level"\]/);
    assert.match(artisan, /thinkingLevel = "xhigh"/);
    assert.match(artisan, /tools = \["write" "edit"\]/);
    assert.match(subagent, /allowedTargets = \["focused-reviewer"\]/);
    assert.doesNotMatch(subagent, /tester|taskmaster|cursor-implementer|review-orchestrator/);
    assert.match(artifactNix, /artisan\.tools = \["save_agent_artifact"\]/);
});

void test("exact raw prompt commands route transactionally before expansion", async () => {
    const { profilePath, profileConfig } = await fixture();
    const fake = fakeControllerPi("scout");
    registerProfileController(fake.pi, profilePath, {});
    await fake.handlers.session_start![0]!({ reason: "startup" }, fake.ctx);

    for (const text of ["/act", "/act change this", "/act\ncontext"]) {
        assert.equal(routedProfileForInput(profileConfig, text), "artisan");
    }
    for (const text of ["/impl", "/impl approved.md", "/impl\ncontext"]) {
        assert.equal(routedProfileForInput(profileConfig, text), "full");
    }
    for (const text of ["/operate", "/operate approved.md", "/operate\ncontext"]) {
        assert.equal(routedProfileForInput(profileConfig, text), "operator");
    }
    for (const text of ["/action", "/act-extra", "/act/path", "/implementation", "/impl-extra", "/impl/path", "/operate-extra", "/skill:impl", "run /impl", "/unknown", "ordinary text"]) {
        assert.equal(routedProfileForInput(profileConfig, text), undefined);
        assert.deepEqual(await fake.handlers.input![0]!({ text, source: "interactive" }, fake.ctx), { action: "continue" });
    }

    assert.deepEqual(await fake.handlers.input![0]!({ text: "/impl approved.md", source: "interactive" }, fake.ctx), { action: "continue" });
    assert.equal((fake.events.at(-1)!.payload as any).reason, "route");
    assert.equal(fake.entries.at(-1)?.data.name, "full");

    fake.failModel();
    assert.deepEqual(await fake.handlers.input![0]!({ text: "/review report.md", source: "interactive" }, fake.ctx), { action: "handled" });
    assert.match(fake.notifications.at(-1) ?? "", /no authentication/);
    assert.equal(fake.entries.at(-1)?.data.name, "full");

    fake.passModel();
    fake.failNextToolApplication();
    const toolsBeforeFailure = fake.activeTools();
    const thinkingBeforeFailure = fake.thinking();
    assert.deepEqual(await fake.handlers.input![0]!({ text: "/review report.md", source: "interactive" }, fake.ctx), { action: "handled" });
    assert.match(fake.notifications.at(-1) ?? "", /injected tool application failure/);
    assert.deepEqual(fake.activeTools(), toolsBeforeFailure);
    assert.equal(fake.thinking(), thinkingBeforeFailure);
    assert.equal(fake.entries.at(-1)?.data.name, "full");
});

void test("active-profile event wrapper validates the complete payload", () => {
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
    assert.match(errors[0] ?? "", /availability|allowAllTools|unknown keys|extensions/);
    assert.match(errors[1] ?? "", /schemaVersion/);
    assert.match(errors[2] ?? "", /unknown keys/);
});

void test("profile availability gates parent selection and old runtime schemas are rejected", async () => {
    const value = await fixture();
    const config = value.profileConfig;
    config.profiles.child = {
        model: "provider/model", availability: ["subagent"], description: "Child only.", allowAllTools: false, tools: ["read"], extensions: { subagent: { allowedTargets: [] } },
    };
    await writeFile(value.profilePath, JSON.stringify(config));
    const fake = fakeControllerPi("scout");
    registerProfileController(fake.pi, value.profilePath, {});
    await fake.handlers.session_start![0]!({ reason: "startup" }, fake.ctx);
    assert.equal((fake.commands.profile!.getArgumentCompletions?.("ch") as unknown[] | null), null);
    await fake.commands.profile!.handler("child", fake.ctx);
    assert.match(fake.notifications.at(-1) ?? "", /Unknown top-level profile/u);
    assert.throws(() => validateProfileConfig({ ...config, schemaVersion: 2 }), /schemaVersion/u);
    assert.throws(() => validateProfileConfig({ ...config, defaultProfile: "child" }), /top-level/u);
    assert.throws(() => validateSubagentRuntimeConfig({ ...value.subagentConfig, schemaVersion: 6 }), /schemaVersion/u);
});

void test("resolved child profile overlays the generic profile snapshot", async () => {
    const { profilePath } = await fixture();
    const pinned = {
        model: "provider/pinned", availability: ["subagent"] as ("top-level" | "subagent")[], description: "Pinned exploration.", thinkingLevel: "low" as const, allowAllTools: false,
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

void test("subagent_submit schema enum follows active allowed targets without a prompt catalog", async () => {
    const value = await fixture();
    const tools: Array<{ name: string; parameters: { properties?: { profile?: { enum?: string[]; description?: string } } } }> = [];
    const eventHandlers: Record<string, Array<(value: unknown) => void>> = {};
    const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
    const pi = {
        registerTool(tool: { name: string; parameters: { properties?: { profile?: { enum?: string[]; description?: string } } } }) {
            const index = tools.findIndex(item => item.name === tool.name);
            if (index >= 0) tools[index] = tool; else tools.push(tool);
        },
        registerCommand() {},
        on(name: string, handler: any) { (handlers[name] ??= []).push(handler); },
        events: {
            on(name: string, handler: (value: unknown) => void) { (eventHandlers[name] ??= []).push(handler); return () => {}; },
            emit(name: string, value: unknown) { for (const handler of eventHandlers[name] ?? []) handler(value); },
        },
        getActiveTools: () => ["subagent_submit"],
        async exec() { return { stdout: "123\t$0\tmain\t%1\n", stderr: "", code: 0, killed: false }; },
    } as unknown as ExtensionAPI;
    assert.equal(await registerSubagent(pi, { configPath: value.subagentPath, profileConfigPath: value.profilePath, env: { TMUX: "yes" } }), true);
    assert.deepEqual(tools.map(tool => tool.name).sort(), ["subagent_get", "subagent_stop", "subagent_submit", "subagent_wait"]);
    assert.deepEqual(tools.find(tool => tool.name === "subagent_submit")?.parameters.properties?.profile?.enum, []);
    eventHandlers[ACTIVE_PROFILE_EVENT]![0]!({
        schemaVersion: 1,
        name: "review-orchestrator",
        reason: "startup",
        profile: {
            model: "provider/model",
            availability: ["subagent"] as ("top-level" | "subagent")[],
            description: "Review orchestration.",
            thinkingLevel: "medium",
            allowAllTools: false,
            tools: ["subagent_submit"],
            extensions: { subagent: { allowedTargets: ["focused-reviewer", "dissent-reviewer"] } },
        },
    });
    const submit = tools.find(tool => tool.name === "subagent_submit");
    assert.deepEqual(submit?.parameters.properties?.profile?.enum, ["focused-reviewer", "dissent-reviewer"]);
    assert.match(submit?.parameters.properties?.profile?.description ?? "", /focused-reviewer, dissent-reviewer/);
    assert.equal(handlers.before_agent_start, undefined);
});

void test("delegation fails closed and rejects policy or depth before resource allocation", async () => {
    const fixtureValue = await fixture();
    let execCalls = 0;
    const exec = async () => { execCalls += 1; return { stdout: "$0\tmain\t%1\n", stderr: "", code: 0 }; };
    const base = { configPath: fixtureValue.subagentPath, profileConfigPath: fixtureValue.profilePath, env: { TMUX: "yes" }, exec };

    await assert.rejects(createSubagentSubmitTool(base).execute("call", { purpose: "Policy task", prompt: "task" }, undefined, undefined, toolContext(fixtureValue.root)), /exactly one of profile or agentId/);
    await assert.rejects(createSubagentSubmitTool(base).execute("call", { profile: "scout", agentId: "550e8400-e29b-41d4-a716-446655440000", purpose: "Policy task", prompt: "task" }, undefined, undefined, toolContext(fixtureValue.root)), /exactly one of profile or agentId/);
    await assert.rejects(createSubagentSubmitTool(base).execute("call", { profile: "scout", purpose: "Policy task", prompt: "task" }, undefined, undefined, toolContext(fixtureValue.root)), /no active-profile event/);
    await assert.rejects(createSubagentSubmitTool({ ...base, activeProfile: () => ({ name: "scout", error: "malformed facet" }) }).execute("call", { profile: "scout", purpose: "Policy task", prompt: "task" }, undefined, undefined, toolContext(fixtureValue.root)), /malformed facet/);
    await assert.rejects(createSubagentSubmitTool({ ...base, activeProfile: () => ({ name: "scout", facet: { allowedTargets: ["scout"] } }) }).execute("call", { profile: "full", purpose: "Policy task", prompt: "task" }, undefined, undefined, toolContext(fixtureValue.root)), /not allowed/);
    await assert.rejects(createSubagentSubmitTool({ ...base, env: { TMUX: "yes", PI_SUBAGENT_DEPTH: "3" }, activeProfile: () => ({ name: "full", facet: { allowedTargets: ["scout"] } }) }).execute("call", { profile: "scout", purpose: "Policy task", prompt: "task" }, undefined, undefined, toolContext(fixtureValue.root)), /exceeds maxDepth/);
    await assert.rejects(createSubagentSubmitTool({ ...base, activeProfile: () => ({ name: "full", facet: { allowedTargets: ["full"] } }) }).execute("call", { profile: "full", purpose: "Policy task", prompt: "task" }, undefined, undefined, toolContext(fixtureValue.root)), /allowAllTools/);
    await assert.rejects(access(fixtureValue.subagentConfig.stateRoot));
    assert.equal(execCalls, 0);
});

void test("child effective profile drops excluded tools from snapshot and launch descriptor", async () => {
    const { projectChildEffectiveProfile } = await import("../extensions_src/utilities/subagent_types.ts");
    const { piLaunchDescriptor } = await import("../extensions_src/utilities/subagent_pi.ts");
    const profile = {
        model: "provider/model",
        availability: ["subagent"] as ("top-level" | "subagent")[],
        description: "Review orchestration.",
        thinkingLevel: "medium" as const,
        allowAllTools: false,
        tools: ["read", "question", "subagent_submit", "subagent_get"],
        instructions: "orchestrate",
        extensions: { subagent: { allowedTargets: ["focused-reviewer"] } },
    };
    const effective = projectChildEffectiveProfile(profile, ["question"]);
    assert.deepEqual(effective.tools, ["read", "subagent_submit", "subagent_get"]);
    assert.ok(!effective.tools.includes("question"));
    const launch = piLaunchDescriptor({
        schemaVersion: 7,
        stateRoot: "/state",
        tmux: "/tmux",
        historyViewerExtension: "/history.ts",
        childExtensions: ["/profile.ts"],
        harnesses: { pi: { adapter: "pi-native", command: "/pi" } },
        maxDepth: 3,
        childExcludedTools: ["question"],
        natureHandleWords: ["Maple", "Cedar"],
    }, {
        agentId: "a",
        agentDirectory: "/state/agents/a",
        profile: "review-orchestrator",
        profileSnapshot: effective,
        depth: 1,
        originSessionId: "origin",
    });
    const toolsArg = launch.args[launch.args.indexOf("--tools") + 1];
    assert.equal(toolsArg, "read,subagent_submit,subagent_get");
    assert.doesNotMatch(toolsArg ?? "", /question/);
    const resolved = JSON.parse(launch.env.PI_AGENT_RESOLVED_PROFILE!);
    assert.deepEqual(resolved.profile.tools, ["read", "subagent_submit", "subagent_get"]);
});

void test("resolved child profile does not fall back to the default profile on apply failure", async () => {
    const restrictive = await fixture();
    const profileConfig = restrictive.profileConfig;
    profileConfig.profiles.scout = {
        ...profileConfig.profiles.scout!,
        tools: ["read", "question", "subagent_submit"],
    };
    await writeFile(restrictive.profilePath, JSON.stringify(profileConfig));
    const childFake = fakeControllerPi("scout");
    const available = ["read", "bash", "edit", "write", "subagent_submit", "subagent_get", "subagent_wait", "project_tool"];
    (childFake.pi as any).getAllTools = () => available.filter(name => name !== "question").map((name: string) => ({ name }));
    registerProfileController(childFake.pi, restrictive.profilePath, {
        PI_AGENT_RESOLVED_PROFILE: JSON.stringify({ name: "scout", profile: profileConfig.profiles.scout }),
    });
    await childFake.handlers.session_start![0]!({ reason: "startup" }, childFake.ctx);
    assert.equal(childFake.events.length, 0);
    assert.deepEqual(childFake.entries.filter((entry: { customType?: string }) => entry.customType === "agent-profile-state"), []);
});
