import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
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

void test("implementation validation is one full-suite tester task with consistent deployment references", async () => {
    const skillsRoot = join(piRoot, "..", "skills-deployer");
    const [contract, validation, registry, profile] = await Promise.all([
        text(join(skillsRoot, "skills", "contract-implementation", "SKILL.md")),
        text(join(skillsRoot, "skills", "implementation-validation", "SKILL.md")),
        text(join(skillsRoot, "default.nix")),
        text(join(piRoot, "extensions", "profile", "default.nix")),
    ]);

    assert.match(validation, /name: implementation-validation/);
    assert.match(validation, /typecheck, lint, and full test-suite/);
    assert.match(validation, /aggregate command stops before later stages/);
    assert.match(validation, /standard independent command is[\s\S]*safe to run/);
    assert.doesNotMatch(validation, /smallest relevant check/);

    assert.match(contract, /one post-change full automated validation objective/);
    assert.match(contract, /in one task/);
    assert.match(contract, /one fresh[\s\S]*tester task/);
    assert.match(contract, /implementation-validation/);
    assert.doesNotMatch(contract, /bounded validation question|targeted-validation/);

    assert.match(registry, /implementation-validation = \{/);
    assert.match(registry, /\.\/skills\/implementation-validation\/SKILL\.md/);
    assert.doesNotMatch(registry, /targeted-validation/);
    assert.match(profile, /one post-change full automated validation objective/);
    assert.match(profile, /Load and execute implementation-validation/);
    assert.doesNotMatch(profile, /targeted-validation/);
    await assert.rejects(access(join(skillsRoot, "skills", "targeted-validation", "SKILL.md")));
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
