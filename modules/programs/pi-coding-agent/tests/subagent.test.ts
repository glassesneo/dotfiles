import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
    createSubagentGetTool,
    createSubagentStartTool,
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
} from "../extensions_src/utilities/subagent_store.ts";
import type { CommandExecutor } from "../extensions_src/utilities/subagent_tmux.ts";
import type { AgentProfileConfig } from "../extensions_src/utilities/profile_types.ts";
import type { SubagentRuntimeConfig } from "../extensions_src/utilities/subagent_types.ts";

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
        schemaVersion: 1,
        defaultProfile: "full",
        profileCycle: ["scout", "full"],
        profiles: {
            scout: { model: "provider/model", allowAllTools: false, tools: ["read"], extensions: { subagent: { allowedTargets: ["scout"] } } },
            full: { model: "provider/model", allowAllTools: true, tools: [], extensions: { subagent: { allowedTargets: ["scout", "full"] } } },
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
    assert.deepEqual(registered, ["subagent_start", "subagent_get", "subagent_wait"]);
});

test("wait exposes the bounded required input schema", () => {
    const tool = createSubagentWaitTool({ configPath: "", env: {}, exec: aliveExec() });
    const schema = tool.parameters as unknown as {
        required: string[];
        properties: {
            runIds: { minItems: number; maxItems: number; uniqueItems: boolean };
            condition: { enum: string[] };
            timeoutSeconds: { type: string; minimum: number; maximum: number };
        };
    };

    assert.deepEqual(schema.required, ["runIds", "condition", "timeoutSeconds"]);
    assert.deepEqual(schema.properties.runIds, {
        type: "array",
        items: { type: "string", description: "UUID returned by subagent_start" },
        minItems: 1,
        maxItems: 128,
        uniqueItems: true,
    });
    assert.deepEqual(schema.properties.condition.enum, ["any", "all"]);
    assert.deepEqual(schema.properties.timeoutSeconds, { type: "integer", minimum: 1, maximum: 3600 });
});

test("get and wait metadata distinguish observation from synchronization", () => {
    const deps: SubagentDependencies = { configPath: "", env: {}, exec: aliveExec() };
    const get = createSubagentGetTool(deps);
    const wait = createSubagentWaitTool(deps);

    assert.match(get.description, /without waiting/);
    assert.match(get.description, /non-blocking status check/);
    assert.match(get.promptGuidelines?.join("\n") ?? "", /one-time non-blocking/);
    assert.match(wait.description, /terminal state \(succeeded or failed\)/);
    assert.match(wait.description, /Timeout is a normal result/);
    assert.match(wait.promptGuidelines?.join("\n") ?? "", /no useful independent work remains/);
    assert.match(wait.promptGuidelines?.join("\n") ?? "", /use subagent_get instead/);
});

test("start returns in starting state and get marks a disappeared runner failed", async () => {
    const fixture = await configFixture();
    let paneAlive = true;
    const exec: CommandExecutor = async (_command, args) => {
        if (args[0] === "display-message" && args.includes("#{session_id}\t#{session_name}\t#{pane_id}")) {
            return { stdout: "$0\tmain\t%1\n", stderr: "", code: 0 };
        }
        if (args[0] === "new-window") return { stdout: "@2\t%2\n", stderr: "", code: 0 };
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
        { profile: "full", prompt: "task" },
        undefined,
        undefined,
        context(fixture.root),
    );
    assert.equal(started.details.status, "starting");
    const startedText = started.content[0]?.type === "text" ? started.content[0].text : "{}";
    assert.equal((JSON.parse(startedText) as { tmux?: { windowId?: string } }).tmux?.windowId, "@2");

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
    assert.equal((JSON.parse(fetchedText) as { result?: { error?: { category?: string } } }).result?.error?.category, "runner_lost");
});

async function runningRun(fixture: Awaited<ReturnType<typeof configFixture>>, paneId: string) {
    const run = await createRun(fixture.config, "full", fixture.profiles.profiles.full!, `task ${paneId}`, fixture.root, {
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
    const waitedModel = JSON.parse(waitedText) as { runs: Array<{ result?: { error?: { category?: string } } }> };
    assert.equal(waitedModel.runs[0]?.result?.error?.category, "runner_lost");
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

test("wait keeps aggregate model JSON below 50KB and links omitted results", async () => {
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
    const parsed = JSON.parse(text) as { runs: Array<{ result: { output: string } }> };

    assert.ok(Buffer.byteLength(text, "utf8") <= 50 * 1024);
    assert.equal(parsed.runs.length, 2);
    assert.match(parsed.runs[0]?.result.output ?? "", /result\.json/);
    assert.match(parsed.runs[1]?.result.output ?? "", /result\.json/);
    assert.equal("result" in (waited.details.runs[0] ?? {}), false);
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
    const run = await createRun(fixture.config, "full", fixture.profiles.profiles.full!, "private prompt", fixture.root, {
        callerProfile: "full", depth: 1, originSessionId: "session", originSessionFile: join(fixture.root, "session.jsonl"),
    });
    await patchStatus(run.paths, { status: "starting" });
    await attachTmux(run.paths, {
        sessionId: "$0",
        session: "test",
        windowId: "@1",
        paneId: "%1",
        windowName: "sa-test",
    });

    await runSubagent(run.paths.directory);
    const snapshot = await readSnapshot(fixture.config.stateRoot, run.request.runId);
    assert.equal(snapshot.status, "succeeded");
    assert.equal(snapshot.result?.output, "final answer");
    assert.equal(snapshot.result?.usage.input, 2);
    assert.equal(snapshot.result?.turns, 1);
    const args = await readFile(argsPath, "utf8");
    assert.match(args, /--no-extensions/);
    assert.match(args, /-e\n\/profile\.ts\n-e\n\/subagent\.ts/);
    assert.match(args, /--profile\nfull/);
    assert.equal((await readFile(envPath, "utf8")).trim(), `1|${run.request.runId}|session`);
    assert.match(await readFile(run.paths.events, "utf8"), /assistant_text/);
});
