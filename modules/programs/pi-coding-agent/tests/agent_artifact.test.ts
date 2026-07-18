import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import Value from "typebox/value";
import { createAgentArtifactToolDefinition } from "../extensions/agent_artifact.ts";
import {
    approvePendingArtifact,
    artifactParameters,
    createOrUpdatePendingArtifact,
    getJstTimestamp,
    readPendingArtifact,
    requestPendingArtifactRevision,
    saveAgentArtifact,
} from "../extensions/utilities/agent_artifact_store.ts";

const fixedDate = new Date("2026-07-17T15:31:45Z");

async function makeTemporaryRoot(t: test.TestContext): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "pi-agent-artifact-"));
    t.after(async () => {
        await rm(root, { recursive: true, force: true });
    });
    return root;
}

function context(options: { cwd: string; mode: ExtensionContext["mode"]; hasUI: boolean; ui?: Partial<ExtensionUIContext> }): ExtensionContext {
    const unexpected = () => {
        throw new Error("Unexpected UI call");
    };
    return {
        cwd: options.cwd,
        mode: options.mode,
        hasUI: options.hasUI,
        ui: {
            select: unexpected,
            input: unexpected,
            editor: unexpected,
            notify: unexpected,
            custom: unexpected,
            ...options.ui,
        } as ExtensionUIContext,
    } as ExtensionContext;
}

function resultText(content: { type: string; text?: string }): string {
    assert.equal(content.type, "text");
    assert.equal(typeof content.text, "string");
    return content.text as string;
}

function toolParams(kind: "spec" | "plan", slug: string, content: string, pendingId?: string): never {
    return { kind, slug, content, pendingId } as never;
}

test("artifact parameters accept spec and plan with optional pending ids", () => {
    assert.equal(Value.Check(artifactParameters, { kind: "spec", slug: "pi-workflow", content: "spec" }), true);
    assert.equal(Value.Check(artifactParameters, { kind: "plan", slug: "pi-workflow-2", content: "plan", pendingId: "20260718-003145-pi-workflow" }), true);

    for (const input of [
        { kind: "research", slug: "pi-workflow", content: "research" },
        { kind: "spec", slug: "", content: "spec" },
        { kind: "plan", slug: "Not-Kebab", content: "plan" },
        { kind: "spec", slug: "two--hyphens", content: "spec" },
        { kind: "spec", slug: "ok", content: "spec", pendingId: "Bad" },
    ]) {
        assert.equal(Value.Check(artifactParameters, input), false);
    }
});

test("JST timestamps are deterministic for an injected date", () => {
    assert.equal(getJstTimestamp(fixedDate), "20260718-003145");
});

test("saveAgentArtifact keeps legacy direct-save collision behavior", async t => {
    const root = await makeTemporaryRoot(t);
    const project = join(root, "project");
    await mkdir(project);

    const first = await saveAgentArtifact({ cwd: project, kind: "plan", slug: "pi-workflow", content: "first", now: fixedDate });
    const second = await saveAgentArtifact({ cwd: project, kind: "plan", slug: "pi-workflow", content: "second", now: fixedDate });

    assert.equal(first.projectPath, join(project, ".agents", "plans", "20260718-003145-pi-workflow.md"));
    assert.equal(second.projectPath, join(project, ".agents", "plans", "20260718-003145-pi-workflow-v2.md"));
    assert.equal(await readFile(first.projectPath, "utf8"), "first");
    assert.equal(await readFile(second.projectPath, "utf8"), "second");
});

test("pending creation writes content and metadata outside final directories", async t => {
    const root = await makeTemporaryRoot(t);
    const pending = await createOrUpdatePendingArtifact({
        cwd: root,
        kind: "spec",
        slug: "pi-workflow",
        content: "# Specification\n\nShort summary.\n",
        now: fixedDate,
    });

    assert.equal(pending.id, "20260718-003145-pi-workflow");
    assert.equal(pending.state, "pending");
    assert.equal(pending.pendingPath, join(root, ".agents", "pending-artifacts", "20260718-003145-pi-workflow.md"));
    assert.equal(pending.plannedFinalPath, join(root, ".agents", "specs", "20260718-003145-pi-workflow.md"));
    assert.equal(pending.title, "Specification");
    assert.equal(pending.summary, "Short summary.");
    assert.equal(await readFile(pending.pendingPath, "utf8"), "# Specification\n\nShort summary.\n");
    assert.deepEqual(await readdir(join(root, ".agents", "pending-artifacts")), ["20260718-003145-pi-workflow.json", "20260718-003145-pi-workflow.md"]);
    await assert.rejects(readdir(join(root, ".agents", "specs")));
});

test("summary extraction prefers the Summary section over status metadata", async t => {
    const root = await makeTemporaryRoot(t);
    const pending = await createOrUpdatePendingArtifact({
        cwd: root,
        kind: "spec",
        slug: "summary-contract",
        content: [
            "# Specification: Summary Contract",
            "",
            "Status: decision-ready",
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

    assert.equal(pending.title, "Specification: Summary Contract");
    assert.equal(pending.summary, "Use the real summary even when it spans lines.");
});

test("summary extraction falls back to non-metadata body paragraphs", async t => {
    const root = await makeTemporaryRoot(t);
    const pending = await createOrUpdatePendingArtifact({
        cwd: root,
        kind: "plan",
        slug: "fallback-summary",
        content: [
            "# Implementation Plan",
            "",
            "Status: implementation-ready",
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
        kind: "plan",
        slug: "empty-summary",
        content: "# Implementation Plan\n\nStatus: blocked\n\n## Summary\n\n## Tasks\n",
        now: fixedDate,
    });

    assert.equal(pending.summary, "No summary available.");
});

test("approve promotes pending content to final and keeps metadata", async t => {
    const root = await makeTemporaryRoot(t);
    const pending = await createOrUpdatePendingArtifact({ cwd: root, kind: "spec", slug: "pi-workflow", content: "# Spec\n", now: fixedDate });
    const approved = await approvePendingArtifact(root, pending.id, fixedDate);

    assert.equal(approved.state, "approved");
    assert.equal(approved.finalPath, join(root, ".agents", "specs", "20260718-003145-pi-workflow.md"));
    assert.equal(await readFile(approved.finalPath!, "utf8"), "# Spec\n");
    const recovered = await readPendingArtifact(root, pending.id);
    assert.equal(recovered.finalPath, approved.finalPath);
    assert.equal(recovered.state, "approved");
});

test("approval uses -v2 when the final path collides", async t => {
    const root = await makeTemporaryRoot(t);
    await saveAgentArtifact({ cwd: root, kind: "plan", slug: "pi-workflow", content: "existing", now: fixedDate });
    const pending = await createOrUpdatePendingArtifact({ cwd: root, kind: "plan", slug: "pi-workflow", content: "new", now: fixedDate });
    const approved = await approvePendingArtifact(root, pending.id, fixedDate);
    assert.equal(approved.finalPath, join(root, ".agents", "plans", "20260718-003145-pi-workflow-v2.md"));
    assert.equal(await readFile(approved.finalPath!, "utf8"), "new");
});

test("revision request preserves pending and allows same id update", async t => {
    const root = await makeTemporaryRoot(t);
    const pending = await createOrUpdatePendingArtifact({ cwd: root, kind: "spec", slug: "pi-workflow", content: "old", now: fixedDate });
    const revision = await requestPendingArtifactRevision(root, pending.id, "add criteria", fixedDate);
    assert.equal(revision.state, "revision_requested");
    assert.equal(revision.revisionInstructions, "add criteria");
    assert.equal(await readFile(pending.pendingPath, "utf8"), "old");

    const updated = await createOrUpdatePendingArtifact({ cwd: root, kind: "spec", slug: "pi-workflow", pendingId: pending.id, content: "new", now: fixedDate });
    assert.equal(updated.id, pending.id);
    assert.equal(updated.state, "pending");
    assert.equal(await readFile(updated.pendingPath, "utf8"), "new");
});

test("tool fails closed without UI after creating only a pending artifact", async t => {
    const root = await makeTemporaryRoot(t);
    const tool = createAgentArtifactToolDefinition();
    const result = await tool.execute(
        "call",
        toolParams("spec", "pi-workflow", "# Spec\n"),
        undefined,
        undefined,
        context({ cwd: root, mode: "print", hasUI: false }),
    );

    assert.equal(result.details.status, "unavailable");
    assert.match(resultText(result.content[0]), /pending artifact was not promoted/);
    assert.deepEqual(await readdir(join(root, ".agents", "pending-artifacts")), [result.details.pendingId + ".json", result.details.pendingId + ".md"]);
    await assert.rejects(readdir(join(root, ".agents", "specs")));
});

test("tool approve/revision/reject UI statuses and action notes are deterministic", async t => {
    const root = await makeTemporaryRoot(t);
    const tool = createAgentArtifactToolDefinition();

    const approvedContent = "# Plan\n\nStatus: implementation-ready\n\n## Summary\n\nUseful approval summary.\n";
    let approvalReviewText = "";
    const approveSelects = ["[ ] Approve", "Submit answers"];
    const approved = await tool.execute(
        "call",
        toolParams("plan", "approve-me", approvedContent),
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
    assert.equal(approved.details.title, "Plan");
    assert.equal(approved.details.summary, "Useful approval summary.");
    assert.equal(await readFile(approved.details.finalPath!, "utf8"), approvedContent);
    assert.match(approvalReviewText, /Kind: plan/);
    assert.match(approvalReviewText, /Summary: Useful approval summary\./);
    assert.match(approvalReviewText, /Line count: 8/);
    assert.match(resultText(approved.content[0]), /actionNote: looks good/);
    assert.match(resultText(approved.content[0]), new RegExp(`finalPath: ${approved.details.finalPath}`));
    const rendered = tool.renderResult?.(approved, { expanded: false } as never, { fg: (_color: string, text: string) => text } as never, {} as never);
    const renderedText = rendered?.render(160).join("\n") ?? "";
    assert.match(renderedText, /plan Plan/);
    assert.match(renderedText, /Useful approval summary\./);
    assert.match(renderedText, new RegExp(approved.details.finalPath!));

    const reviseSelects = ["[ ] Request revision", "Submit answers"];
    const revision = await tool.execute(
        "call",
        toolParams("spec", "revise-me", "# Spec\n"),
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

    const rejectSelects = ["[ ] Reject", "Submit answers"];
    const rejected = await tool.execute(
        "call",
        toolParams("spec", "reject-me", "# Spec\n"),
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
        "[ ] Request revision", "Submit answers",
        "[ ] Request revision", "Submit answers",
    ];
    const notes = ["   ", "add acceptance criteria"];
    const notifications: string[] = [];
    const result = await tool.execute(
        "call",
        toolParams("spec", "blank-revision", "# Spec\n"),
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
    const content = "# Spec\n\nFull body.\n";
    const selects = ["[ ] View full text", "[ ] Approve"];
    const editorCalls: Array<{ title: string; initial?: string }> = [];
    const result = await tool.execute(
        "call",
        toolParams("spec", "view-then-approve", content),
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

test("saveAgentArtifact rejects an invalid slug before writing", async t => {
    const root = await makeTemporaryRoot(t);
    await assert.rejects(saveAgentArtifact({ cwd: root, kind: "spec", slug: "Invalid Slug", content: "content", now: fixedDate }), /lowercase kebab-case/);
    assert.deepEqual(await readdir(root), []);
});
