import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
    createSubagentGetTool,
    createSubagentStartTool,
    createSubagentStopTool,
    createSubagentWaitTool,
    registerSubagent,
    type SubagentDependencies,
} from "../extensions_src/subagent.ts";
import { runSubagent } from "../extensions_src/subagent_runner.ts";
import {
    attachTmux,
    createRun,
    failRun,
    finishRun,
    patchStatus,
    readSnapshot,
    requestRunStop,
} from "../extensions_src/utilities/subagent_store.ts";
import type { CommandExecutor } from "../extensions_src/utilities/subagent_tmux.ts";
import type { AgentProfileConfig } from "../extensions_src/utilities/profile_types.ts";
import type { SubagentRuntimeConfig } from "../extensions_src/utilities/subagent_types.ts";

async function runFinishedEvents(path: string): Promise<Array<{ data: { outcome?: string; method?: string } }>> {
    return (await readFile(path, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line) as { type: string; data: { outcome?: string; method?: string } })
        .filter(event => event.type === "run_finished")
        .map(event => ({ data: event.data }));
}

function context(cwd: string): ExtensionContext {
    return {
        cwd,
        sessionManager: {
            getSessionId: () => "session",
            getSessionFile: () => join(cwd, "session.jsonl"),
        },
    } as ExtensionContext;
}

async function configFixture(): Promise<{ root: string; path: string; profilePath: string; config: SubagentRuntimeConfig; profiles: AgentProfileConfig }> {
    const root = await mkdtemp(join(tmpdir(), "subagent-tool-"));
    const config: SubagentRuntimeConfig = {
        schemaVersion: 1,
        stateRoot: join(root, "runs"),
        runner: { node: process.execPath, script: "/runner.ts", extensions: ["/profile.ts", "/subagent.ts"] },
        harnesses: { pi: { command: "/pi" } },
        maxDepth: 3,
    };
    const profiles: AgentProfileConfig = {
        schemaVersion: 2,
        defaultProfile: "full",
        profileCycle: ["scout", "full"],
        profiles: {
            scout: { model: "provider/model", description: "Read-only exploration.", allowAllTools: false, tools: ["read"], extensions: { subagent: { allowedTargets: ["scout"] } } },
            full: { model: "provider/model", description: "Broad coding work.", allowAllTools: true, tools: [], extensions: { subagent: { allowedTargets: ["scout", "full"] } } },
        },
    };
    const path = join(root, "subagent.json");
    const profilePath = join(root, "agent-profiles.json");
    await writeFile(path, JSON.stringify(config));
    await writeFile(profilePath, JSON.stringify(profiles));
    return { root, path, profilePath, config, profiles };
}

test("extension registers no tools unless tmux is verifiably available", async () => {
    const registered: string[] = [];
    const pi = {
        registerTool(tool: { name: string }) { registered.push(tool.name); },
        on() {}, events: { on() {}, emit() {} },
        async exec() { return { stdout: "$0\tmain\t%1\n", stderr: "", code: 0, killed: false }; },
    } as unknown as ExtensionAPI;

    assert.equal(await registerSubagent(pi, { env: {} }), false);
    assert.deepEqual(registered, []);
    assert.equal(await registerSubagent(pi, { env: { TMUX: "/tmp/tmux,1,0" } }), true);
    assert.deepEqual(registered, ["subagent_start", "subagent_get", "subagent_wait", "subagent_stop"]);
});

test("subagent tools expose optional detail without changing required inputs", () => {
    const deps: SubagentDependencies = { configPath: "", env: {}, exec: aliveExec() };
    const startTool = createSubagentStartTool(deps);
    const schemas = [
        startTool.parameters,
        createSubagentGetTool(deps).parameters,
        createSubagentWaitTool(deps).parameters,
        createSubagentStopTool(deps).parameters,
    ] as unknown as Array<{
        required: string[];
        properties: { detail: { type: string; default: boolean; description: string } };
    }>;

    assert.deepEqual(schemas.map(schema => schema.required), [
        ["profile", "purpose", "prompt"],
        ["runId"],
        ["runIds", "condition", "timeoutSeconds"],
        ["runId"],
    ]);
    for (const schema of schemas) {
        assert.equal(schema.properties.detail.type, "boolean");
        assert.equal(schema.properties.detail.default, false);
        assert.match(schema.properties.detail.description, /model-visible content/);
        assert.match(schema.properties.detail.description, /Internal tool details are always retained/);
    }

    const start = schemas[0] as unknown as { properties: { purpose: { type: string; minLength: number; maxLength: number } } };
    assert.deepEqual(start.properties.purpose, {
        type: "string",
        minLength: 1,
        maxLength: 120,
        description: "Short display purpose for this delegated run",
    });
    const prepared = startTool.prepareArguments?.({ profile: "scout", prompt: "\n  Inspect   renderer behavior  \nmore" });
    assert.deepEqual(prepared, { profile: "scout", purpose: "Inspect renderer behavior", prompt: "\n  Inspect   renderer behavior  \nmore" });
    const longPrepared = startTool.prepareArguments?.({ profile: "scout", prompt: "x".repeat(200) });
    assert.equal((longPrepared as { purpose: string }).purpose.length, 96);

    const wait = schemas[2] as unknown as {
        properties: {
            runIds: { minItems: number; maxItems: number; uniqueItems: boolean };
            condition: { enum: string[] };
            timeoutSeconds: { type: string; minimum: number; maximum: number };
        };
    };
    assert.deepEqual(wait.properties.runIds, {
        type: "array",
        items: { type: "string", description: "UUID returned by subagent_start" },
        minItems: 1,
        maxItems: 128,
        uniqueItems: true,
    });
    assert.deepEqual(wait.properties.condition.enum, ["any", "all"]);
    assert.deepEqual(wait.properties.timeoutSeconds, { type: "integer", minimum: 1, maximum: 3600 });
});

test("get and wait metadata distinguish observation from synchronization", () => {
    const deps: SubagentDependencies = { configPath: "", env: {}, exec: aliveExec() };
    const get = createSubagentGetTool(deps);
    const wait = createSubagentWaitTool(deps);

    assert.match(get.description, /without waiting/);
    assert.match(get.description, /actionable run summary by default/);
    assert.match(get.description, /detail=true/);
    assert.match(get.promptGuidelines?.join("\n") ?? "", /one-time non-blocking/);
    assert.match(wait.description, /actionable run summaries by default/);
    assert.match(wait.description, /detail=true/);
    assert.match(wait.description, /Timeout is a normal result/);
    assert.match(wait.promptGuidelines?.join("\n") ?? "", /no useful independent work remains/);
    assert.match(wait.promptGuidelines?.join("\n") ?? "", /use subagent_get instead/);
});

test("start returns in starting state and get marks a disappeared runner failed", async () => {
    const fixture = await configFixture();
    let paneAlive = true;
    let launchFails = false;
    const calls: string[][] = [];
    const exec: CommandExecutor = async (_command, args) => {
        calls.push([...args]);
        if (args[0] === "display-message" && args.includes("#{session_id}\t#{session_name}\t#{pane_id}")) {
            return { stdout: "$0\tmain\t%1\n", stderr: "", code: 0 };
        }
        if (args[0] === "new-window") return launchFails
            ? { stdout: "", stderr: "tmux refused launch", code: 1 }
            : { stdout: "@2\t%2\n", stderr: "", code: 0 };
        if (args[0] === "set-option") return { stdout: "", stderr: "", code: 0 };
        if (args[0] === "display-message" && args.includes("#{pane_dead}")) {
            return { stdout: paneAlive ? "0\n" : "1\n", stderr: "", code: 0 };
        }
        return { stdout: "", stderr: "unexpected", code: 1 };
    };
    const deps: SubagentDependencies = {
        configPath: fixture.path,
        profileConfigPath: fixture.profilePath,
        env: { TMUX: "yes" },
        exec,
        activeProfile: () => ({ name: "full", facet: { allowedTargets: ["scout", "full"] } }),
    };
    const started = await createSubagentStartTool(deps).execute(
        "call",
        { profile: "full", purpose: "Start task", prompt: "task" },
        undefined,
        undefined,
        context(fixture.root),
    );
    assert.equal(started.details.status, "starting");
    const startedText = started.content[0]?.type === "text" ? started.content[0].text : "{}";
    assert.deepEqual(JSON.parse(startedText), { runId: started.details.runId, purpose: "Start task", profile: "full", status: "starting" });
    const launch = calls.find(args => args[0] === "new-window");
    assert.deepEqual(launch?.slice(0, 9), ["new-window", "-d", "-P", "-F", "#{window_id}\t#{pane_id}", "-t", "$0:", "-c", fixture.root]);
    assert.equal(launch?.[9], "-n");
    assert.equal(launch?.[10], `sa-${started.details.runId.slice(0, 8)}`);
    assert.match(launch?.[11] ?? "", /launch\.sh$/);
    assert.doesNotMatch(launch?.join(" ") ?? "", /Start task|\btask\b/);
    assert.deepEqual(calls.find(args => args[0] === "set-option"), ["set-option", "-w", "-t", "@2", "remain-on-exit", "on"]);

    const detailedStart = await createSubagentStartTool(deps).execute(
        "call-detail",
        { profile: "full", purpose: "Detailed task", prompt: "detailed task", detail: true },
        undefined,
        undefined,
        context(fixture.root),
    );
    const detailedStartText = detailedStart.content[0]?.type === "text" ? detailedStart.content[0].text : "{}";
    assert.equal((JSON.parse(detailedStartText) as { tmux?: { windowId?: string } }).tmux?.windowId, "@2");

    launchFails = true;
    const launchFailed = await createSubagentStartTool(deps).execute(
        "call-launch-failure",
        { profile: "full", purpose: "Launch failure", prompt: "test launch failure" },
        undefined,
        undefined,
        context(fixture.root),
    );
    const launchFailedText = launchFailed.content[0]?.type === "text" ? launchFailed.content[0].text : "{}";
    assert.deepEqual(JSON.parse(launchFailedText), {
        runId: launchFailed.details.runId,
        purpose: "Launch failure",
        profile: "full",
        status: "failed",
    });
    const launchFailureCard = createSubagentStartTool(deps).renderResult?.(
        launchFailed,
        { expanded: false } as never,
        renderTheme,
        {} as never,
    )?.render(160).join("\n") ?? "";
    assert.match(launchFailureCard, /launch: tmux refused launch/);

    paneAlive = false;
    const fetched = await createSubagentGetTool(deps).execute(
        "call",
        { runId: started.details.runId },
        undefined,
        undefined,
        context(fixture.root),
    );
    assert.equal(fetched.details.status, "failed");
    const fetchedText = fetched.content[0]?.type === "text" ? fetched.content[0].text : "{}";
    assert.deepEqual(JSON.parse(fetchedText), {
        runId: started.details.runId,
        purpose: "Start task",
        profile: "full",
        status: "failed",
        error: { category: "runner_lost", message: "The tmux runner pane disappeared before the run reached a terminal state" },
    });

    const detailedGet = await createSubagentGetTool(deps).execute(
        "call-detail",
        { runId: started.details.runId, detail: true },
        undefined,
        undefined,
        context(fixture.root),
    );
    const detailedGetText = detailedGet.content[0]?.type === "text" ? detailedGet.content[0].text : "{}";
    assert.equal((JSON.parse(detailedGetText) as { result?: { error?: { category?: string } } }).result?.error?.category, "runner_lost");
});

async function runningRun(fixture: Awaited<ReturnType<typeof configFixture>>, paneId: string) {
    const run = await createRun(fixture.config, "full", fixture.profiles.profiles.full!, `Run ${paneId}`, `task ${paneId}`, fixture.root, {
        callerProfile: "full", depth: 1, originSessionId: "session", originSessionFile: join(fixture.root, "session.jsonl"),
    });
    await patchStatus(run.paths, { status: "starting" });
    await attachTmux(run.paths, {
        sessionId: "$0",
        session: "test",
        windowId: `@${paneId.slice(1)}`,
        paneId,
        windowName: `sa-${run.request.runId.slice(0, 8)}`,
    });
    await patchStatus(run.paths, { status: "running", startedAt: new Date().toISOString() });
    return run;
}

function successfulResult(runId: string, output = "done") {
    const startedAt = new Date().toISOString();
    return {
        schemaVersion: 2 as const,
        runId,
        outcome: "succeeded" as const,
        output,
        error: null,
        usage: {
            input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        turns: 1,
        startedAt,
        finishedAt: startedAt,
    };
}

function aliveExec(): CommandExecutor {
    return async () => ({ stdout: "0\n", stderr: "", code: 0 });
}

const renderTheme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
} as never;

test("tool cards render observable calls, terminal previews, expanded metadata, and raw fallbacks", async () => {
    const fixture = await configFixture();
    const run = await runningRun(fixture, "%1");
    const deps: SubagentDependencies = { configPath: fixture.path, env: {}, exec: aliveExec() };
    const startTool = createSubagentStartTool(deps);
    const getTool = createSubagentGetTool(deps);

    const legacyCall = startTool.renderCall?.(
        { profile: "scout", prompt: "\nLegacy observable task\nfull prompt" } as never,
        renderTheme,
        { expanded: false } as never,
    )?.render(160).join("\n") ?? "";
    assert.match(legacyCall, /scout.*Legacy observable task/);
    const collapsedCall = startTool.renderCall?.(
        { profile: "scout", purpose: "Preview", prompt: "line 1\nline 2\nline 3\nline 4" },
        renderTheme,
        { expanded: false } as never,
    )?.render(160).join("\n") ?? "";
    assert.match(collapsedCall, /line 1\s*\n\s*line 2\s*\n\s*line 3/);
    assert.doesNotMatch(collapsedCall, /line 4/);
    assert.match(collapsedCall, /prompt preview truncated/);
    const expandedCall = startTool.renderCall?.(
        { profile: "scout", purpose: "Observable task", prompt: "full prompt body" },
        renderTheme,
        { expanded: true } as never,
    )?.render(160).join("\n") ?? "";
    assert.match(expandedCall, /Observable task/);
    assert.match(expandedCall, /full prompt body/);

    const shortGetCall = getTool.renderCall?.({ runId: run.request.runId }, renderTheme, { expanded: false } as never)?.render(160).join("\n") ?? "";
    assert.match(shortGetCall, new RegExp(run.request.runId.slice(0, 8)));
    assert.doesNotMatch(shortGetCall, new RegExp(run.request.runId));
    const runningResult = await getTool.execute("render-running", { runId: run.request.runId }, undefined, undefined, context(fixture.root));
    const runningCard = getTool.renderResult?.(runningResult, { expanded: false } as never, renderTheme, {} as never)?.render(160).join("\n") ?? "";
    assert.match(runningCard, /Run %1.*running/);
    assert.match(runningCard, /full/);

    await finishRun(run.paths, successfulResult(run.request.runId, "line 1\nline 2\nline 3\nline 4"));
    const result = await getTool.execute("render-call", { runId: run.request.runId }, undefined, undefined, context(fixture.root));
    const collapsed = getTool.renderResult?.(result, { expanded: false } as never, renderTheme, {} as never)?.render(160).join("\n") ?? "";
    assert.match(collapsed, /Run %1.*succeeded/);
    assert.match(collapsed, /line 1\s*\n\s*line 2\s*\n\s*line 3/);
    assert.doesNotMatch(collapsed, /line 4/);
    assert.match(collapsed, /usage: 2 tokens/);

    const expanded = getTool.renderResult?.(result, { expanded: true } as never, renderTheme, {} as never)?.render(160).join("\n") ?? "";
    assert.match(expanded, new RegExp(run.request.runId));
    assert.match(expanded, /line 4/);
    assert.match(expanded, /result\.json/);

    const failedRun = await runningRun(fixture, "%2");
    await failRun(failedRun.paths, { category: "harness", message: "model failed\nline 2\nline 3\nline 4", exitCode: 17 });
    const failedResult = await getTool.execute("render-failure", { runId: failedRun.request.runId }, undefined, undefined, context(fixture.root));
    const failure = getTool.renderResult?.(failedResult, { expanded: false } as never, renderTheme, {} as never)?.render(160).join("\n") ?? "";
    assert.match(failure, /failed/);
    assert.match(failure, /harness: model failed/);
    assert.match(failure, /line 2/);
    assert.match(failure, /line 3/);
    assert.doesNotMatch(failure, /line 4/);
    assert.match(failure, /error preview truncated/);
    assert.match(failure, /detail=true/);
    const expandedFailure = getTool.renderResult?.(failedResult, { expanded: true } as never, renderTheme, {} as never)?.render(160).join("\n") ?? "";
    assert.match(expandedFailure, /line 4 \(exit 17\)/);

    const raw = getTool.renderResult?.(
        { content: [{ type: "text", text: "legacy raw result" }], details: { malformed: true } } as never,
        { expanded: false } as never,
        renderTheme,
        {} as never,
    )?.render(160).join("\n") ?? "";
    assert.equal(raw.trimEnd(), "legacy raw result");
});

test("wait emits every poll as a partial update without claiming usage before the final result", async () => {
    const fixture = await configFixture();
    const run = await runningRun(fixture, "%1");
    let now = 0;
    const updates: Array<{ reason: string; status: string; usage: unknown; claimedRunIds: string[] }> = [];
    const renderedUpdates: string[] = [];
    const deps: SubagentDependencies = {
        configPath: fixture.path,
        env: {},
        exec: aliveExec(),
        monotonicNow: () => now,
        sleep: async milliseconds => {
            now += milliseconds;
            await finishRun(run.paths, successfulResult(run.request.runId));
        },
    };
    const tool = createSubagentWaitTool(deps);
    const waitCall = tool.renderCall?.(
        { runIds: [run.request.runId], condition: "all", timeoutSeconds: 5 },
        renderTheme,
        { expanded: false } as never,
    )?.render(160).join("\n") ?? "";
    assert.match(waitCall, /all · 1 runs/);
    const waited = await tool.execute(
        "wait-updates",
        { runIds: [run.request.runId], condition: "all", timeoutSeconds: 5 },
        undefined,
        update => {
            assert.equal(existsSync(run.paths.usageClaim), false);
            renderedUpdates.push(tool.renderResult?.(update, { expanded: false, isPartial: true } as never, renderTheme, {} as never)?.render(160).join("\n") ?? "");
            updates.push({
                reason: update.details.reason,
                status: update.details.runs[0]!.status,
                usage: update.usage,
                claimedRunIds: update.details.accounting.claimedRunIds,
            });
        },
        context(fixture.root),
    );

    assert.deepEqual(updates, [
        { reason: "polling", status: "running", usage: undefined, claimedRunIds: [] },
        { reason: "polling", status: "succeeded", usage: undefined, claimedRunIds: [] },
    ]);
    assert.match(renderedUpdates[0] ?? "", /running.*Run %1.*\(full, .*\)/);
    assert.equal(waited.details.reason, "condition_met");
    assert.deepEqual(waited.details.accounting.claimedRunIds, [run.request.runId]);
    assert.equal(waited.usage?.totalTokens, 2);
    assert.equal(existsSync(run.paths.usageClaim), true);

    const collapsed = tool.renderResult?.(waited, { expanded: false } as never, renderTheme, {} as never)?.render(160).join("\n") ?? "";
    assert.match(collapsed, /1 completed, 0 pending/);
    assert.match(collapsed, /Run %1/);
    assert.match(collapsed, /succeeded/);
    const expanded = tool.renderResult?.(waited, { expanded: true } as never, renderTheme, {} as never)?.render(160).join("\n") ?? "";
    assert.match(expanded, new RegExp(run.request.runId));
    assert.match(expanded, /result\.json/);
    assert.match(expanded, /created:/);

    const raw = tool.renderResult?.(
        { content: [{ type: "text", text: "legacy wait result" }], details: { schemaVersion: 1 } } as never,
        { expanded: false } as never,
        renderTheme,
        {} as never,
    )?.render(160).join("\n") ?? "";
    assert.equal(raw.trimEnd(), "legacy wait result");
});

test("wait any returns after the first terminal run and preserves input order", async () => {
    const fixture = await configFixture();
    const first = await runningRun(fixture, "%1");
    const second = await runningRun(fixture, "%2");
    let now = 0;
    let sleeps = 0;
    const deps: SubagentDependencies = {
        configPath: fixture.path,
        env: {},
        exec: aliveExec(),
        monotonicNow: () => now,
        sleep: async milliseconds => {
            now += milliseconds;
            sleeps += 1;
            await finishRun(second.paths, successfulResult(second.request.runId));
        },
    };

    const waited = await createSubagentWaitTool(deps).execute(
        "call",
        { runIds: [first.request.runId, second.request.runId], condition: "any", timeoutSeconds: 30 },
        undefined,
        undefined,
        context(fixture.root),
    );

    assert.equal(sleeps, 1);
    assert.equal(waited.details.reason, "condition_met");
    assert.deepEqual(waited.details.completedRunIds, [second.request.runId]);
    assert.deepEqual(waited.details.pendingRunIds, [first.request.runId]);
    assert.deepEqual(waited.details.runs.map(run => run.runId), [first.request.runId, second.request.runId]);
    const text = waited.content[0]?.type === "text" ? waited.content[0].text : "{}";
    assert.deepEqual(JSON.parse(text), {
        reason: "condition_met",
        runs: [
            { runId: first.request.runId, purpose: "Run %1", profile: "full", status: "running" },
            { runId: second.request.runId, purpose: "Run %2", profile: "full", status: "succeeded", output: "done" },
        ],
    });
});

test("wait returns immediately when the condition is already satisfied", async () => {
    const fixture = await configFixture();
    const run = await runningRun(fixture, "%1");
    await finishRun(run.paths, successfulResult(run.request.runId));
    let sleeps = 0;
    const deps: SubagentDependencies = {
        configPath: fixture.path,
        env: {},
        exec: aliveExec(),
        monotonicNow: () => 0,
        sleep: async () => { sleeps += 1; },
    };

    const waited = await createSubagentWaitTool(deps).execute(
        "call",
        { runIds: [run.request.runId], condition: "any", timeoutSeconds: 30 },
        undefined,
        undefined,
        context(fixture.root),
    );

    assert.equal(sleeps, 0);
    assert.equal(waited.details.reason, "condition_met");
    assert.deepEqual(waited.details.completedRunIds, [run.request.runId]);
});

test("wait all counts succeeded and failed runs as terminal", async () => {
    const fixture = await configFixture();
    const first = await runningRun(fixture, "%1");
    const second = await runningRun(fixture, "%2");
    let now = 0;
    const deps: SubagentDependencies = {
        configPath: fixture.path,
        env: {},
        exec: aliveExec(),
        monotonicNow: () => now,
        sleep: async milliseconds => {
            now += milliseconds;
            await finishRun(first.paths, successfulResult(first.request.runId));
            await failRun(second.paths, { category: "harness", message: "failed" });
        },
    };

    const waited = await createSubagentWaitTool(deps).execute(
        "call",
        { runIds: [first.request.runId, second.request.runId], condition: "all", timeoutSeconds: 30 },
        undefined,
        undefined,
        context(fixture.root),
    );

    assert.equal(waited.details.reason, "condition_met");
    assert.deepEqual(waited.details.completedRunIds, [first.request.runId, second.request.runId]);
    assert.deepEqual(waited.details.pendingRunIds, []);
    assert.deepEqual(waited.details.runs.map(run => run.status), ["succeeded", "failed"]);
    const text = waited.content[0]?.type === "text" ? waited.content[0].text : "{}";
    assert.deepEqual(JSON.parse(text), {
        reason: "condition_met",
        runs: [
            { runId: first.request.runId, purpose: "Run %1", profile: "full", status: "succeeded", output: "done" },
            { runId: second.request.runId, purpose: "Run %2", profile: "full", status: "failed", error: { category: "harness", message: "failed" } },
        ],
    });
});

test("wait prefers a condition met on the deadline's final read over timeout", async () => {
    const fixture = await configFixture();
    const run = await runningRun(fixture, "%1");
    let now = 0;
    const deps: SubagentDependencies = {
        configPath: fixture.path,
        env: {},
        exec: aliveExec(),
        monotonicNow: () => now,
        sleep: async milliseconds => {
            now += milliseconds;
            await finishRun(run.paths, successfulResult(run.request.runId));
        },
    };

    const waited = await createSubagentWaitTool(deps).execute(
        "call",
        { runIds: [run.request.runId], condition: "all", timeoutSeconds: 1 },
        undefined,
        undefined,
        context(fixture.root),
    );

    assert.equal(now, 1000);
    assert.equal(waited.details.reason, "condition_met");
    assert.deepEqual(waited.details.completedRunIds, [run.request.runId]);
});

test("wait returns current snapshots normally when the deadline expires", async () => {
    const fixture = await configFixture();
    const run = await runningRun(fixture, "%1");
    let now = 0;
    const deps: SubagentDependencies = {
        configPath: fixture.path,
        env: {},
        exec: aliveExec(),
        monotonicNow: () => now,
        sleep: async milliseconds => { now += milliseconds; },
    };

    const waited = await createSubagentWaitTool(deps).execute(
        "call",
        { runIds: [run.request.runId], condition: "all", timeoutSeconds: 1 },
        undefined,
        undefined,
        context(fixture.root),
    );

    assert.equal(waited.details.reason, "timeout");
    assert.deepEqual(waited.details.completedRunIds, []);
    assert.deepEqual(waited.details.pendingRunIds, [run.request.runId]);
    assert.equal(waited.details.runs[0]?.status, "running");
    const text = waited.content[0]?.type === "text" ? waited.content[0].text : "{}";
    assert.deepEqual(JSON.parse(text), {
        reason: "timeout",
        runs: [{ runId: run.request.runId, purpose: "Run %1", profile: "full", status: "running" }],
    });
});

test("wait rejects duplicate or unknown runs before polling or reconciliation", async () => {
    const fixture = await configFixture();
    const run = await runningRun(fixture, "%1");
    let sleeps = 0;
    const deps: SubagentDependencies = {
        configPath: fixture.path,
        env: {},
        exec: async () => ({ stdout: "1\n", stderr: "", code: 0 }),
        sleep: async () => { sleeps += 1; },
    };
    const tool = createSubagentWaitTool(deps);

    await assert.rejects(
        tool.execute(
            "call",
            { runIds: [run.request.runId, run.request.runId], condition: "all", timeoutSeconds: 1 },
            undefined,
            undefined,
            context(fixture.root),
        ),
        /must not contain duplicates/,
    );
    await assert.rejects(
        tool.execute(
            "call",
            { runIds: [run.request.runId, "550e8400-e29b-41d4-a716-446655440000"], condition: "all", timeoutSeconds: 1 },
            undefined,
            undefined,
            context(fixture.root),
        ),
    );
    assert.equal(sleeps, 0);
    assert.equal((await readSnapshot(fixture.config.stateRoot, run.request.runId)).status, "running");
});

test("wait reconciles a disappeared runner before evaluating the condition", async () => {
    const fixture = await configFixture();
    const run = await runningRun(fixture, "%1");
    const deps: SubagentDependencies = {
        configPath: fixture.path,
        env: {},
        exec: async () => ({ stdout: "1\n", stderr: "", code: 0 }),
    };

    const waited = await createSubagentWaitTool(deps).execute(
        "call",
        { runIds: [run.request.runId], condition: "any", timeoutSeconds: 30 },
        undefined,
        undefined,
        context(fixture.root),
    );

    assert.equal(waited.details.reason, "condition_met");
    assert.equal(waited.details.runs[0]?.status, "failed");
    const waitedText = waited.content[0]?.type === "text" ? waited.content[0].text : "{}";
    const waitedModel = JSON.parse(waitedText) as { runs: Array<{ error?: { category?: string } }> };
    assert.equal(waitedModel.runs[0]?.error?.category, "runner_lost");
});

test("wait aborts without changing a live run", async () => {
    const fixture = await configFixture();
    const run = await runningRun(fixture, "%1");
    const controller = new AbortController();
    const deps: SubagentDependencies = {
        configPath: fixture.path,
        env: {},
        exec: aliveExec(),
        monotonicNow: () => 0,
        sleep: async (_milliseconds, signal) => {
            controller.abort(new Error("cancelled"));
            signal?.throwIfAborted();
        },
    };

    await assert.rejects(
        createSubagentWaitTool(deps).execute(
            "call",
            { runIds: [run.request.runId], condition: "all", timeoutSeconds: 30 },
            controller.signal,
            undefined,
            context(fixture.root),
        ),
        /cancelled/,
    );
    assert.equal((await readSnapshot(fixture.config.stateRoot, run.request.runId)).status, "running");
});

test("wait keeps minimal aggregate JSON below 50KB without exposing paths and detail preserves full snapshots", async () => {
    const fixture = await configFixture();
    const first = await runningRun(fixture, "%1");
    const second = await runningRun(fixture, "%2");
    await finishRun(first.paths, successfulResult(first.request.runId, "a".repeat(100_000)));
    await finishRun(second.paths, successfulResult(second.request.runId, "b".repeat(100_000)));
    const deps: SubagentDependencies = { configPath: fixture.path, env: {}, exec: aliveExec() };

    const waited = await createSubagentWaitTool(deps).execute(
        "call",
        { runIds: [first.request.runId, second.request.runId], condition: "all", timeoutSeconds: 30 },
        undefined,
        undefined,
        context(fixture.root),
    );
    const text = waited.content[0]?.type === "text" ? waited.content[0].text : "";
    const parsed = JSON.parse(text) as { reason: string; runs: Array<{ runId: string; status: string; output: string }> };

    assert.ok(Buffer.byteLength(text, "utf8") <= 50 * 1024);
    assert.deepEqual(Object.keys(parsed), ["reason", "runs"]);
    assert.equal(parsed.runs.length, 2);
    assert.deepEqual(parsed.runs.map(run => Object.keys(run)), [
        ["runId", "purpose", "profile", "status", "output"],
        ["runId", "purpose", "profile", "status", "output"],
    ]);
    assert.match(parsed.runs[0]?.output ?? "", /Output truncated.*detail=true/s);
    assert.match(parsed.runs[1]?.output ?? "", /Output truncated.*detail=true/s);
    assert.doesNotMatch(text, /result\.json|runDirectory|paths|accounting/);
    assert.equal("result" in (waited.details.runs[0] ?? {}), true);
    assert.equal("output" in (waited.details.runs[0]?.result ?? {}), false);

    const detailed = await createSubagentWaitTool(deps).execute(
        "call-detail",
        { runIds: [first.request.runId, second.request.runId], condition: "all", timeoutSeconds: 30, detail: true },
        undefined,
        undefined,
        context(fixture.root),
    );
    const detailedText = detailed.content[0]?.type === "text" ? detailed.content[0].text : "{}";
    const detailedModel = JSON.parse(detailedText) as { runs: Array<{ result: { output: string } }> };
    assert.match(detailedModel.runs[0]?.result.output ?? "", /result\.json/);
    assert.match(detailedModel.runs[1]?.result.output ?? "", /result\.json/);
});

test("standalone runner normalizes a fake Pi JSON stream into persisted result", async () => {
    const fixture = await configFixture();
    const fakePi = join(fixture.root, "fake-pi");
    const argsPath = join(fixture.root, "pi-args.txt");
    const envPath = join(fixture.root, "pi-env.txt");
    await writeFile(fakePi, `#!/bin/sh
printf '%s\\n' "$@" > '${argsPath}'
printf '%s\\n' "$PI_SUBAGENT_DEPTH|$PI_SUBAGENT_RUN_ID|$PI_SUBAGENT_ORIGIN_SESSION_ID" > '${envPath}'
cat >/dev/null
printf '%s\\n' \\
  '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello"}}' \\
  '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"final answer"}],"stopReason":"end","usage":{"input":2,"output":3,"cacheRead":0,"cacheWrite":0,"cost":{"total":0}}}}'
`);
    await chmod(fakePi, 0o700);
    fixture.config.harnesses.pi.command = fakePi;
    const run = await createRun(fixture.config, "full", fixture.profiles.profiles.full!, "Runner normalization", "private prompt", fixture.root, {
        callerProfile: "full", depth: 1, originSessionId: "session", originSessionFile: join(fixture.root, "session.jsonl"),
    });
    const legacyRequest = JSON.parse(await readFile(run.paths.request, "utf8")) as Record<string, unknown>;
    legacyRequest.schemaVersion = 2;
    delete legacyRequest.purpose;
    await writeFile(run.paths.request, `${JSON.stringify(legacyRequest)}\n`);
    await patchStatus(run.paths, { status: "starting" });
    await attachTmux(run.paths, {
        sessionId: "$0",
        session: "test",
        windowId: "@1",
        paneId: "%1",
        windowName: "sa-test",
    });
    await writeFile(run.paths.events, `${JSON.stringify({
        schemaVersion: 2, sequence: 7, timestamp: "before-restart", type: "diagnostic", data: { category: "protocol", message: "prior attempt" },
    })}\n`);

    await runSubagent(run.paths.directory);
    const snapshot = await readSnapshot(fixture.config.stateRoot, run.request.runId);
    assert.equal(snapshot.status, "succeeded");
    assert.equal(snapshot.purpose, "private prompt");
    assert.equal(snapshot.result?.output, "final answer");
    assert.equal(snapshot.result?.usage.input, 2);
    assert.equal(snapshot.result?.turns, 1);
    const args = await readFile(argsPath, "utf8");
    assert.match(args, /--no-extensions/);
    assert.match(args, /-e\n\/profile\.ts\n-e\n\/subagent\.ts/);
    assert.match(args, /--profile\nfull/);
    assert.equal((await readFile(envPath, "utf8")).trim(), `1|${run.request.runId}|session`);
    const events = (await readFile(run.paths.events, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { sequence: number });
    assert.ok(events.every((event, index) => index === 0 || event.sequence > events[index - 1]!.sequence));
    assert.match(await readFile(run.paths.events, "utf8"), /assistant_text/);
    assert.deepEqual(await runFinishedEvents(run.paths.events), [{ data: { outcome: "succeeded" } }]);
});

test("runner cooperatively stops the child process and persists a stopped result", async () => {
    const fixture = await configFixture();
    const fakePi = join(fixture.root, "slow-pi");
    await writeFile(fakePi, "#!/bin/sh\ncat >/dev/null\nexec sleep 10\n");
    await chmod(fakePi, 0o700);
    fixture.config.harnesses.pi.command = fakePi;
    const run = await createRun(fixture.config, "full", fixture.profiles.profiles.full!, "Cooperative stop", "task", fixture.root, {
        callerProfile: "full", depth: 1, originSessionId: "session",
    });
    await patchStatus(run.paths, { status: "starting" });
    await attachTmux(run.paths, { sessionId: "$0", session: "test", windowId: "@1", paneId: "%1", windowName: "sa-test" });
    const running = runSubagent(run.paths.directory);
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((await readSnapshot(fixture.config.stateRoot, run.request.runId)).status === "running") break;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    await requestRunStop(run.paths);
    await running;
    const snapshot = await readSnapshot(fixture.config.stateRoot, run.request.runId);
    assert.equal(snapshot.status, "stopped");
    assert.equal(snapshot.result?.stopMethod, "cooperative");
    assert.deepEqual(await runFinishedEvents(run.paths.events), [{
        data: { outcome: "stopped", method: "cooperative" },
    }]);
});

test("runner rejects split lineage before spawning Pi", async () => {
    const fixture = await configFixture();
    const marker = join(fixture.root, "spawned");
    const fakePi = join(fixture.root, "marker-pi");
    await writeFile(fakePi, `#!/bin/sh\ntouch '${marker}'\n`);
    await chmod(fakePi, 0o700);
    fixture.config.harnesses.pi.command = fakePi;
    const run = await createRun(fixture.config, "full", fixture.profiles.profiles.full!, "Integrity failure", "task", fixture.root, {
        callerProfile: "full", depth: 1, originSessionId: "session",
    });
    const resolved = JSON.parse(await readFile(run.paths.resolved, "utf8")) as Record<string, unknown>;
    resolved.targetProfile = "scout";
    await writeFile(run.paths.resolved, `${JSON.stringify(resolved)}\n`);
    await patchStatus(run.paths, { status: "starting" });
    await attachTmux(run.paths, { sessionId: "$0", session: "test", windowId: "@1", paneId: "%1", windowName: "sa-test" });
    await runSubagent(run.paths.directory);
    process.exitCode = undefined;
    const snapshot = await readSnapshot(fixture.config.stateRoot, run.request.runId).catch(() => undefined);
    assert.equal(snapshot, undefined);
    assert.equal(existsSync(marker), false);
    assert.match(await readFile(run.paths.stderr, "utf8"), /metadata disagree/);
    assert.deepEqual(await runFinishedEvents(run.paths.events), [{ data: { outcome: "failed" } }]);

    const legacy = await createRun(fixture.config, "full", fixture.profiles.profiles.full!, "Legacy live runner", "task", fixture.root, {
        callerProfile: "full", depth: 1, originSessionId: "session",
    });
    await patchStatus(legacy.paths, { status: "starting" });
    await attachTmux(legacy.paths, { sessionId: "$0", session: "test", windowId: "@2", paneId: "%2", windowName: "sa-legacy" });
    const legacyStatus = JSON.parse(await readFile(legacy.paths.status, "utf8")) as Record<string, unknown>;
    legacyStatus.schemaVersion = 2;
    await writeFile(legacy.paths.status, `${JSON.stringify(legacyStatus)}\n`);
    await runSubagent(legacy.paths.directory);
    process.exitCode = undefined;
    assert.equal(existsSync(marker), false);
    assert.match(await readFile(legacy.paths.stderr, "utf8"), /legacy status schema v2/);
    assert.deepEqual(await runFinishedEvents(legacy.paths.events), [{ data: { outcome: "failed" } }]);
});

test("stop terminalizes only the target, preserves immediate children, and is idempotent", async () => {
    const fixture = await configFixture();
    const parent = await createRun(fixture.config, "full", fixture.profiles.profiles.full!, "Parent task", "parent prompt", fixture.root, {
        callerProfile: "full", depth: 1, originSessionId: "session",
    });
    await patchStatus(parent.paths, { status: "starting" });
    await patchStatus(parent.paths, { status: "running", startedAt: "now" });
    await attachTmux(parent.paths, { sessionId: "$0", session: "test", windowId: "@1", paneId: "%parent", windowName: "sa-parent" });

    const child = await createRun(fixture.config, "scout", fixture.profiles.profiles.scout!, "Child task", "line one\nline two\nline three\nline four", fixture.root, {
        callerProfile: "full", depth: 2, parentRunId: parent.request.runId, originSessionId: "session",
    });
    await patchStatus(child.paths, { status: "starting" });
    await patchStatus(child.paths, { status: "running", startedAt: "now" });
    await attachTmux(child.paths, { sessionId: "$0", session: "test", windowId: "@2", paneId: "%child", windowName: "sa-child" });

    let now = 0;
    const killed: string[] = [];
    const tool = createSubagentStopTool({
        configPath: fixture.path,
        env: {},
        monotonicNow: () => now,
        sleep: async () => { now = 3000; },
        exec: async (command, args) => {
            if (command === "tmux" && args[0] === "display-message") return { stdout: "0\n", stderr: "", code: 0 };
            if (command === "tmux" && args[0] === "kill-pane") { killed.push(args.at(-1)!); return { stdout: "", stderr: "", code: 0 }; }
            return { stdout: "", stderr: "unexpected", code: 1 };
        },
    });
    const stopped = await tool.execute("stop-1", { runId: parent.request.runId }, undefined, undefined, context(fixture.root));
    const text = stopped.content[0]?.type === "text" ? stopped.content[0].text : "{}";
    const payload = JSON.parse(text) as { run: { status: string }; children: Array<{ runId: string; status: string; promptPreview: string; request?: unknown }> };
    assert.equal(payload.run.status, "stopped");
    assert.deepEqual(killed, ["%parent"]);
    assert.deepEqual(payload.children.map(item => item.runId), [child.request.runId]);
    assert.equal(payload.children[0]?.status, "running");
    assert.match(payload.children[0]?.promptPreview ?? "", /line one\nline two\nline three\n… prompt preview truncated/);
    assert.equal(payload.children[0]?.request, undefined);
    assert.equal((await readSnapshot(fixture.config.stateRoot, child.request.runId)).status, "running");
    assert.equal((await readSnapshot(fixture.config.stateRoot, parent.request.runId)).result?.stopMethod, "forced");

    const repeated = await tool.execute("stop-2", { runId: parent.request.runId }, undefined, undefined, context(fixture.root));
    assert.deepEqual(killed, ["%parent"]);
    assert.equal(repeated.usage, undefined);
});
