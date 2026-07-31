import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const piRoot = join(import.meta.dirname, "..");
const skillsRoot = process.env.SKILLS_DEPLOYER_ROOT ?? join(piRoot, "..", "skills-deployer");

async function text(path: string): Promise<string> {
    return readFile(path, "utf8");
}

void test("implementation entrypoints are thin explicit mode templates", async () => {
    const [impl, execute, operate, review] = await Promise.all(
        ["impl", "execute", "operate", "review"].map(name => text(join(piRoot, "prompts", `${name}.md`))),
    );

    for (const prompt of [impl, execute, operate]) {
        assert.match(prompt, /implementation-lifecycle/);
        assert.match(prompt, /<approved-design-path>/);
        assert.match(prompt, /Do not infer a latest design/);
    }
    assert.match(impl, /local-no-review/);
    assert.match(execute, /local-reviewed/);
    assert.match(operate, /delegated-reviewed/);
    assert.match(review, /orchestrated-review/);
    assert.match(review, /<implementation-report-path>/);
    for (const prompt of [impl, execute, operate, review]) assert.doesNotMatch(prompt, /focused-reviewer|dissent-reviewer|subagent_start/);
});

void test("canonical assurance skills have aligned names, registry, and receiver boundaries", async () => {
    const names = ["source-implementation", "implementation-validation", "orchestrated-review", "implementation-lifecycle"];
    const [registry, guidance, ...skills] = await Promise.all([
        text(join(skillsRoot, "default.nix")),
        text(join(skillsRoot, "AGENTS.md")),
        ...names.map(name => text(join(skillsRoot, "skills", name, "SKILL.md"))),
    ]);

    for (const [index, name] of names.entries()) {
        await access(join(skillsRoot, "skills", name, "SKILL.md"));
        assert.match(skills[index]!, new RegExp(`name: ${name}`));
        assert.match(registry, new RegExp(`${name} = \\{`));
        assert.match(registry, new RegExp(`\\./skills/${name}`));
        assert.match(guidance, new RegExp(name));
    }
    const [implementation, validation, review, lifecycle] = skills;
    assert.match(implementation!, /source or configuration/);
    assert.match(implementation!, /concrete diff reference/);
    assert.match(implementation!, /Do not persist an implementation report/);
    assert.match(implementation!, /Validation verdicts, implementation reports, review verdicts/);
    assert.match(validation!, /focused.*broad.*full/s);
    assert.match(review!, /exactly once/);
    assert.match(lifecycle!, /local-no-review.*local-reviewed.*delegated-reviewed/s);
});

void test("validation contract implements adaptive levels, escalation, and failure ownership", async () => {
    const validation = (await text(join(skillsRoot, "skills", "implementation-validation", "SKILL.md"))).replace(/\s+/g, " ");
    for (const phrase of [
        "requested level", "rationale for that level", "focused", "broad", "full",
        "design applies at every level", "Do not silently lower", "actual levels",
        "aggregate command", "standard independent commands", "regression", "flaky", "test bug",
        "environment/infra", "unknown", "failure-report", "Do not create a success-only validation artifact",
    ]) assert.match(validation, new RegExp(phrase));
    assert.match(validation, /Escalate to `broad` or `full`/);
});

void test("lifecycle bounds remediation and creates terminal immutable report chains", async () => {
    const lifecycle = (await text(join(skillsRoot, "skills", "implementation-lifecycle", "SKILL.md"))).replace(/\s+/g, " ");

    assert.match(lifecycle, /Initial implementation does not consume a remediation round/);
    assert.match(lifecycle, /up to three/);
    assert.match(lifecycle, /initial review and the re-review after round 1, at most twice/);
    assert.match(lifecycle, /rounds 2 and 3.*one or two/s);
    assert.match(lifecycle, /omit dissent/);
    assert.match(lifecycle, /unknown cause/);
    assert.match(lifecycle, /without progress/);
    assert.match(lifecycle, /scope or scale expansion/);
    assert.match(lifecycle, /test or infrastructure ownership/);
    assert.match(lifecycle, /successful full validation for the current source state/);
    assert.match(lifecycle, /latest review pass with no blocking finding/);
    assert.match(lifecycle, /return `blocked`, not success/);
    assert.match(lifecycle, /save one immutable `implementation-report`/);
    assert.match(lifecycle, /previous implementation and review/);
    assert.match(lifecycle, /Never overwrite an artifact/);
});

void test("profiles expose command-independent implementation, validation, review, and operator capabilities", async () => {
    const [profile, subagent, artifact] = await Promise.all([
        text(join(piRoot, "extensions", "profile", "default.nix")),
        text(join(piRoot, "extensions", "subagent", "default.nix")),
        text(join(piRoot, "extensions", "agent_artifact", "default.nix")),
    ]);

    for (const profileName of ["scout", "taskmaster", "operator", "tester", "review-orchestrator"]) {
        const marker = `        ${profileName} = {`;
        const start = profile.indexOf(marker);
        assert.notEqual(start, -1);
        const block = profile.slice(start, profile.indexOf("        };", start) + 10);
        assert.match(block, /description = "[^"\n]+"/);
        assert.match(block, /instructions =/);
        assert.doesNotMatch(block, /entrypoint-selected|\/execute|\/operate|\/impl|slash command/);
    }
    assert.match(profile, /Use ideation-design when direction is open/);
    assert.match(profile, /specification-design when the user already holds/);
    assert.match(profile, /ordinary read-only investigation/);
    assert.match(profile, /focused, broad, or full/);
    assert.match(profile, /operate = "operator"/);
    assert.match(profile, /profileCycle = listOfOption str \["scout" "taskmaster" "operator" "review-orchestrator"\]/);

    const operatorStart = profile.indexOf("        operator = {");
    const operatorBlock = profile.slice(operatorStart, profile.indexOf("        explorer = {", operatorStart));
    assert.match(operatorBlock, /model = "openai-codex\/gpt-5\.6-sol"/);
    assert.match(operatorBlock, /thinkingLevel = "medium"/);
    assert.match(operatorBlock, /allowAllTools = false/);
    assert.match(operatorBlock, /tools = \[\]/);
    assert.doesNotMatch(operatorBlock, /"edit"|"write"/);
    assert.match(subagent, /allowedTargets = \["explorer" "taskmaster" "tester" "review-orchestrator" "focused-reviewer"\]/);
    assert.match(artifact, /operator\.tools = \["save_agent_artifact"\]/);
});
