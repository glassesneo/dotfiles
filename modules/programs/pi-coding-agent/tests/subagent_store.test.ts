import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
    createRun,
    finishRun,
    patchStatus,
    readSnapshot,
    readStatus,
} from "../extensions_src/utilities/subagent_store.ts";
import { validateRuntimeConfig, type SubagentRuntimeConfig } from "../extensions_src/utilities/subagent_types.ts";

async function fixture(): Promise<{ root: string; config: SubagentRuntimeConfig }> {
    const root = await mkdtemp(join(tmpdir(), "subagent-store-"));
    return {
        root,
        config: {
            schemaVersion: 1,
            stateRoot: join(root, "runs"),
            runner: { node: "/nix/store/node/bin/node", script: "/nix/store/subagent_runner.ts" },
            harnesses: { pi: { command: "/nix/store/pi/bin/pi" } },
            profiles: { coding: { harness: "pi", model: "provider/model", tools: ["read"] } },
        },
    };
}

test("run store creates private canonical files without interpolating prompt into launcher", async () => {
    const { config } = await fixture();
    const prompt = "secret prompt with 'quotes'";
    const run = await createRun(config, "coding", prompt, "/work");

    assert.match(run.request.runId, /^[0-9a-f-]{36}$/);
    assert.equal((await stat(run.paths.directory)).mode & 0o777, 0o700);
    assert.equal((await stat(run.paths.request)).mode & 0o777, 0o600);
    assert.equal((await stat(run.paths.launcher)).mode & 0o777, 0o700);
    assert.doesNotMatch(await readFile(run.paths.launcher, "utf8"), /secret prompt/);
    assert.equal(JSON.parse(await readFile(run.paths.request, "utf8")).prompt, prompt);
});

test("run store enforces state transitions and writes result before terminal status", async () => {
    const { config } = await fixture();
    const run = await createRun(config, "coding", "task", "/work");
    await patchStatus(run.paths, { status: "starting" });
    await patchStatus(run.paths, { status: "running", startedAt: "2026-01-01T00:00:00.000Z" });
    await assert.rejects(patchStatus(run.paths, { status: "created" }), /Invalid run state transition/);

    await finishRun(run.paths, {
        schemaVersion: 1,
        runId: run.request.runId,
        outcome: "succeeded",
        output: "done",
        error: null,
        usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, turns: 1 },
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
    });

    const status = await readStatus(run.paths);
    const snapshot = await readSnapshot(config.stateRoot, run.request.runId);
    assert.equal(status.status, "succeeded");
    assert.equal(snapshot.result?.output, "done");
    await assert.rejects(patchStatus(run.paths, { status: "failed" }), /Invalid run state transition/);
});

test("unknown profile fails before allocating state", async () => {
    const { config } = await fixture();
    await assert.rejects(createRun(config, "missing", "task", "/work"), /Unknown subagent profile/);
});

test("runtime config rejects unsupported versions, harnesses, and empty models", () => {
    const base = {
        schemaVersion: 1,
        stateRoot: "/state",
        runner: { node: "/node", script: "/runner" },
        harnesses: { pi: { command: "/pi" } },
        profiles: { test: { harness: "pi", model: "model" } },
    };
    assert.throws(() => validateRuntimeConfig({ ...base, schemaVersion: 2 }), /schemaVersion/);
    assert.throws(() => validateRuntimeConfig({ ...base, profiles: { test: { harness: "cursor", model: "model" } } }), /unsupported/);
    assert.throws(() => validateRuntimeConfig({ ...base, profiles: { test: { harness: "pi", model: "" } } }), /non-empty/);
});
