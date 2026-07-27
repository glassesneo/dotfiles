import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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
import { validateProfileConfig, type AgentProfile } from "../extensions_src/utilities/profile_types.ts";
import { validateSubagentRuntimeConfig, type SubagentRuntimeConfig } from "../extensions_src/utilities/subagent_types.ts";

const fullProfile: AgentProfile = { model: "provider/model", allowAllTools: true, tools: [], extensions: { subagent: { allowedTargets: ["scout", "full"] } } };

async function fixture(): Promise<{ root: string; config: SubagentRuntimeConfig }> {
    const root = await mkdtemp(join(tmpdir(), "subagent-store-"));
    return {
        root,
        config: {
            schemaVersion: 1,
            stateRoot: join(root, "runs"),
            runner: { node: "/nix/store/node/bin/node", script: "/nix/store/subagent_runner.ts", extensions: ["/nix/store/profile.ts", "/nix/store/subagent.ts"] },
            harnesses: { pi: { command: "/nix/store/pi/bin/pi" } },
            maxDepth: 3,
        },
    };
}

test("run store creates private canonical files without interpolating prompt into launcher", async () => {
    const { config } = await fixture();
    const prompt = "secret prompt with 'quotes'";
    await assert.rejects(
        createRun(config, "full", fullProfile, "x".repeat(121), prompt, "/work"),
        /at most 120 characters/,
    );
    const run = await createRun(config, "full", fullProfile, "Store contract", prompt, "/work");

    assert.match(run.request.runId, /^[0-9a-f-]{36}$/);
    assert.equal((await stat(run.paths.directory)).mode & 0o777, 0o700);
    assert.equal((await stat(run.paths.request)).mode & 0o777, 0o600);
    assert.equal((await stat(run.paths.launcher)).mode & 0o777, 0o700);
    const launcher = await readFile(run.paths.launcher, "utf8");
    assert.doesNotMatch(launcher, /secret prompt/);
    assert.doesNotMatch(launcher, /Store contract/);
    const persisted = JSON.parse(await readFile(run.paths.request, "utf8")) as { schemaVersion: number; purpose: string; prompt: string };
    assert.deepEqual({ schemaVersion: persisted.schemaVersion, purpose: persisted.purpose, prompt: persisted.prompt }, {
        schemaVersion: 3,
        purpose: "Store contract",
        prompt,
    });
});

test("run store normalizes legacy request v2 purpose from the first non-empty prompt line", async () => {
    const { config } = await fixture();
    const run = await createRun(config, "full", fullProfile, "Current purpose", "\n  Legacy   task  title  \nmore detail", "/work");
    const request = JSON.parse(await readFile(run.paths.request, "utf8")) as Record<string, unknown>;
    delete request.purpose;
    request.schemaVersion = 2;
    await writeFile(run.paths.request, `${JSON.stringify(request)}\n`);

    const snapshot = await readSnapshot(config.stateRoot, run.request.runId);
    assert.equal(snapshot.purpose, "Legacy task title");
    assert.equal(snapshot.profile, "full");
});

test("run store enforces state transitions and writes result before terminal status", async () => {
    const { config } = await fixture();
    const run = await createRun(config, "full", fullProfile, "State transitions", "task", "/work");
    await patchStatus(run.paths, { status: "starting" });
    await patchStatus(run.paths, { status: "running", startedAt: "2026-01-01T00:00:00.000Z" });
    await assert.rejects(patchStatus(run.paths, { status: "created" }), /Invalid run state transition/);

    await finishRun(run.paths, {
        schemaVersion: 2,
        runId: run.request.runId,
        outcome: "succeeded",
        output: "done",
        error: null,
        usage: {
            input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        turns: 1,
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
    });

    const status = await readStatus(run.paths);
    const snapshot = await readSnapshot(config.stateRoot, run.request.runId);
    assert.equal(status.status, "succeeded");
    assert.equal(snapshot.result?.output, "done");
    await assert.rejects(patchStatus(run.paths, { status: "failed" }), /Invalid run state transition/);
});

test("runtime configs validate profile and subagent responsibilities independently", () => {
    const subagent = {
        schemaVersion: 1, stateRoot: "/state", runner: { node: "/node", script: "/runner", extensions: ["/profile", "/subagent"] },
        harnesses: { pi: { command: "/pi" } }, maxDepth: 3,
    };
    assert.throws(() => validateSubagentRuntimeConfig({ ...subagent, schemaVersion: 2 }), /schemaVersion/);
    assert.throws(() => validateSubagentRuntimeConfig({ ...subagent, maxDepth: -1 }), /maxDepth/);
    assert.throws(() => validateSubagentRuntimeConfig({ ...subagent, stateRoot: "x".repeat(4097) }), /4096/);

    const profile = { model: "provider/model", allowAllTools: false, tools: [], extensions: {} };
    const base = { schemaVersion: 1, defaultProfile: "test", profileCycle: ["test"], profiles: { test: profile } };
    assert.throws(() => validateProfileConfig({ ...base, schemaVersion: 2 }), /schemaVersion/);
    assert.throws(() => validateProfileConfig({ ...base, profiles: { test: { ...profile, model: "" } } }), /non-empty/);
    assert.throws(() => validateProfileConfig({ ...base, profiles: { test: { ...profile, model: "missing-provider" } } }), /provider\/model/);
    assert.throws(() => validateProfileConfig({ ...base, defaultProfile: "missing" }), /unknown profile/);
    assert.throws(() => validateProfileConfig({ ...base, profileCycle: [] }), /must not be empty/);
    assert.throws(() => validateProfileConfig({ ...base, profileCycle: ["test", "test"] }), /duplicates/);
    assert.throws(() => validateProfileConfig({ ...base, profiles: { test: { ...profile, allowAllTools: true, tools: ["read"] } } }), /cannot set tools/);
    assert.throws(() => validateProfileConfig({ ...base, profiles: { test: { ...profile, unexpected: true } } }), /unknown keys/);
});
