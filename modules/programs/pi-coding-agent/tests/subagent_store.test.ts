import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
    appendEvent,
    appendTerminalEvent,
    createRun,
    failRun,
    finishRun,
    finishStoppedRun,
    patchStatus,
    requestRunStop,
    readSnapshot,
    readStatus,
} from "../extensions_src/utilities/subagent_store.ts";
import { validateProfileConfig, type AgentProfile } from "../extensions_src/utilities/profile_types.ts";
import { withRunLock } from "../extensions_src/utilities/subagent_lock.ts";
import { validateSubagentRuntimeConfig, type SubagentRuntimeConfig } from "../extensions_src/utilities/subagent_types.ts";

const fullProfile: AgentProfile = { model: "provider/model", description: "Broad coding work.", allowAllTools: true, tools: [], extensions: { subagent: { allowedTargets: ["scout", "full"] } } };

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
        schemaVersion: 4,
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

test("concurrent stale-lock reclaimers preserve mutual exclusion", async () => {
    const { config } = await fixture();
    const run = await createRun(config, "full", fullProfile, "Stale lock", "task", "/work");
    const lockDirectory = join(run.paths.directory, ".lock");
    await mkdir(lockDirectory);
    await writeFile(join(lockDirectory, "owner.json"), JSON.stringify({ pid: 99_999_999, acquiredAt: "now", token: "dead" }));
    let active = 0;
    let maximumActive = 0;
    const operation = () => withRunLock(run.paths.directory, async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise(resolve => setTimeout(resolve, 20));
        active -= 1;
    });
    await Promise.all([operation(), operation()]);
    assert.equal(maximumActive, 1);
});

test("terminal event append is atomic, unique, and follows the persisted sequence", async () => {
    const { config } = await fixture();
    const run = await createRun(config, "full", fullProfile, "Terminal event", "task", "/work");
    await appendEvent(run.paths, {
        schemaVersion: 2, sequence: 4, timestamp: "start", type: "run_started", data: { profile: "full" },
    });
    const terminal = {
        schemaVersion: 2 as const, sequence: 1, timestamp: "finish", type: "run_finished" as const, data: { outcome: "stopped" },
    };

    const appended = await Promise.all([
        appendTerminalEvent(run.paths, terminal),
        appendTerminalEvent(run.paths, terminal),
    ]);
    assert.deepEqual(appended.sort(), [false, true]);
    const events = (await readFile(run.paths.events, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { sequence: number; type: string });
    assert.deepEqual(events.map(event => [event.sequence, event.type]), [[1, "parent_instruction"], [2, "run_started"], [3, "run_finished"]]);
});

test("sequenced event append repairs an interrupted tail", async () => {
    const { config } = await fixture(); const run = await createRun(config, "full", fullProfile, "Tail repair", "task", "/work");
    await writeFile(run.paths.events, `${await readFile(run.paths.events, "utf8")}{\"partial\":`, "utf8");
    await appendEvent(run.paths, { schemaVersion: 4, sequence: 99, timestamp: "ignored", type: "diagnostic", data: { message: "recovered" } });
    const events = (await readFile(run.paths.events, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { sequence: number; type: string });
    assert.deepEqual(events.map(event => [event.sequence, event.type]), [[1, "parent_instruction"], [2, "diagnostic"]]);
});

test("run lock does not mistake an operation EEXIST error for lock contention", async () => {
    const { config } = await fixture();
    const run = await createRun(config, "full", fullProfile, "Lock error", "task", "/work");
    let calls = 0;
    await assert.rejects(withRunLock(run.paths.directory, async () => {
        calls += 1;
        const error = new Error("operation collision") as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
    }), /operation collision/);
    assert.equal(calls, 1);
});

test("stop wins terminalization after stopping and legacy live statuses are rejected", async () => {
    const { config } = await fixture();
    const run = await createRun(config, "full", fullProfile, "Stop state", "task", "/work");
    await patchStatus(run.paths, { status: "starting" });
    await patchStatus(run.paths, { status: "running", startedAt: "start" });
    const stopping = await requestRunStop(run.paths);
    assert.equal(stopping.status, "stopping");
    const completion = await finishRun(run.paths, {
        schemaVersion: 3, runId: run.request.runId, outcome: "succeeded", output: "too late", error: null,
        usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        turns: 1, startedAt: "start", finishedAt: "finish",
    });
    assert.equal(completion.status, "stopping");
    await Promise.all([finishStoppedRun(run.paths, "cooperative"), finishStoppedRun(run.paths, "forced")]);
    const snapshot = await readSnapshot(config.stateRoot, run.request.runId);
    assert.equal(snapshot.status, "stopped");
    assert.equal(snapshot.result?.outcome, "stopped");
    assert.ok(snapshot.result?.stopMethod === "cooperative" || snapshot.result?.stopMethod === "forced");

    const failing = await createRun(config, "full", fullProfile, "Stop versus failure", "task", "/work");
    await patchStatus(failing.paths, { status: "starting" });
    await patchStatus(failing.paths, { status: "running", startedAt: "start" });
    await requestRunStop(failing.paths);
    const failed = await failRun(failing.paths, { category: "harness", message: "too late" }, "start");
    assert.equal(failed.status, "stopping");
    await finishStoppedRun(failing.paths, "cooperative");
    const failingSnapshot = await readSnapshot(config.stateRoot, failing.request.runId);
    assert.equal(failingSnapshot.status, "stopped");
    assert.equal(failingSnapshot.result?.outcome, "stopped");

    const legacy = await createRun(config, "full", fullProfile, "Legacy live", "task", "/work");
    const legacyStatus = JSON.parse(await readFile(legacy.paths.status, "utf8")) as Record<string, unknown>;
    legacyStatus.schemaVersion = 2;
    await writeFile(legacy.paths.status, `${JSON.stringify(legacyStatus)}\n`);
    await assert.rejects(requestRunStop(legacy.paths), /legacy live status schema v2/);
});

test("snapshot rejects split profile and lineage metadata", async () => {
    const { config } = await fixture();
    const run = await createRun(config, "full", fullProfile, "Integrity", "task", "/work", {
        callerProfile: "full", depth: 1, originSessionId: "session",
    });
    const resolved = JSON.parse(await readFile(run.paths.resolved, "utf8")) as Record<string, unknown>;
    resolved.callerProfile = "scout";
    await writeFile(run.paths.resolved, `${JSON.stringify(resolved)}\n`);
    await assert.rejects(readSnapshot(config.stateRoot, run.request.runId), /metadata disagree.*callerProfile/);

    const statusRun = await createRun(config, "full", fullProfile, "Status integrity", "task", "/work", {
        callerProfile: "full", depth: 1, originSessionId: "session",
    });
    const status = JSON.parse(await readFile(statusRun.paths.status, "utf8")) as Record<string, unknown>;
    status.originSessionId = "other-session";
    await writeFile(statusRun.paths.status, `${JSON.stringify(status)}\n`);
    await assert.rejects(readSnapshot(config.stateRoot, statusRun.request.runId), /metadata disagree.*originSessionId/);
});

test("runtime configs validate profile and subagent responsibilities independently", () => {
    const subagent = {
        schemaVersion: 1, stateRoot: "/state", runner: { node: "/node", script: "/runner", extensions: ["/profile", "/subagent"] },
        harnesses: { pi: { command: "/pi" } }, maxDepth: 3,
    };
    assert.equal(validateSubagentRuntimeConfig({ ...subagent, schemaVersion: 2 }).schemaVersion, 2);
    assert.throws(() => validateSubagentRuntimeConfig({ ...subagent, schemaVersion: 3 }), /schemaVersion/);
    assert.throws(() => validateSubagentRuntimeConfig({ ...subagent, maxDepth: -1 }), /maxDepth/);
    assert.throws(() => validateSubagentRuntimeConfig({ ...subagent, stateRoot: "x".repeat(4097) }), /4096/);

    const profile = { model: "provider/model", description: "Test routing.", allowAllTools: false, tools: [], extensions: {} };
    const base = { schemaVersion: 2, defaultProfile: "test", profileCycle: ["test"], profiles: { test: profile } };
    assert.throws(() => validateProfileConfig({ ...base, schemaVersion: 1 }), /schemaVersion/);
    assert.throws(() => validateProfileConfig({ ...base, profiles: { test: { ...profile, model: "" } } }), /non-empty/);
    assert.throws(() => validateProfileConfig({ ...base, profiles: { test: { ...profile, description: "" } } }), /non-empty/);
    assert.throws(() => validateProfileConfig({ ...base, profiles: { test: { ...profile, description: "😀".repeat(129) } } }), /512 UTF-8 bytes/);
    assert.throws(() => validateProfileConfig({ ...base, profiles: { test: { ...profile, model: "missing-provider" } } }), /provider\/model/);
    assert.throws(() => validateProfileConfig({ ...base, defaultProfile: "missing" }), /unknown profile/);
    assert.throws(() => validateProfileConfig({ ...base, profileCycle: [] }), /must not be empty/);
    assert.throws(() => validateProfileConfig({ ...base, profileCycle: ["test", "test"] }), /duplicates/);
    assert.throws(() => validateProfileConfig({ ...base, profiles: { test: { ...profile, allowAllTools: true, tools: ["read"] } } }), /cannot set tools/);
    assert.throws(() => validateProfileConfig({ ...base, profiles: { test: { ...profile, unexpected: true } } }), /unknown keys/);
});
