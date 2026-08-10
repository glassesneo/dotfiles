import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeAtomicJson } from "../extensions_src/utilities/orchestration_json.ts";

// Given a JSON value and destination, when it crosses the orchestration persistence boundary, readers observe complete private JSON with no temporary sibling.
void test("atomic JSON publishes complete private content without temporary siblings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orchestration-json-"));
    const path = join(directory, "state.json");

    await writeAtomicJson(path, { schemaVersion: 1, state: "ready" });

    assert.equal(await readFile(path, "utf8"), '{\n  "schemaVersion": 1,\n  "state": "ready"\n}\n');
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(directory), ["state.json"]);
});

// Given a destination that cannot be replaced, when atomic publication fails, the caller observes failure without a leaked temporary file.
void test("atomic JSON removes its temporary file after publication failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orchestration-json-failure-"));
    const path = join(directory, "state.json");
    await mkdir(path);

    await assert.rejects(writeAtomicJson(path, { state: "blocked" }));

    assert.deepEqual(await readdir(directory), ["state.json"]);
    assert.equal((await stat(path)).isDirectory(), true);
});
