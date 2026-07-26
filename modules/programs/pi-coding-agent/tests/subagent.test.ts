import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
    createSubagentGetTool,
    createSubagentStartTool,
    registerSubagent,
    type SubagentDependencies,
} from "../extensions_src/subagent.ts";
import { runSubagent } from "../extensions_src/subagent_runner.ts";
import { attachTmux, createRun, patchStatus, readSnapshot } from "../extensions_src/utilities/subagent_store.ts";
import type { CommandExecutor } from "../extensions_src/utilities/subagent_tmux.ts";
import type { SubagentRuntimeConfig } from "../extensions_src/utilities/subagent_types.ts";

function context(cwd: string): ExtensionContext {
    return { cwd } as ExtensionContext;
}

async function configFixture(): Promise<{ root: string; path: string; config: SubagentRuntimeConfig }> {
    const root = await mkdtemp(join(tmpdir(), "subagent-tool-"));
    const config: SubagentRuntimeConfig = {
        schemaVersion: 1,
        stateRoot: join(root, "runs"),
        runner: { node: process.execPath, script: "/runner.ts" },
        harnesses: { pi: { command: "/pi" } },
        profiles: { coding: { harness: "pi", model: "provider/model", tools: ["read"] } },
    };
    const path = join(root, "config.json");
    await writeFile(path, JSON.stringify(config));
    return { root, path, config };
}

test("extension registers no tools unless tmux is verifiably available", async () => {
    const registered: string[] = [];
    const pi = {
        registerTool(tool: { name: string }) { registered.push(tool.name); },
        async exec() { return { stdout: "$0\tmain\t%1\n", stderr: "", code: 0, killed: false }; },
    } as unknown as ExtensionAPI;

    assert.equal(await registerSubagent(pi, { env: {} }), false);
    assert.deepEqual(registered, []);
    assert.equal(await registerSubagent(pi, { env: { TMUX: "/tmp/tmux,1,0" } }), true);
    assert.deepEqual(registered, ["subagent_start", "subagent_get"]);
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
    const deps: SubagentDependencies = { configPath: fixture.path, env: { TMUX: "yes" }, exec };
    const started = await createSubagentStartTool(deps).execute(
        "call",
        { profile: "coding", prompt: "task" },
        undefined,
        undefined,
        context(fixture.root),
    );
    assert.equal(started.details.status, "starting");
    assert.equal(started.details.tmux?.windowId, "@2");

    paneAlive = false;
    const fetched = await createSubagentGetTool(deps).execute(
        "call",
        { runId: started.details.runId },
        undefined,
        undefined,
        context(fixture.root),
    );
    assert.equal(fetched.details.status, "failed");
    assert.equal(fetched.details.result?.error?.category, "runner_lost");
});

test("standalone runner normalizes a fake Pi JSON stream into persisted result", async () => {
    const fixture = await configFixture();
    const fakePi = join(fixture.root, "fake-pi");
    await writeFile(fakePi, `#!/bin/sh
cat >/dev/null
printf '%s\\n' \\
  '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello"}}' \\
  '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"final answer"}],"stopReason":"end","usage":{"input":2,"output":3,"cacheRead":0,"cacheWrite":0,"cost":{"total":0}}}}'
`);
    await chmod(fakePi, 0o700);
    fixture.config.harnesses.pi.command = fakePi;
    const run = await createRun(fixture.config, "coding", "private prompt", fixture.root);
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
    assert.equal(snapshot.result?.usage.inputTokens, 2);
    assert.match(await readFile(run.paths.events, "utf8"), /assistant_text/);
});
