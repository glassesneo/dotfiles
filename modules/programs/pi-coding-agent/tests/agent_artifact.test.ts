import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentArtifactToolDefinition } from "../extensions_src/agent_artifact.ts";
import { withPendingArtifactLock } from "../extensions_src/utilities/agent_artifact_lock.ts";
import {
    approvePendingArtifact,
    createOrUpdatePendingArtifact,
    getJstTimestamp,
    readPendingArtifact,
    requestPendingArtifactRevision,
    requiresApproval,
    type ArtifactKind,
} from "../extensions_src/utilities/agent_artifact_store.ts";
import { extensionContext as context } from "./test_helpers.ts";

const fixedDate = new Date("2026-07-17T15:31:45Z");

async function makeTemporaryRoot(t: test.TestContext): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "pi-agent-artifact-"));
    t.after(async () => {
        await rm(root, { recursive: true, force: true });
    });
    return root;
}

function toolParams(kind: ArtifactKind, slug: string, content: string, pendingId?: string): never {
    return { kind, slug, content, pendingId } as never;
}


void test("design approval is fail-closed while direct artifacts do not require it", () => {
    assert.equal(requiresApproval("design"), true);
    assert.equal(requiresApproval("research"), false);
});

void test("JST timestamps are deterministic for an injected date", () => {
    assert.equal(getJstTimestamp(fixedDate), "20260718-003145");
});

void test("pending creation writes content and metadata outside final directories", async t => {
    const root = await makeTemporaryRoot(t);
    const pending = await createOrUpdatePendingArtifact({
        cwd: root,
        kind: "design",
        slug: "pi-workflow",
        content: "# Design\n\nShort summary.\n",
        now: fixedDate,
    });

    assert.equal(pending.id, "20260718-003145-pi-workflow");
    assert.equal(pending.state, "pending");
    assert.equal(pending.pendingPath, join(root, ".agents", "pending-artifacts", "20260718-003145-pi-workflow.md"));
    assert.equal(pending.plannedFinalPath, join(root, ".agents", "designs", "20260718-003145-pi-workflow.md"));
    assert.equal(await readFile(pending.pendingPath, "utf8"), "# Design\n\nShort summary.\n");
    assert.equal((await readPendingArtifact(root, pending.id)).pendingPath, pending.pendingPath);
    await assert.rejects(access(pending.plannedFinalPath), error => (error as NodeJS.ErrnoException).code === "ENOENT");
});

void test("parallel pending creation reserves distinct ids without losing content", async t => {
    const root = await makeTemporaryRoot(t);
    const [first, second] = await Promise.all([
        createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "parallel", content: "first", now: fixedDate }),
        createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "parallel", content: "second", now: fixedDate }),
    ]);

    assert.notEqual(first.id, second.id);
    assert.deepEqual(new Set([await readFile(first.pendingPath, "utf8"), await readFile(second.pendingPath, "utf8")]), new Set(["first", "second"]));
});

void test("summary extraction prefers the Summary section over status metadata", async t => {
    const root = await makeTemporaryRoot(t);
    const pending = await createOrUpdatePendingArtifact({
        cwd: root,
        kind: "design",
        slug: "summary-contract",
        content: [
            "# Design: Summary Contract",
            "",
            "Status: implementation-ready",
            "",
            "## Summary",
            "Use the real summary",
            "even when it spans lines.",
            "",
            "## Problem",
            "Later content.",
        ].join("\n"),
        now: fixedDate,
    });

    assert.equal(pending.title, "Design: Summary Contract");
    assert.equal(pending.summary, "Use the real summary even when it spans lines.");
});


void test("approval lock reclaims an ownerless lock left before owner publication", async t => {
    const root = await makeTemporaryRoot(t);
    const pendingDirectory = join(root, ".agents", "pending-artifacts");
    const pendingId = "20260718-003145-lock-recovery";
    await mkdir(join(pendingDirectory, `${pendingId}.approval-lock`), { recursive: true });
    let called = false;
    await withPendingArtifactLock(pendingDirectory, pendingId, async () => { called = true; });
    assert.equal(called, true);
});

void test("approve promotes pending content to final and keeps metadata", async t => {
    const root = await makeTemporaryRoot(t);
    const pending = await createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "pi-workflow", content: "# Design\n", now: fixedDate });
    const approved = await approvePendingArtifact(root, pending.id, fixedDate);

    assert.equal(approved.state, "approved");
    assert.equal(approved.finalPath, join(root, ".agents", "designs", "20260718-003145-pi-workflow.md"));
    assert.equal(await readFile(approved.finalPath!, "utf8"), "# Design\n");
    const recovered = await readPendingArtifact(root, pending.id);
    assert.equal(recovered.finalPath, approved.finalPath);
    assert.equal(recovered.state, "approved");
});

void test("approval uses -v2 without clobbering an existing final", async t => {
    const root = await makeTemporaryRoot(t);
    const directory = join(root, ".agents", "designs");
    const existingPath = join(directory, "20260718-003145-pi-workflow.md");
    await mkdir(directory, { recursive: true });
    await writeFile(existingPath, "existing");
    const pending = await createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "pi-workflow", content: "new", now: fixedDate });
    const approved = await approvePendingArtifact(root, pending.id, fixedDate);
    assert.equal(approved.finalPath, join(directory, "20260718-003145-pi-workflow-v2.md"));
    assert.equal(await readFile(existingPath, "utf8"), "existing");
    assert.equal(await readFile(approved.finalPath!, "utf8"), "new");
});

void test("parallel approval of different pending artifacts preserves every content", async t => {
    const root = await makeTemporaryRoot(t);
    const first = await createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "parallel", content: "first", now: fixedDate });
    const second = await createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "parallel", content: "second", now: fixedDate });

    const approved = await Promise.all([
        approvePendingArtifact(root, first.id, fixedDate),
        approvePendingArtifact(root, second.id, fixedDate),
    ]);

    assert.equal(new Set(approved.map(item => item.finalPath)).size, 2);
    assert.deepEqual(new Set(await Promise.all(approved.map(item => readFile(item.finalPath!, "utf8")))), new Set(["first", "second"]));
});

void test("parallel approval of the same pending id is serialized and idempotent", async t => {
    const root = await makeTemporaryRoot(t);
    const pending = await createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "same-pending", content: "one copy", now: fixedDate });

    const [first, second] = await Promise.all([
        approvePendingArtifact(root, pending.id, fixedDate),
        approvePendingArtifact(root, pending.id, fixedDate),
    ]);

    assert.equal(first.finalPath, second.finalPath);
    assert.equal(await readFile(first.finalPath!, "utf8"), "one copy");
    await assert.rejects(access(pending.pendingPath), error => (error as NodeJS.ErrnoException).code === "ENOENT");
});

void test("approved metadata is idempotent and does not allocate another suffix", async t => {
    const root = await makeTemporaryRoot(t);
    const pending = await createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "retry-approved", content: "content", now: fixedDate });
    const first = await approvePendingArtifact(root, pending.id, fixedDate);
    const second = await approvePendingArtifact(root, pending.id, new Date("2026-07-18T01:00:00Z"));

    assert.deepEqual(second, first);
    assert.equal(await readFile(second.finalPath!, "utf8"), "content");
});

void test("approval recovers an injected interruption after final creation and before metadata update", async t => {
    const root = await makeTemporaryRoot(t);
    const pending = await createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "recover", content: "recover me", now: fixedDate });
    const directory = join(root, ".agents", "designs");
    const finalPath = join(directory, "20260718-003145-recover.md");
    await mkdir(directory, { recursive: true });
    await writeFile(`${finalPath}.pending-approval`, `${pending.id}\n`, { flag: "wx" });
    await writeFile(finalPath, "recover me", { flag: "wx" });

    const recovered = await approvePendingArtifact(root, pending.id, fixedDate);

    assert.equal(recovered.finalPath, finalPath);
    assert.equal((await readPendingArtifact(root, pending.id)).state, "approved");
    assert.equal(await readFile(finalPath, "utf8"), "recover me");
    await assert.rejects(access(`${finalPath}.pending-approval`), error => (error as NodeJS.ErrnoException).code === "ENOENT");
});

void test("revision request preserves pending and allows same id update", async t => {
    const root = await makeTemporaryRoot(t);
    const pending = await createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "pi-workflow", content: "old", now: fixedDate });
    const revision = await requestPendingArtifactRevision(root, pending.id, "add criteria", fixedDate);
    assert.equal(revision.state, "revision_requested");
    assert.equal(revision.revisionInstructions, "add criteria");
    assert.equal(await readFile(pending.pendingPath, "utf8"), "old");

    const updated = await createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "pi-workflow", pendingId: pending.id, content: "new", now: fixedDate });
    assert.equal(updated.id, pending.id);
    assert.equal(updated.state, "pending");
    assert.equal(await readFile(updated.pendingPath, "utf8"), "new");
});

void test("tool fails closed without UI after creating only a pending design", async t => {
    const root = await makeTemporaryRoot(t);
    const tool = createAgentArtifactToolDefinition();
    const result = await tool.execute(
        "call",
        toolParams("design", "pi-workflow", "# Design\n"),
        undefined,
        undefined,
        context({ cwd: root, mode: "print", hasUI: false }),
    );

    assert.equal(result.details.status, "unavailable");
    const pending = await readPendingArtifact(root, result.details.pendingId!);
    assert.equal(await readFile(pending.pendingPath, "utf8"), "# Design\n");
    await assert.rejects(access(pending.plannedFinalPath), error => (error as NodeJS.ErrnoException).code === "ENOENT");
});

void test("a non-design artifact is saved directly without UI approval", async t => {
    const root = await makeTemporaryRoot(t);
    const tool = createAgentArtifactToolDefinition();
    const content = "# Research\n\nDurable evidence.\n";
    const result = await tool.execute("call", toolParams("research", "save-research", content), undefined, undefined, context({ cwd: root, mode: "print", hasUI: false }));

    assert.equal(result.details.status, "approved");
    assert.equal(result.details.finalPath, join(root, ".agents", "research", `${result.details.pendingId}.md`));
    assert.equal(await readFile(result.details.finalPath!, "utf8"), content);
});

void test("tool approve/revision/reject UI statuses and action notes are deterministic", async t => {
    const root = await makeTemporaryRoot(t);
    const tool = createAgentArtifactToolDefinition();

    const approvedContent = "# Design\n\nStatus: implementation-ready\n\n## Summary\n\nUseful approval summary.\n";
    let approvalReviewText = "";
    const approveSelects = ["[ ] Approve", "Submit responses"];
    const approved = await tool.execute(
        "call",
        toolParams("design", "approve-me", approvedContent),
        undefined,
        undefined,
        context({
            cwd: root,
            mode: "rpc",
            hasUI: true,
            ui: {
                async select(title) { approvalReviewText ||= title; return approveSelects.shift(); },
                async editor() { return "looks good"; },
            },
        }),
    );
    assert.equal(approved.details.status, "approved");
    assert.equal(approved.details.actionNote, "looks good");
    assert.equal(await readFile(approved.details.finalPath!, "utf8"), approvedContent);
    assert.ok(approvalReviewText);

    const reviseSelects = ["[ ] Request revision", "Submit responses"];
    const revision = await tool.execute(
        "call",
        toolParams("design", "revise-me", "# Design\n"),
        undefined,
        undefined,
        context({
            cwd: root,
            mode: "rpc",
            hasUI: true,
            ui: { async select() { return reviseSelects.shift(); }, async editor() { return "tighten scope"; } },
        }),
    );
    assert.equal(revision.details.status, "revision_requested");
    assert.equal(revision.details.revisionInstructions, "tighten scope");
    assert.equal(revision.details.actionNote, "tighten scope");
    assert.equal((await readPendingArtifact(root, revision.details.pendingId)).revisionInstructions, "tighten scope");

    const rejectSelects = ["[ ] Reject", "Submit responses"];
    const rejected = await tool.execute(
        "call",
        toolParams("design", "reject-me", "# Design\n"),
        undefined,
        undefined,
        context({
            cwd: root,
            mode: "rpc",
            hasUI: true,
            ui: { async select() { return rejectSelects.shift(); }, async editor() { return "not needed"; } },
        }),
    );
    assert.equal(rejected.details.status, "rejected");
    assert.equal(rejected.details.actionNote, "not needed");
});

void test("blank revision notes re-prompt without recording an instructionless revision", async t => {
    const root = await makeTemporaryRoot(t);
    const tool = createAgentArtifactToolDefinition();
    const selects = [
        "[ ] Request revision", "Submit responses",
        "[ ] Request revision", "Submit responses",
    ];
    const notes = ["   ", "add acceptance criteria"];
    const result = await tool.execute(
        "call",
        toolParams("design", "blank-revision", "# Design\n"),
        undefined,
        undefined,
        context({
            cwd: root,
            mode: "rpc",
            hasUI: true,
            ui: {
                async select() { return selects.shift(); },
                async editor() { return notes.shift(); },
                notify() {},
            },
        }),
    );

    assert.equal(result.details.status, "revision_requested");
    assert.equal(result.details.revisionInstructions, "add acceptance criteria");
});


void test("pending creation rejects an invalid slug before writing", async t => {
    const root = await makeTemporaryRoot(t);
    await assert.rejects(
        createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "Invalid Slug", content: "content", now: fixedDate }),
        /lowercase kebab-case/,
    );
    assert.deepEqual(await readdir(root), []);
});
