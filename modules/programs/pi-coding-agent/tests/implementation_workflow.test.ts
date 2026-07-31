import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const piRoot = join(import.meta.dirname, "..");
const skillsRoot = process.env.SKILLS_DEPLOYER_ROOT ?? join(piRoot, "..", "skills-deployer");

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

void test("explorer profile, delegation topology, and skill contract stay aligned", async () => {
    const skillPath = join(skillsRoot, "skills", "codebase-exploration", "SKILL.md");
    const [profile, subagent, question, registry, skill] = await Promise.all([
        text(join(piRoot, "extensions", "profile", "default.nix")),
        text(join(piRoot, "extensions", "subagent", "default.nix")),
        text(join(piRoot, "extensions", "question", "default.nix")),
        text(join(skillsRoot, "default.nix")),
        text(skillPath),
    ]);

    const explorerProfile = profile.slice(profile.indexOf("        explorer = {"), profile.indexOf("        tester = {"));
    assert.match(explorerProfile, /allowAllTools = false/);
    assert.match(explorerProfile, /tools = \[\]/);
    assert.match(explorerProfile, /Load and execute codebase-exploration/);
    assert.doesNotMatch(explorerProfile, /"edit"|"write"|subagent_start|save_agent_artifact/);
    assert.match(profile, /defaultTools = \["read" "grep" "find" "ls" "bash"\]/);
    assert.match(question, /profile\.defaultTools = \["question"\]/);
    assert.match(question, /subagent\.childExcludedTools = \["question"\]/);

    assert.match(profile, /explorerDelegationInstructions/);
    assert.equal(profile.match(/instructions = explorerDelegationInstructions;/g)?.length, 2);
    for (const phrase of [
        "before or during design",
        "before planning",
        "during other work",
        "during review",
        "Explore directly when",
        "Prefer explorer when",
        "use a hybrid",
        "Run multiple explorers in parallel only for distinct independent questions",
        "one local question",
        "included scope and explicit exclusions",
        "stopping condition",
        "Verify, compress, and integrate the result yourself",
    ]) {
        assert.match(profile, new RegExp(phrase));
    }

    assert.match(subagent, /allowedTargets = \["scout" "taskmaster" "focused-reviewer" "tester" "review-orchestrator" "explorer"\]/);
    assert.match(subagent, /allowedTargets = \["review-orchestrator" "focused-reviewer" "explorer"\]/);
    assert.equal(subagent.match(/allowedTargets = \[[^\]]*"explorer"[^\]]*\]/g)?.length, 2);
    assert.match(subagent, /explorer\.extensions\.subagent = \{\s*allowedTargets = \[\];\s*harness = "pi";/);

    assert.match(registry, /codebase-exploration = \{/);
    assert.match(registry, /source = \.\/skills\/codebase-exploration/);
    await access(skillPath);
    assert.match(skill, /name: codebase-exploration/);
    assert.match(skill, /disable-model-invocation: true/);
    for (const requiredHandoff of [
        "one local question",
        "context that made the question relevant",
        "included scope and explicit exclusions",
        "allowed operations, including the read-only boundary",
        "expected report content",
        "a stopping condition",
    ]) {
        assert.match(skill, new RegExp(requiredHandoff));
    }
    assert.match(skill, /Do not change source or configuration/);
    assert.match(skill, /## Stop Conditions/);
    assert.match(skill, /evidence-backed answer/);
    assert.match(skill, /specified scope has been fully examined/);
    assert.match(skill, /required information cannot be reached/);
    assert.match(skill, /further exploration no longer adds material information/);
    assert.match(
        skill,
        /## Question[\s\S]*## Scope[\s\S]*## Findings[\s\S]*## Evidence[\s\S]*## Constraints[\s\S]*## Unknowns[\s\S]*## Implications[\s\S]*## Confidence/,
    );
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
