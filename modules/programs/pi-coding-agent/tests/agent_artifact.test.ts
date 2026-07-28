import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Value from "typebox/value";
import { createAgentArtifactToolDefinition } from "../extensions_src/agent_artifact.ts";
import { withPendingArtifactLock } from "../extensions_src/utilities/agent_artifact_lock.ts";
import {
    approvePendingArtifact,
    artifactParameters,
    createOrUpdatePendingArtifact,
    getJstTimestamp,
    readPendingArtifact,
    requestPendingArtifactRevision,
    requiresApproval,
} from "../extensions_src/utilities/agent_artifact_store.ts";
import { extensionContext as context, textResult as resultText } from "./test_helpers.ts";

const fixedDate = new Date("2026-07-17T15:31:45Z");

async function makeTemporaryRoot(t: test.TestContext): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "pi-agent-artifact-"));
    t.after(async () => {
        await rm(root, { recursive: true, force: true });
    });
    return root;
}

function toolParams(kind: "design" | "decision-record", slug: string, content: string, pendingId?: string): never {
    return { kind, slug, content, pendingId } as never;
}

test("artifact parameters accept design and decision-record with optional pending ids", () => {
    assert.equal(Value.Check(artifactParameters, { kind: "design", slug: "pi-workflow", content: "design" }), true);
    assert.equal(Value.Check(artifactParameters, { kind: "decision-record", slug: "pi-workflow-2", content: "record", pendingId: "20260718-003145-pi-workflow" }), true);

    for (const input of [
        { kind: "research", slug: "pi-workflow", content: "research" },
        { kind: "spec", slug: "pi-workflow", content: "retired kind" },
        { kind: "plan", slug: "pi-workflow", content: "retired kind" },
        { kind: "design", slug: "", content: "design" },
        { kind: "decision-record", slug: "Not-Kebab", content: "record" },
        { kind: "design", slug: "two--hyphens", content: "design" },
        { kind: "design", slug: "ok", content: "design", pendingId: "Bad" },
    ]) {
        assert.equal(Value.Check(artifactParameters, input), false);
    }
});

test("only the design kind requires its own approval", () => {
    assert.equal(requiresApproval("design"), true);
    assert.equal(requiresApproval("decision-record"), false);
});

test("JST timestamps are deterministic for an injected date", () => {
    assert.equal(getJstTimestamp(fixedDate), "20260718-003145");
});

test("pending creation writes content and metadata outside final directories", async t => {
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
    assert.equal(pending.title, "Design");
    assert.equal(pending.summary, "Short summary.");
    assert.equal(await readFile(pending.pendingPath, "utf8"), "# Design\n\nShort summary.\n");
    assert.deepEqual(await readdir(join(root, ".agents", "pending-artifacts")), ["20260718-003145-pi-workflow.json", "20260718-003145-pi-workflow.md"]);
    await assert.rejects(readdir(join(root, ".agents", "designs")));
});

test("parallel pending creation reserves distinct ids without losing content", async t => {
    const root = await makeTemporaryRoot(t);
    const [first, second] = await Promise.all([
        createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "parallel", content: "first", now: fixedDate }),
        createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "parallel", content: "second", now: fixedDate }),
    ]);

    assert.notEqual(first.id, second.id);
    assert.deepEqual(new Set([await readFile(first.pendingPath, "utf8"), await readFile(second.pendingPath, "utf8")]), new Set(["first", "second"]));
});

test("summary extraction prefers the Summary section over status metadata", async t => {
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

test("summary extraction falls back to non-metadata body paragraphs", async t => {
    const root = await makeTemporaryRoot(t);
    const pending = await createOrUpdatePendingArtifact({
        cwd: root,
        kind: "decision-record",
        slug: "fallback-summary",
        content: [
            "# Decision Record",
            "",
            "Design: .agents/designs/20260718-003145-pi-workflow.md",
            "Owner: pi-coding-agent",
            "---",
            "",
            "First useful fallback paragraph",
            "continues here.",
        ].join("\n"),
        now: fixedDate,
    });

    assert.equal(pending.summary, "First useful fallback paragraph continues here.");
});

test("summary extraction reports no summary when no body paragraph exists", async t => {
    const root = await makeTemporaryRoot(t);
    const pending = await createOrUpdatePendingArtifact({
        cwd: root,
        kind: "design",
        slug: "empty-summary",
        content: "# Design\n\nStatus: blocked\n\n## Summary\n\n## Scale Contract\n",
        now: fixedDate,
    });

    assert.equal(pending.summary, "No summary available.");
});

test("approval lock reclaims an ownerless lock left before owner publication", async t => {
    const root = await makeTemporaryRoot(t);
    const pendingDirectory = join(root, ".agents", "pending-artifacts");
    const pendingId = "20260718-003145-lock-recovery";
    await mkdir(join(pendingDirectory, `${pendingId}.approval-lock`), { recursive: true });
    let called = false;
    await withPendingArtifactLock(pendingDirectory, pendingId, async () => { called = true; });
    assert.equal(called, true);
});

test("approve promotes pending content to final and keeps metadata", async t => {
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

test("approval uses -v2 without clobbering an existing final", async t => {
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

test("parallel approval of different pending artifacts preserves every content", async t => {
    const root = await makeTemporaryRoot(t);
    const first = await createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "parallel", content: "first", now: fixedDate });
    const second = await createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "parallel", content: "second", now: fixedDate });

    const approved = await Promise.all([
        approvePendingArtifact(root, first.id, fixedDate),
        approvePendingArtifact(root, second.id, fixedDate),
    ]);

    assert.equal(new Set(approved.map(item => item.finalPath)).size, 2);
    assert.deepEqual(new Set(await Promise.all(approved.map(item => readFile(item.finalPath!, "utf8")))), new Set(["first", "second"]));
    assert.deepEqual(await readdir(join(root, ".agents", "designs")), [
        "20260718-003145-parallel-v2.md",
        "20260718-003145-parallel.md",
    ]);
});

test("parallel approval of the same pending id is serialized and idempotent", async t => {
    const root = await makeTemporaryRoot(t);
    const pending = await createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "same-pending", content: "one copy", now: fixedDate });

    const [first, second] = await Promise.all([
        approvePendingArtifact(root, pending.id, fixedDate),
        approvePendingArtifact(root, pending.id, fixedDate),
    ]);

    assert.equal(first.finalPath, second.finalPath);
    assert.deepEqual(await readdir(join(root, ".agents", "designs")), ["20260718-003145-same-pending.md"]);
    assert.deepEqual(await readdir(join(root, ".agents", "pending-artifacts")), [`${pending.id}.json`]);
});

test("approved metadata is idempotent and does not allocate another suffix", async t => {
    const root = await makeTemporaryRoot(t);
    const pending = await createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "retry-approved", content: "content", now: fixedDate });
    const first = await approvePendingArtifact(root, pending.id, fixedDate);
    const second = await approvePendingArtifact(root, pending.id, new Date("2026-07-18T01:00:00Z"));

    assert.deepEqual(second, first);
    assert.deepEqual(await readdir(join(root, ".agents", "designs")), ["20260718-003145-retry-approved.md"]);
});

test("approval recovers an injected interruption after final creation and before metadata update", async t => {
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
    assert.deepEqual(await readdir(directory), ["20260718-003145-recover.md"]);
    assert.deepEqual(await readdir(join(root, ".agents", "pending-artifacts")), [`${pending.id}.json`]);
});

test("revision request preserves pending and allows same id update", async t => {
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

test("tool fails closed without UI after creating only a pending design", async t => {
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
    assert.match(resultText(result.content[0]), /pending artifact was not promoted/);
    assert.deepEqual(await readdir(join(root, ".agents", "pending-artifacts")), [result.details.pendingId + ".json", result.details.pendingId + ".md"]);
    await assert.rejects(readdir(join(root, ".agents", "designs")));
});

test("decision records are saved directly without an approval prompt", async t => {
    const root = await makeTemporaryRoot(t);
    const tool = createAgentArtifactToolDefinition();
    const content = "# Decision Record\n\nWhy the direction changed.\n";
    const result = await tool.execute(
        "call",
        toolParams("decision-record", "why-we-changed", content),
        undefined,
        undefined,
        context({ cwd: root, mode: "print", hasUI: false }),
    );

    assert.equal(result.details.status, "approved");
    assert.deepEqual(await readdir(join(root, ".agents", "pending-artifacts")), [result.details.pendingId + ".json"]);
    assert.deepEqual(await readdir(join(root, ".agents", "decision-records")), [result.details.pendingId + ".md"]);
    assert.equal(await readFile(result.details.finalPath!, "utf8"), content);
    assert.match(resultText(result.content[0]), /does not need its own approval/);
});

test("tool approve/revision/reject UI statuses and action notes are deterministic", async t => {
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
    assert.equal(approved.details.title, "Design");
    assert.equal(approved.details.summary, "Useful approval summary.");
    assert.equal(await readFile(approved.details.finalPath!, "utf8"), approvedContent);
    assert.match(approvalReviewText, /Kind: design/);
    assert.match(approvalReviewText, /Summary: Useful approval summary\./);
    assert.match(approvalReviewText, /Line count: 8/);
    assert.match(resultText(approved.content[0]), /actionNote: looks good/);
    assert.match(resultText(approved.content[0]), new RegExp(`finalPath: ${approved.details.finalPath}`));
    const rendered = tool.renderResult?.(approved, { expanded: false } as never, { fg: (_color: string, text: string) => text } as never, {} as never);
    const renderedText = rendered?.render(160).join("\n") ?? "";
    assert.match(renderedText, /design Design/);
    assert.match(renderedText, /Useful approval summary\./);
    assert.match(renderedText, new RegExp(approved.details.finalPath!));

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

test("blank revision notes re-prompt without recording an instructionless revision", async t => {
    const root = await makeTemporaryRoot(t);
    const tool = createAgentArtifactToolDefinition();
    const selects = [
        "[ ] Request revision", "Submit responses",
        "[ ] Request revision", "Submit responses",
    ];
    const notes = ["   ", "add acceptance criteria"];
    const notifications: string[] = [];
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
                notify(message) { notifications.push(message); },
            },
        }),
    );

    assert.equal(result.details.status, "revision_requested");
    assert.equal(result.details.revisionInstructions, "add acceptance criteria");
    assert.deepEqual(notifications, ["Enter a non-blank note to continue."]);
});

test("View full text displays pending content and loops back to approval", async t => {
    const root = await makeTemporaryRoot(t);
    const tool = createAgentArtifactToolDefinition();
    const content = "# Design\n\nFull body.\n";
    const selects = ["[ ] View full text", "[ ] Approve"];
    const editorCalls: Array<{ title: string; initial?: string }> = [];
    const result = await tool.execute(
        "call",
        toolParams("design", "view-then-approve", content),
        undefined,
        undefined,
        context({
            cwd: root,
            mode: "rpc",
            hasUI: true,
            ui: {
                async select() { return selects.shift(); },
                async editor(title, initial) {
                    editorCalls.push({ title, initial });
                    return title.startsWith("Full text:") ? initial : "";
                },
            },
        }),
    );

    assert.equal(result.details.status, "approved");
    const fullText = editorCalls.find(call => call.title.startsWith("Full text:"));
    assert.equal(fullText?.initial, content);
    assert.equal(editorCalls.filter(call => call.title.startsWith("Full text:")).length, 1);
});

test("pending creation rejects an invalid slug before writing", async t => {
    const root = await makeTemporaryRoot(t);
    await assert.rejects(
        createOrUpdatePendingArtifact({ cwd: root, kind: "design", slug: "Invalid Slug", content: "content", now: fixedDate }),
        /lowercase kebab-case/,
    );
    assert.deepEqual(await readdir(root), []);
});
