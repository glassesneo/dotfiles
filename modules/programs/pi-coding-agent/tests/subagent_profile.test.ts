import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadAgentProfileConfig, registerProfileController, routedProfileForInput } from "../extensions_src/profile.ts";
import { createSubagentRunTool, createSubagentSubmitTool, registerSubagent } from "../extensions_src/subagent.ts";
import { ACTIVE_PROFILE_EVENT, onActiveProfile } from "../extensions_src/utilities/profile_events.ts";
import { validateProfileConfig, type AgentProfileConfig } from "../extensions_src/utilities/profile_types.ts";
import { validateSubagentRuntimeConfig, type SubagentRuntimeConfig } from "../extensions_src/utilities/subagent_types.ts";

function profiles(): AgentProfileConfig {
    return {
        schemaVersion: 5,
        defaultProfile: "full",
        profileCycle: ["scout", "artisan", "operator", "full"],
        promptRoutes: { act: "artisan", impl: "full", operate: "operator", review: "scout" },
        profiles: {
            scout: {
                id: "11111111-1111-4111-8111-111111111111", model: "provider/model", availability: ["top-level", "subagent"] as ("top-level" | "subagent")[], description: "Read-only exploration.", thinkingLevel: "low", allowAllTools: false,
                tools: ["read", "subagent_run", "subagent_submit", "subagent_get", "subagent_wait"], hiddenSkillOptIns: ["agent-artifact"], instructions: "Scout only.",
                extensions: { subagent: { allowedTargets: ["scout"] } },
            },
            artisan: {
                id: "22222222-2222-4222-8222-222222222222", model: "provider/model", availability: ["top-level"] as ("top-level" | "subagent")[], description: "Bounded implementation.", thinkingLevel: "xhigh", allowAllTools: false,
                tools: ["read", "bash", "edit", "write", "save_agent_artifact", "subagent_run", "subagent_submit", "subagent_get", "subagent_wait", "subagent_stop"], hiddenSkillOptIns: ["agent-artifact"], instructions: "Implement and validate directly.",
                extensions: { subagent: { allowedTargets: ["focused-reviewer"] } },
            },
            operator: {
                id: "33333333-3333-4333-8333-333333333333", model: "provider/model", availability: ["top-level", "subagent"] as ("top-level" | "subagent")[], description: "Delegated assurance.", thinkingLevel: "medium", allowAllTools: false,
                tools: ["read", "subagent_run", "subagent_submit", "subagent_get", "subagent_wait"], hiddenSkillOptIns: [], instructions: "Operate.",
                extensions: { subagent: { allowedTargets: ["scout"] } },
            },
            "session-parent": {
                id: "66666666-6666-4666-8666-666666666667", model: "provider/model", availability: ["top-level", "subagent"] as ("top-level" | "subagent")[], description: "Existing-agent delegation only.", thinkingLevel: "medium", allowAllTools: false,
                tools: ["read", "subagent_run", "subagent_submit"], hiddenSkillOptIns: [], instructions: "Reuse agents.",
                extensions: { subagent: { allowedTargets: [] } },
            },
            "focused-reviewer": {
                id: "44444444-4444-4444-8444-444444444444", model: "provider/model", availability: ["subagent"] as ("top-level" | "subagent")[], description: "Focused review.", thinkingLevel: "medium", allowAllTools: false,
                tools: ["read", "grep", "find", "ls", "bash"], hiddenSkillOptIns: [], instructions: "Review one lens.",
                extensions: { subagent: { allowedTargets: [] } },
            },
            full: {
                id: "55555555-5555-4555-8555-555555555555", model: "provider/model", availability: ["top-level", "subagent"] as ("top-level" | "subagent")[], description: "Broad coding work.", thinkingLevel: "medium", allowAllTools: true, tools: [], hiddenSkillOptIns: [],
                extensions: { subagent: { allowedTargets: ["scout", "full"] } },
            },
        },
    };
}

function visibleSkills(...names: string[]) {
    return names.map(name => ({ name, disableModelInvocation: false }));
}

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "agent-profile-"));
    const profileConfig = profiles();
    const subagentConfig: SubagentRuntimeConfig = {
        schemaVersion: 8,
        stateRoot: join(root, "state"),
        tmux: "/tmux",
        returnParentCommand: "/return-parent",
        parentNavigationHint: "F12 U: parent · /parent",
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
    const paletteContributions: any[] = [];
    const eventHandlers: Record<string, Array<(value: unknown) => void>> = {};
    const notifications: string[] = [];
    const statuses: Array<{ key: string; text: string }> = [];
    let activeTools: string[] = [];
    let aborts = 0;
    let thinking = "off";
    let modelSucceeds = true;
    let toolApplicationFails = false;
    let activeToolApplications = 0;
    let allTools = ["read", "bash", "edit", "write", "save_agent_artifact", "subagent_run", "subagent_submit", "subagent_get", "subagent_wait", "subagent_stop", "project_tool"];
    let discoveredSkills = ["agent-artifact", "codebase-exploration", "source-implementation", "implementation-validation", "adaptive-review", "implementation-lifecycle"];
    const pi = {
        registerFlag() {}, getFlag: () => flag,
        registerCommand(name: string, value: any) { commands[name] = value; },
        registerShortcut(key: string, value: any) { shortcuts[key] = value; },
        on(name: string, handler: any) { (handlers[name] ??= []).push(handler); },
        events: {
            on(name: string, handler: (value: unknown) => void) { (eventHandlers[name] ??= []).push(handler); return () => {}; },
            emit(name: string, payload: unknown) {
                if (name === ACTIVE_PROFILE_EVENT) events.push({ name, payload });
                if (name === "command-palette:register") paletteContributions.push(payload);
                for (const handler of eventHandlers[name] ?? []) handler(payload);
            },
        },
        getAllTools: () => allTools.map(name => ({ name })), getActiveTools: () => activeTools,
        getCommands: () => discoveredSkills.map(name => ({ name: `skill:${name}`, source: "skill", sourceInfo: { path: `/skills/${name}/SKILL.md`, source: "skill", scope: "user", origin: "top-level" } })),
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
        ui: { notify(message: string) { notifications.push(message); }, setStatus(key: string, text: string) { statuses.push({ key, text }); }, select: async () => undefined },
        abort() { aborts += 1; },
    } as unknown as ExtensionContext;
    return {
        pi, ctx, handlers, commands, shortcuts, entries, events, paletteContributions, notifications, statuses,
        activeTools: () => activeTools, activeToolApplications: () => activeToolApplications, aborts: () => aborts, thinking: () => thinking,
        forceActiveTools: (names: string[]) => { activeTools = [...names]; },
        forceAllTools: (names: string[]) => { allTools = [...names]; },
        forceDiscoveredSkills: (names: string[]) => { discoveredSkills = [...names]; },
        failModel: () => { modelSucceeds = false; }, passModel: () => { modelSucceeds = true; },
        failNextToolApplication: () => { toolApplicationFails = true; },
    };
}

void test("profile extension applies CLI, guards tools, restores branches, and emits only successful applies", async () => {
    const { profilePath } = await fixture();
    const fake = fakeControllerPi("scout");
    registerProfileController(fake.pi, profilePath, {});
    await fake.handlers.session_start![0]!({ reason: "startup" }, fake.ctx);

    assert.deepEqual(fake.activeTools(), ["read", "subagent_run", "subagent_submit", "subagent_get", "subagent_wait"]);
    assert.equal(fake.thinking(), "low");
    assert.equal(fake.events.length, 1);
    assert.deepEqual((fake.events[0]!.payload as any).profile.extensions.subagent.allowedTargets, ["scout"]);
    assert.equal((fake.events[0]!.payload as any).reason, "startup");
    assert.deepEqual(fake.statuses.at(-1), { key: "agent-profile-identity", text: "PARENT · profile:scout" });
    assert.deepEqual(fake.commands.profile!.getArgumentCompletions?.("sc"), [
        { value: "scout", label: "scout", description: "Read-only exploration." },
    ]);
    assert.deepEqual(fake.handlers.tool_call![0]!({ toolName: "bash" }, fake.ctx), { block: true, reason: "Tool bash is not allowed by profile scout" });
    const patch = await fake.handlers.before_agent_start![0]!({ systemPrompt: "base", systemPromptOptions: { skills: visibleSkills("agent-artifact") } }, fake.ctx);
    assert.equal(patch.systemPrompt, "base\n\nScout only.");

    fake.failModel();
    await fake.commands.profile!.handler("full", fake.ctx);
    assert.equal(fake.events.length, 1);
    fake.passModel();
    assert.equal(fake.shortcuts["shift+tab"], undefined);
    await fake.commands.profile!.handler("full", fake.ctx);
    assert.equal(fake.events.length, 2);
    assert.equal((fake.events.at(-1)!.payload as any).reason, "switch");

    fake.entries.push({ type: "custom", customType: "agent-profile-state", data: { schemaVersion: 2, profileId: "11111111-1111-4111-8111-111111111111" } });
    await fake.handlers.session_tree![0]!({}, fake.ctx);
    assert.equal((fake.events.at(-1)!.payload as any).reason, "restore");
});

void test("profile appends only configured hidden skills in Pi native metadata format", async () => {
    const { profilePath } = await fixture();
    const fake = fakeControllerPi("scout");
    registerProfileController(fake.pi, profilePath, {});
    await fake.handlers.session_start![0]!({ reason: "startup" }, fake.ctx);

    const skill = (name: string, disableModelInvocation: boolean, description: string) => ({
        name,
        description,
        filePath: `/skills/${name}/SKILL.md`,
        baseDir: `/skills/${name}`,
        source: "test",
        disableModelInvocation,
    });
    const patch = await fake.handlers.before_agent_start![0]!({
        systemPrompt: "base-visible-skill <name>ordinary-visible</name>",
        systemPromptOptions: {
            skills: [
                skill("ordinary-visible", false, "ordinary visible description"),
                skill("agent-artifact", true, "artifact metadata only"),
                skill("unconfigured-hidden", true, "must stay hidden"),
            ],
        },
    }, fake.ctx);

    assert.match(patch.systemPrompt, /^base-visible-skill <name>ordinary-visible<\/name>/);
    assert.match(patch.systemPrompt, /<name>agent-artifact<\/name>/);
    assert.match(patch.systemPrompt, /artifact metadata only/);
    assert.match(patch.systemPrompt, /\/skills\/agent-artifact\/SKILL\.md/);
    assert.doesNotMatch(patch.systemPrompt, /unconfigured-hidden|must stay hidden|ordinary visible description/);
    assert.doesNotMatch(patch.systemPrompt, /# Agent Artifact|full skill body/);
    assert.match(patch.systemPrompt, /Scout only\.$/);

    const alreadyVisible = await fake.handlers.before_agent_start![0]!({
        systemPrompt: "base already has <name>agent-artifact</name>",
        systemPromptOptions: { skills: [skill("agent-artifact", false, "already visible metadata")] },
    }, fake.ctx);
    assert.equal(alreadyVisible.systemPrompt.match(/<name>agent-artifact<\/name>/g)?.length, 1);
    assert.doesNotMatch(alreadyVisible.systemPrompt, /already visible metadata/);
});

void test("profile aborts a turn when the loaded skill catalog omits an activated opt-in", async () => {
    const { profilePath } = await fixture();
    const fake = fakeControllerPi("scout");
    registerProfileController(fake.pi, profilePath, {});
    await fake.handlers.session_start![0]!({ reason: "startup" }, fake.ctx);

    const patch = await fake.handlers.before_agent_start![0]!({
        systemPrompt: "base",
        systemPromptOptions: { skills: [] },
    }, fake.ctx);

    assert.equal(patch, undefined);
    assert.equal(fake.aborts(), 0);
    assert.equal(fake.notifications.at(-1), "Profile scout: loaded skill catalog mismatch: agent-artifact");
    await fake.handlers.before_provider_request![0]!({ payload: {} }, fake.ctx);
    assert.equal(fake.aborts(), 1);
    await fake.handlers.before_provider_request![0]!({ payload: {} }, fake.ctx);
    assert.equal(fake.aborts(), 1);
});

void test("profile activation fails transactionally when hidden opt-ins are undiscovered", async () => {
    const { profilePath, profileConfig } = await fixture();
    profileConfig.profiles.operator!.hiddenSkillOptIns = ["missing-one", "missing-two"];
    await writeFile(profilePath, JSON.stringify(profileConfig));
    const fake = fakeControllerPi("scout");
    registerProfileController(fake.pi, profilePath, {});
    await fake.handlers.session_start![0]!({ reason: "startup" }, fake.ctx);
    const toolsBefore = fake.activeTools();
    const thinkingBefore = fake.thinking();
    const applicationsBefore = fake.activeToolApplications();

    assert.deepEqual(await fake.handlers.input![0]!({ text: "/operate", source: "interactive" }, fake.ctx), { action: "handled" });
    assert.equal(fake.notifications.at(-1), "Profile operator: hidden skills unavailable: missing-one, missing-two");
    assert.deepEqual(fake.activeTools(), toolsBefore);
    assert.equal(fake.thinking(), thinkingBefore);
    assert.equal(fake.activeToolApplications(), applicationsBefore);
    assert.equal(fake.events.length, 1);
    assert.equal(fake.entries.at(-1)?.data.profileId, profileConfig.profiles.scout!.id);
});

void test("profile owns one discoverable palette contribution with current state and idle chooser", async () => {
    const { profilePath } = await fixture();
    const fake = fakeControllerPi("scout");
    let selected = 0;
    (fake.ctx.ui as any).select = async () => { selected += 1; return undefined; };
    registerProfileController(fake.pi, profilePath, {});
    await fake.handlers.session_start![0]!({ reason: "startup" }, fake.ctx);

    assert.equal(fake.paletteContributions.length, 1);
    const contribution = fake.paletteContributions[0]!;
    assert.equal(contribution.owner, "profile");
    assert.equal(contribution.currentValue(fake.ctx), "Current: scout");
    assert.equal(contribution.disabledReason(fake.ctx), undefined);
    await contribution.run(fake.ctx);
    assert.equal(selected, 1);
    const running = { ...fake.ctx, isIdle: () => false };
    assert.match(contribution.disabledReason(running), /idle/);
});

void test("active tool synchronization is ordered, idempotent, and recovers drift", async () => {
    const { profilePath } = await fixture();
    const fake = fakeControllerPi("scout");
    registerProfileController(fake.pi, profilePath, {});
    await fake.handlers.session_start![0]!({ reason: "startup" }, fake.ctx);

    const scoutTools = ["read", "subagent_run", "subagent_submit", "subagent_get", "subagent_wait"];
    assert.equal(fake.activeToolApplications(), 1);
    assert.deepEqual(await fake.handlers.input![0]!({ text: "ordinary text", source: "interactive" }, fake.ctx), { action: "continue" });
    await fake.handlers.before_agent_start![0]!({ systemPrompt: "base", systemPromptOptions: { skills: visibleSkills("agent-artifact") } }, fake.ctx);
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
    await fake.handlers.before_agent_start![0]!({ systemPrompt: "base", systemPromptOptions: { skills: visibleSkills("agent-artifact", "codebase-exploration", "source-implementation", "implementation-validation", "adaptive-review", "implementation-lifecycle") } }, fake.ctx);
    assert.deepEqual(fake.activeTools(), expandedTools);
    assert.equal(fake.activeToolApplications(), 6);
    await fake.handlers.before_agent_start![0]!({ systemPrompt: "base", systemPromptOptions: { skills: visibleSkills("agent-artifact", "codebase-exploration", "source-implementation", "implementation-validation", "adaptive-review", "implementation-lifecycle") } }, fake.ctx);
    assert.equal(fake.activeToolApplications(), 6);
});

void test("artisan profile wiring is top-level-only and delegates only adaptive solo review", async () => {
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
    assert.match(subagent, /allowedTargets = \["reviewer"\]/);
    assert.doesNotMatch(subagent, /tester|taskmaster|cursor-implementer|focused-reviewer/);
    assert.match(artifactNix, /artisan\.tools = \["save_agent_artifact"\]/);
});

void test("librarian is subagent-only and dispatchable from scout operator full via child contribution", async () => {
    const [profileNix, subagentNix, webSearchNix, defaultNix] = await Promise.all([
        readFile(join(import.meta.dirname, "..", "extensions", "profile", "default.nix"), "utf8"),
        readFile(join(import.meta.dirname, "..", "extensions", "subagent", "default.nix"), "utf8"),
        readFile(join(import.meta.dirname, "..", "extensions", "web_search", "default.nix"), "utf8"),
        readFile(join(import.meta.dirname, "..", "default.nix"), "utf8"),
    ]);
    const librarianStart = profileNix.indexOf("          librarian = {");
    const librarian = profileNix.slice(librarianStart, profileNix.indexOf("          };", librarianStart) + 12);
    assert.match(profileNix, /librarian = "f8e9225a-a129-4f74-9962-7800aab70dab"/);
    assert.match(librarian, /availability = \["subagent"\]/);
    assert.match(librarian, /model = "openai-codex\/gpt-5\.6-luna"/);
    assert.match(librarian, /thinkingLevel = "high"/);
    assert.match(librarian, /evidence brief/);

    assert.match(subagentNix, /childExtensionContributions = attrsOfOption/);
    assert.match(subagentNix, /full\.extensions\.subagent = \{[\s\S]*allowedTargets = \[[^\]]*librarian[^\]]*\]/);
    assert.match(subagentNix, /operator = \{[\s\S]*allowedTargets = \[[^\]]*librarian[^\]]*\]/);
    assert.match(subagentNix, /scout = \{[\s\S]*allowedTargets = \[[^\]]*librarian[^\]]*\]/);
    assert.match(subagentNix, /librarian\.extensions\.subagent = \{\s*allowedTargets = \[\];/);
    const taskmasterStart = subagentNix.indexOf("      taskmaster = {");
    const taskmaster = subagentNix.slice(taskmasterStart, subagentNix.indexOf("      artisan = {", taskmasterStart));
    const artisanStart = subagentNix.indexOf("      artisan = {");
    const artisan = subagentNix.slice(artisanStart, subagentNix.indexOf("      operator = {", artisanStart));
    const reviewerStart = subagentNix.indexOf("      reviewer = {");
    const reviewer = subagentNix.slice(reviewerStart, subagentNix.indexOf("      scout = {", reviewerStart));
    assert.doesNotMatch(taskmaster, /librarian/);
    assert.doesNotMatch(artisan, /librarian/);
    assert.doesNotMatch(reviewer, /librarian/);

    assert.match(webSearchNix, /childExtensionContributions\.web_search/);
    assert.match(webSearchNix, /librarian\.tools = \["web_search"\]/);
    assert.match(webSearchNix, /sopsSecretPaths\."brave-api-key" or null/);
    assert.match(defaultNix, /"web_search"/);
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
    assert.equal(fake.entries.at(-1)?.data.profileId, profileConfig.profiles.full!.id);
    assert.equal(fake.statuses.at(-1)?.text, "PARENT · profile:full");

    fake.failModel();
    assert.deepEqual(await fake.handlers.input![0]!({ text: "/review report.md", source: "interactive" }, fake.ctx), { action: "handled" });
    assert.match(fake.notifications.at(-1) ?? "", /no authentication/);
    assert.equal(fake.entries.at(-1)?.data.profileId, profileConfig.profiles.full!.id);
    assert.equal(fake.statuses.at(-1)?.text, "PARENT · profile:full");

    fake.passModel();
    fake.failNextToolApplication();
    const toolsBeforeFailure = fake.activeTools();
    const thinkingBeforeFailure = fake.thinking();
    assert.deepEqual(await fake.handlers.input![0]!({ text: "/review report.md", source: "interactive" }, fake.ctx), { action: "handled" });
    assert.match(fake.notifications.at(-1) ?? "", /injected tool application failure/);
    assert.deepEqual(fake.activeTools(), toolsBeforeFailure);
    assert.equal(fake.thinking(), thinkingBeforeFailure);
    assert.equal(fake.entries.at(-1)?.data.profileId, profileConfig.profiles.full!.id);
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
    eventHandler!({ schemaVersion: 1, name: "scout", reason: "startup", profile: { id: "99999999-9999-4999-8999-999999999999", model: "provider/model" } });
    eventHandler!({ schemaVersion: 99, name: "scout", reason: "startup", profile: profiles().profiles.scout });
    eventHandler!({ schemaVersion: 1, name: "scout", reason: "startup", profile: profiles().profiles.scout, unexpected: true });

    assert.equal(accepted.length, 1);
    assert.match(errors[0] ?? "", /availability|allowAllTools|unknown keys|extensions/);
    assert.match(errors[1] ?? "", /schemaVersion/);
    assert.match(errors[2] ?? "", /unknown keys/);
});

void test("profile state restores by opaque ID after a readable key rename and ignores old name-only state", async () => {
    const value = await fixture();
    const config = value.profileConfig;
    const scout = config.profiles.scout!;
    delete config.profiles.scout;
    config.profiles.seeker = scout;
    config.defaultProfile = "full";
    config.profileCycle = config.profileCycle.map(name => name === "scout" ? "seeker" : name);
    config.promptRoutes.review = "seeker";
    await writeFile(value.profilePath, JSON.stringify(config));

    const restored = fakeControllerPi("");
    restored.entries.push({ type: "custom", customType: "agent-profile-state", data: { schemaVersion: 2, profileId: scout.id } });
    registerProfileController(restored.pi, value.profilePath, {});
    await restored.handlers.session_start![0]!({ reason: "startup" }, restored.ctx);
    assert.equal((restored.events.at(-1)!.payload as any).name, "seeker");
    assert.deepEqual(restored.entries.at(-1)?.data, { schemaVersion: 2, profileId: scout.id });

    const legacy = fakeControllerPi("");
    legacy.entries.push({ type: "custom", customType: "agent-profile-state", data: { name: "seeker" } });
    registerProfileController(legacy.pi, value.profilePath, {});
    await legacy.handlers.session_start![0]!({ reason: "startup" }, legacy.ctx);
    assert.equal((legacy.events.at(-1)!.payload as any).name, "full");
});

void test("profile availability gates parent selection and old runtime schemas are rejected", async () => {
    const value = await fixture();
    const config = value.profileConfig;
    config.profiles.child = {
        id: "66666666-6666-4666-8666-666666666666", model: "provider/model", availability: ["subagent"], description: "Child only.", allowAllTools: false, tools: ["read"], hiddenSkillOptIns: [], extensions: { subagent: { allowedTargets: [] } },
    };
    await writeFile(value.profilePath, JSON.stringify(config));
    const fake = fakeControllerPi("scout");
    registerProfileController(fake.pi, value.profilePath, {});
    await fake.handlers.session_start![0]!({ reason: "startup" }, fake.ctx);
    assert.equal((fake.commands.profile!.getArgumentCompletions?.("ch") as unknown[] | null), null);
    await fake.commands.profile!.handler("child", fake.ctx);
    assert.match(fake.notifications.at(-1) ?? "", /Unknown top-level profile/u);
    assert.throws(() => validateProfileConfig({ ...config, schemaVersion: 4 }), /schemaVersion/u);
    assert.throws(() => validateProfileConfig({ ...config, profiles: { ...config.profiles, child: { ...config.profiles.child!, hiddenSkillOptIns: ["", "skill"] } } }), /non-empty strings/u);
    assert.throws(() => validateProfileConfig({ ...config, profiles: { ...config.profiles, child: { ...config.profiles.child!, hiddenSkillOptIns: ["skill", "skill"] } } }), /duplicates/u);
    assert.throws(() => validateProfileConfig({ ...config, profiles: { ...config.profiles, child: { ...config.profiles.child!, tools: [], hiddenSkillOptIns: ["skill"] } } }), /must include read/u);
    assert.throws(() => validateProfileConfig({ ...config, profiles: { ...config.profiles, child: { ...config.profiles.child!, id: config.profiles.scout!.id } } }), /duplicates/u);
    assert.throws(() => validateProfileConfig({ ...config, profiles: { ...config.profiles, child: { ...config.profiles.child!, id: "child" } } }), /opaque UUID/u);
    assert.throws(() => validateProfileConfig({ ...config, defaultProfile: "child" }), /top-level/u);
    assert.throws(() => validateSubagentRuntimeConfig({ ...value.subagentConfig, schemaVersion: 6 }), /schemaVersion/u);
});

void test("resolved child profile overlays the generic profile snapshot", async () => {
    const { profilePath } = await fixture();
    const pinned = {
        id: "11111111-1111-4111-8111-111111111111", model: "provider/pinned", availability: ["subagent"] as ("top-level" | "subagent")[], description: "Pinned exploration.", thinkingLevel: "low" as const, allowAllTools: false,
        tools: ["read"], hiddenSkillOptIns: ["agent-artifact"], instructions: "pinned", extensions: { subagent: { allowedTargets: ["scout"] } },
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

void test("every delegation-capable profile receives one shared task-specific-delta guideline", async () => {
    const guideline = (tool: unknown) => (tool as { promptGuidelines?: readonly string[] }).promptGuidelines ?? [];
    const taskGuidelines = {
        subagent_run: guideline(createSubagentRunTool({} as never)),
        subagent_submit: guideline(createSubagentSubmitTool({} as never)),
    };

    for (const profile of Object.values(profiles().profiles)) {
        const activeTaskTools = profile.allowAllTools
            ? ["subagent_run", "subagent_submit"] as const
            : profile.tools.filter((name): name is keyof typeof taskGuidelines => name in taskGuidelines);
        assert.equal(activeTaskTools.includes("subagent_run"), activeTaskTools.includes("subagent_submit"), profile.description);
        if (activeTaskTools.length === 0) continue;
        assert.deepEqual(activeTaskTools, ["subagent_run", "subagent_submit"]);
        const shared = activeTaskTools.flatMap(name => taskGuidelines[name]).filter(line => line.includes("stable capability contract"));
        assert.equal(shared.length, 1, profile.description);
        assert.match(shared[0]!, /`subagent_run` and `subagent_submit`/);
        assert.match(shared[0]!, /local objective and task-specific input or context/);
        assert.match(shared[0]!, /Omit invocation instructions, skill paths, procedures, default constraints, and default output contracts/);
        assert.match(shared[0]!, /intentionally override.*name the different skill/);
        assert.match(shared[0]!, /skill path only for a task-specific resource that cannot be discovered by name/);
    }

    const profileNix = await readFile(join(import.meta.dirname, "..", "extensions", "profile", "default.nix"), "utf8");
    assert.match(profileNix, /configuredTools = profile: lib\.unique \(cfg\.defaultTools \+\+ profile\.tools\)/);
    assert.match(profileNix, /childEffectiveTools = profile:[\s\S]*subagent\.childExcludedTools/);
    assert.match(profileNix, /subagentTaskToolsPaired/);
    assert.match(profileNix, /builtins\.elem "subagent_run" tools == builtins\.elem "subagent_submit" tools/);
    assert.match(profileNix, /profiles must allow all tools or expose subagent_run and subagent_submit together after shared defaults and child exclusions/);
});

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
        getActiveTools: () => ["subagent_run", "subagent_submit"],
        async exec() { return { stdout: "123\t$0\tmain\t@1\t%1\t/dev/ttys001\n", stderr: "", code: 0, killed: false }; },
    } as unknown as ExtensionAPI;
    assert.equal(await registerSubagent(pi, { configPath: value.subagentPath, profileConfigPath: value.profilePath, env: { TMUX: "yes" } }), true);
    assert.deepEqual(tools.map(tool => tool.name).sort(), ["subagent_get", "subagent_run", "subagent_stop", "subagent_submit", "subagent_wait"]);
    assert.deepEqual(tools.find(tool => tool.name === "subagent_run")?.parameters.properties?.profile?.enum, []);
    assert.deepEqual(tools.find(tool => tool.name === "subagent_submit")?.parameters.properties?.profile?.enum, []);
    eventHandlers[ACTIVE_PROFILE_EVENT]![0]!({
        schemaVersion: 1,
        name: "reviewer",
        reason: "startup",
        profile: {
            id: "77777777-7777-4777-8777-777777777777", model: "provider/model",
            availability: ["subagent"] as ("top-level" | "subagent")[],
            description: "Review orchestration.",
            thinkingLevel: "medium",
            allowAllTools: false,
            tools: ["subagent_run", "subagent_submit"],
            hiddenSkillOptIns: [],
            extensions: { subagent: { allowedTargets: ["focused-reviewer", "dissent-reviewer"] } },
        },
    });
    const run = tools.find(tool => tool.name === "subagent_run");
    const submit = tools.find(tool => tool.name === "subagent_submit");
    assert.deepEqual(run?.parameters.properties?.profile?.enum, ["focused-reviewer", "dissent-reviewer"]);
    assert.deepEqual(submit?.parameters.properties?.profile?.enum, ["focused-reviewer", "dissent-reviewer"]);
    assert.match(submit?.parameters.properties?.profile?.description ?? "", /focused-reviewer, dissent-reviewer/);
    assert.equal(handlers.before_agent_start, undefined);
});

void test("only Pi-native children register /parent and expose the configured navigation hint", async () => {
    const value = await fixture();
    const commands: Record<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }> = {};
    const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
    const calls: Array<{ command: string; args: string[] }> = [];
    const statuses: Array<{ key: string; text: string }> = [];
    const pi = {
        registerCommand(name: string, command: any) { commands[name] = command; }, registerTool() {}, getActiveTools: () => [],
        on(name: string, handler: any) { (handlers[name] ??= []).push(handler); },
        events: { on() { return () => {}; }, emit() {} },
        async exec(command: string, args: string[]) { calls.push({ command, args }); return { stdout: "", stderr: "", code: 0, killed: false }; },
    } as unknown as ExtensionAPI;
    const env = { PI_SUBAGENT_AGENT_ID: "child", PI_SUBAGENT_DEPTH: "1", PI_SUBAGENT_ORIGIN_SESSION_ID: "origin" };
    await registerSubagent(pi, { configPath: value.subagentPath, profileConfigPath: value.profilePath, env });
    const ctx = {
        ui: { setStatus(key: string, text: string) { statuses.push({ key, text }); }, notify() {} },
        sessionManager: { getSessionId: () => "child-session", getSessionFile: () => undefined },
    } as unknown as ExtensionContext;
    await handlers.session_start![0]!({}, ctx);
    assert.deepEqual(statuses, [{ key: "subagent-parent-navigation", text: "F12 U: parent · /parent" }]);
    assert.ok(commands.parent);
    await commands.parent!.handler("", ctx);
    assert.deepEqual(calls, [{ command: "/return-parent", args: [] }]);

    const parentCommands: string[] = [];
    const parentPi = { ...pi, registerCommand(name: string) { parentCommands.push(name); } } as unknown as ExtensionAPI;
    await registerSubagent(parentPi, { configPath: value.subagentPath, profileConfigPath: value.profilePath, env: {} });
    assert.ok(!parentCommands.includes("parent"));
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
    const controller = new AbortController();
    controller.abort(new Error("parent aborted before submission"));
    await assert.rejects(createSubagentRunTool({ ...base, activeProfile: () => ({ name: "full", facet: { allowedTargets: ["scout"] } }) }).execute("run", { profile: "scout", purpose: "Policy task", prompt: "task" }, controller.signal, undefined, toolContext(fixtureValue.root)), /parent aborted before submission/);
    await assert.rejects(access(fixtureValue.subagentConfig.stateRoot));
    assert.equal(execCalls, 0);
});

void test("child effective profile drops excluded tools from snapshot and launch descriptor", async () => {
    const { projectChildEffectiveProfile } = await import("../extensions_src/utilities/subagent_types.ts");
    const { piLaunchDescriptor } = await import("../extensions_src/utilities/subagent_pi.ts");
    const profile = {
        id: "88888888-8888-4888-8888-888888888888", model: "provider/model",
        availability: ["subagent"] as ("top-level" | "subagent")[],
        description: "Review orchestration.",
        thinkingLevel: "medium" as const,
        allowAllTools: false,
        tools: ["read", "question", "subagent_run", "subagent_submit", "subagent_get"],
        hiddenSkillOptIns: ["adaptive-review"],
        instructions: "orchestrate",
        extensions: { subagent: { allowedTargets: ["focused-reviewer"] } },
    };
    const effective = projectChildEffectiveProfile(profile, ["question"]);
    assert.deepEqual(effective.tools, ["read", "subagent_run", "subagent_submit", "subagent_get"]);
    assert.ok(!effective.tools.includes("question"));
    const invalidSplit = projectChildEffectiveProfile(profile, ["subagent_run"]);
    assert.deepEqual(invalidSplit.tools, ["read", "question", "subagent_submit", "subagent_get"]);
    const launch = piLaunchDescriptor({
        schemaVersion: 8,
        stateRoot: "/state",
        tmux: "/tmux",
        returnParentCommand: "/return-parent",
        parentNavigationHint: "F12 U: parent · /parent",
        historyViewerExtension: "/history.ts",
        childExtensions: ["/profile.ts"],
        harnesses: { pi: { adapter: "pi-native", command: "/pi" } },
        maxDepth: 3,
        childExcludedTools: ["question"],
        natureHandleWords: ["Maple", "Cedar"],
    }, {
        agentId: "a",
        agentDirectory: "/state/agents/a",
        profile: "reviewer",
        profileSnapshot: effective,
        depth: 1,
        originSessionId: "origin",
    });
    const toolsArg = launch.args[launch.args.indexOf("--tools") + 1];
    assert.equal(toolsArg, "read,subagent_run,subagent_submit,subagent_get");
    assert.doesNotMatch(toolsArg ?? "", /question/);
    const resolved = JSON.parse(launch.env.PI_AGENT_RESOLVED_PROFILE!);
    assert.deepEqual(resolved.profile.tools, ["read", "subagent_run", "subagent_submit", "subagent_get"]);
    assert.deepEqual(resolved.profile.hiddenSkillOptIns, ["adaptive-review"]);
});

void test("resolved child profile does not fall back to the default profile on apply failure", async () => {
    const restrictive = await fixture();
    const profileConfig = restrictive.profileConfig;
    profileConfig.profiles.scout = {
        ...profileConfig.profiles.scout!,
        tools: ["read", "question", "subagent_run", "subagent_submit"],
    };
    await writeFile(restrictive.profilePath, JSON.stringify(profileConfig));
    const childFake = fakeControllerPi("scout");
    const available = ["read", "bash", "edit", "write", "subagent_run", "subagent_submit", "subagent_get", "subagent_wait", "project_tool"];
    (childFake.pi as any).getAllTools = () => available.filter(name => name !== "question").map((name: string) => ({ name }));
    registerProfileController(childFake.pi, restrictive.profilePath, {
        PI_AGENT_RESOLVED_PROFILE: JSON.stringify({ name: "scout", profile: profileConfig.profiles.scout }),
    });
    await childFake.handlers.session_start![0]!({ reason: "startup" }, childFake.ctx);
    assert.equal(childFake.events.length, 0);
    assert.deepEqual(childFake.entries.filter((entry: { customType?: string }) => entry.customType === "agent-profile-state"), []);
});
