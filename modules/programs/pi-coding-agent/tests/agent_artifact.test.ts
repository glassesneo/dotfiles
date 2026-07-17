import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Value from "typebox/value";
import {
    artifactParameters,
    getJstTimestamp,
    saveAgentArtifact,
} from "../extensions/agent_artifact_store.ts";

const fixedDate = new Date("2026-07-17T15:31:45Z");

async function makeTemporaryRoot(t: test.TestContext): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "pi-agent-artifact-"));
    t.after(async () => {
        await rm(root, { recursive: true, force: true });
    });
    return root;
}

test("artifact parameters accept only spec and plan with valid slugs", () => {
    assert.equal(
        Value.Check(artifactParameters, {
            kind: "spec",
            slug: "pi-workflow",
            content: "spec",
        }),
        true,
    );
    assert.equal(
        Value.Check(artifactParameters, {
            kind: "plan",
            slug: "pi-workflow-2",
            content: "plan",
        }),
        true,
    );

    for (const input of [
        { kind: "research", slug: "pi-workflow", content: "research" },
        { kind: "spec", slug: "", content: "spec" },
        { kind: "plan", slug: "Not-Kebab", content: "plan" },
        { kind: "spec", slug: "two--hyphens", content: "spec" },
    ]) {
        assert.equal(Value.Check(artifactParameters, input), false);
    }
});

test("JST timestamps are deterministic for an injected date", () => {
    assert.equal(getJstTimestamp(fixedDate), "20260718-003145");
});

test("saveAgentArtifact writes one project-local specification", async t => {
    const root = await makeTemporaryRoot(t);
    const project = join(root, "project");
    const unusedHome = join(root, "home");
    await mkdir(project);
    await mkdir(unusedHome);

    const saved = await saveAgentArtifact({
        cwd: project,
        kind: "spec",
        slug: "pi-workflow",
        content: "# Specification\n",
        now: fixedDate,
    });

    assert.equal(
        saved.projectPath,
        join(
            project,
            ".agents",
            "specs",
            "20260718-003145-pi-workflow.md",
        ),
    );
    assert.equal(await readFile(saved.projectPath, "utf8"), "# Specification\n");
    assert.deepEqual(
        await readdir(join(project, ".agents", "specs")),
        ["20260718-003145-pi-workflow.md"],
    );
    assert.deepEqual(await readdir(unusedHome), []);
});

test("saveAgentArtifact uses -v2 for a plan filename collision", async t => {
    const root = await makeTemporaryRoot(t);
    const project = join(root, "project");
    await mkdir(project);

    const first = await saveAgentArtifact({
        cwd: project,
        kind: "plan",
        slug: "pi-workflow",
        content: "first",
        now: fixedDate,
    });
    const second = await saveAgentArtifact({
        cwd: project,
        kind: "plan",
        slug: "pi-workflow",
        content: "second",
        now: fixedDate,
    });

    assert.equal(
        first.projectPath,
        join(project, ".agents", "plans", "20260718-003145-pi-workflow.md"),
    );
    assert.equal(
        second.projectPath,
        join(project, ".agents", "plans", "20260718-003145-pi-workflow-v2.md"),
    );
    assert.equal(await readFile(first.projectPath, "utf8"), "first");
    assert.equal(await readFile(second.projectPath, "utf8"), "second");
    assert.deepEqual(
        (await readdir(join(project, ".agents", "plans"))).sort(),
        [
            "20260718-003145-pi-workflow-v2.md",
            "20260718-003145-pi-workflow.md",
        ],
    );
});

test("saveAgentArtifact rejects an invalid slug before writing", async t => {
    const root = await makeTemporaryRoot(t);

    await assert.rejects(
        saveAgentArtifact({
            cwd: root,
            kind: "spec",
            slug: "Invalid Slug",
            content: "content",
            now: fixedDate,
        }),
        /lowercase kebab-case/,
    );
    assert.deepEqual(await readdir(root), []);
});
