import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const piRoot = join(import.meta.dirname, "..");

async function text(path: string): Promise<string> {
    return readFile(path, "utf8");
}

void test("Pi implementation entrypoints are direct thin templates with explicit artifacts", async () => {
    const [impl, review, execute] = await Promise.all([
        text(join(piRoot, "prompts", "impl.md")),
        text(join(piRoot, "prompts", "review.md")),
        text(join(piRoot, "prompts", "execute.md")),
    ]);

    assert.match(impl, /contract-implementation/);
    assert.match(impl, /<approved-design-path>/);
    assert.match(impl, /Do not infer a latest design/);
    assert.doesNotMatch(impl, /orchestrated-review/);
    assert.match(review, /orchestrated-review/);
    assert.match(review, /<implementation-report-path>/);
    assert.match(execute, /implementation-workflow/);
    assert.match(execute, /<approved-design-path>/);
});

void test("Nix profile topology exposes routed specialist capabilities and child artifacts", async () => {
    const [profile, subagent, artifact] = await Promise.all([
        text(join(piRoot, "extensions", "profile", "default.nix")),
        text(join(piRoot, "extensions", "subagent", "default.nix")),
        text(join(piRoot, "extensions", "agent_artifact", "default.nix")),
    ]);

    for (const profileName of ["taskmaster", "tester", "review-orchestrator", "focused-reviewer", "dissent-reviewer"]) {
        assert.match(profile, new RegExp(`${profileName} = \\{`));
    }
    assert.match(profile, /impl = "taskmaster"/);
    assert.match(profile, /execute = "taskmaster"/);
    assert.match(profile, /review = "review-orchestrator"/);
    assert.match(subagent, /allowedTargets = \["tester" "review-orchestrator" "focused-reviewer"\]/);
    assert.match(subagent, /allowedTargets = \["focused-reviewer" "dissent-reviewer"\]/);
    assert.match(subagent, /agentArtifactExtension/);
    for (const profileName of ["taskmaster", "tester", "review-orchestrator"]) {
        assert.match(artifact, new RegExp(`${profileName}\\.tools = \\["save_agent_artifact"\\]`));
    }
});
