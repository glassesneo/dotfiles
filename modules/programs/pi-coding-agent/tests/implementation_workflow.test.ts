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
    const [act, impl, execute, operate, review] = await Promise.all(
        ["act", "impl", "execute", "operate", "review"].map(name => text(join(piRoot, "prompts", `${name}.md`))),
    );

    assert.match(act, /lightweight-implementation-lifecycle/);
    assert.match(act, /aligned-request/);
    assert.match(act, /explicit\s+confirmation/s);
    assert.doesNotMatch(act, /intent-elicitation|ideation-dialogue|specification-design|ideation-design|focused-reviewer|subagent_submit/);

    for (const prompt of [impl, execute, operate]) {
        assert.match(prompt, /implementation-lifecycle/);
        assert.match(prompt, /<approved-design-path>/);
        assert.match(prompt, /Do not infer a latest design/);
    }
    assert.match(impl, /local-no-review/);
    assert.match(execute, /local-reviewed/);
    assert.match(operate, /delegated-reviewed/);
    assert.match(review, /adaptive-review/);
    assert.match(review, /auto/);
    assert.match(review, /staged, unstaged, and untracked/);
    assert.match(review, /inconclusive/);
    assert.doesNotMatch(review, /implementation-report-path/);
    for (const prompt of [impl, execute, operate, review]) assert.doesNotMatch(prompt, /focused-reviewer|dissent-reviewer|subagent_submit/);
});

void test("lightweight lifecycle is packaged and bounds aligned execution, repair, review, and artifacts", async () => {
    const [skill, registry, guidance] = await Promise.all([
        text(join(skillsRoot, "skills", "lightweight-implementation-lifecycle", "SKILL.md")),
        text(join(skillsRoot, "default.nix")),
        text(join(skillsRoot, "AGENTS.md")),
    ]);
    const compact = skill.replace(/\s+/g, " ");

    assert.match(skill, /name: lightweight-implementation-lifecycle/);
    assert.doesNotMatch(skill, /disable-model-invocation/);
    assert.match(registry, /lightweight-implementation-lifecycle = \{/);
    assert.match(registry, /\.\/skills\/lightweight-implementation-lifecycle/);
    assert.match(guidance, /`lightweight-implementation-lifecycle` owns bounded self-implementation/);
    assert.match(compact, /`direct`.*`aligned-request`/);
    assert.match(compact, /explicit confirmation.*do not mutate source/s);
    assert.match(compact, /Do not delegate source work or validation/);
    assert.match(compact, /validation repair is limited to two rounds/);
    assert.match(compact, /one `reviewer` child.*`solo-only`/);
    assert.match(compact, /at most two reviewer passes total/);
    assert.match(compact, /without a third pass/);
    assert.match(compact, /unknown cause/);
    assert.match(compact, /test or infrastructure ownership/);
    assert.match(compact, /material scope or scale expansion/);
    assert.match(compact, /explicitly requested adaptive review always persists its review report/);
    assert.match(compact, /hard gate is blocking/);
});

void test("canonical assurance skills have aligned names, registry, and receiver boundaries", async () => {
    const names = ["source-implementation", "implementation-validation", "adaptive-review", "implementation-lifecycle"];
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
    for (const phrase of ["auto", "solo-only", "orchestrated", "exactly one canonical", "file count", "LOC", "two to four", "exactly one `dissent-reviewer`", "Execution mode", "Escalation evidence"]) assert.match(review!, new RegExp(phrase));
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

void test("lifecycle handoffs contain only task-specific deltas and preserve override ownership", async () => {
    const [lifecycleText, sourceText, validationText, explorationText, subagentSource] = await Promise.all([
        text(join(skillsRoot, "skills", "implementation-lifecycle", "SKILL.md")),
        text(join(skillsRoot, "skills", "source-implementation", "SKILL.md")),
        text(join(skillsRoot, "skills", "implementation-validation", "SKILL.md")),
        text(join(skillsRoot, "skills", "codebase-exploration", "SKILL.md")),
        text(join(piRoot, "extensions_src", "subagent.ts")),
    ]);
    const start = lifecycleText.indexOf("## Capability Handoffs");
    const handoffs = lifecycleText.slice(start, lifecycleText.indexOf("## Artifact Chain", start)).replace(/\s+/g, " ");
    const requiredValidationFields: Array<[RegExp, RegExp]> = [
        [/design/, /explicit approved design path/],
        [/concrete diff reference/, /concrete diff reference/],
        [/requested `focused \| broad \| full` level/, /requested level: `focused`, `broad`, or `full`/],
        [/level rationale/, /rationale for that level/],
        [/exactly one objective/, /exactly one concrete validation objective/],
        [/known risks/, /known risks/],
    ];

    assert.match(handoffs, /shared `subagent_run` and `subagent_submit` task-specific-delta guideline/);
    for (const phrase of ["design or bounded contract", "local source objective", "repository target", "current diff context", "known findings", "caller-specific constraints"]) {
        assert.match(handoffs, new RegExp(phrase));
    }
    assert.equal(handoffs.match(/repository target/g)?.length, 1);
    assert.match(sourceText.replace(/\s+/g, " "), /source objective and repository target/);
    assert.doesNotMatch(handoffs, /`source-implementation` output contract|failure classification|return shape|artifact persistence/);
    for (const [lifecycleField, receiverField] of requiredValidationFields) {
        assert.match(handoffs, lifecycleField);
        assert.match(validationText.replace(/\s+/g, " "), receiverField);
    }
    assert.match(handoffs, /review mode, defined target, applicable design, implementation report or diff reference/);
    assert.match(handoffs, /`focused-reviewer` and `dissent-reviewer`.*local lens or bounded dossier/);

    const explorationHandoffStart = explorationText.indexOf("## Required Handoff");
    const explorationHandoff = explorationText.slice(explorationHandoffStart, explorationText.indexOf("## Exploration Procedure", explorationHandoffStart)).replace(/\s+/g, " ");
    for (const phrase of ["one local question", "context that made the question relevant", "included scope and explicit exclusions"]) {
        assert.match(explorationHandoff, new RegExp(phrase));
    }
    assert.match(explorationHandoff, /starting files or symbols only when the question needs them/);
    assert.match(explorationHandoff, /Skill owns read-only operations, the default report shape, and stop conditions/);
    assert.doesNotMatch(explorationHandoff, /allowed operations, including|expected report content|a stopping condition;/);

    assert.match(subagentSource, /intentionally override the profile's normal skill, name the different skill/);
    assert.match(subagentSource, /skill path only for a task-specific resource that cannot be discovered by name/);
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

void test("generalized dialogue skills preserve distinct routing and adaptive completion contracts", async () => {
    const names = ["ideation-dialogue", "intent-elicitation"] as const;
    const [registry, ideation, elicitation] = await Promise.all([
        text(join(skillsRoot, "default.nix")),
        ...names.map(name => text(join(skillsRoot, "skills", name, "SKILL.md"))),
    ]);

    for (const [index, name] of names.entries()) {
        const skill = [ideation, elicitation][index]!;
        const compact = skill.replace(/\s+/g, " ");
        await access(join(skillsRoot, "skills", name, "SKILL.md"));
        assert.match(skill, new RegExp(`^---\\nname: ${name}\\n`));
        assert.match(registry, new RegExp(`^      ${name} = \\{`, "m"));
        assert.match(registry, new RegExp(`source = \\./skills/${name};`));
        assert.match(skill, /liminal-lens/);
        assert.match(skill, /Return the deliverable requested by the user/);
        assert.match(skill, /When no output form was requested/);
        assert.match(skill, /settled content/);
        assert.match(skill, /material remaining uncertainty/);
        assert.match(skill, /explicitly deferred/);
        assert.match(skill, /no fixed document schema/);
        assert.match(compact, /relevant context or external world/);
        assert.match(compact, /Investigate it when it can affect the requested outcome/);
        assert.match(compact, /investigate only relevant discoverable context and constraints/);
        assert.doesNotMatch(compact, /investigate repository facts|Establish the actual repository/);
        assert.match(compact, /inspect the proposed deliverable for consequential choices/);
        assert.match(compact, /must already have been settled with the user or be forced by verified constraints/);
        assert.match(compact, /Otherwise resume the dialogue/);
        assert.match(compact, /must not be the first place the user encounters that choice/);
        assert.doesNotMatch(skill, /## Artifact Boundary|## Scale Contract|## Acceptance Criteria/);
        assert.doesNotMatch(skill, /Save the design|Design file:|Decision record:|implementation-ready \| blocked/);
    }
    await Promise.all([
        assert.rejects(access(join(skillsRoot, "skills", "ideation-design", "SKILL.md")), { code: "ENOENT" }),
        assert.rejects(access(join(skillsRoot, "skills", "specification-design", "SKILL.md")), { code: "ENOENT" }),
    ]);
    assert.doesNotMatch(registry, /specification-design|ideation-design/);

    const ideationCompact = ideation.replace(/\s+/g, " ");
    assert.match(ideationCompact, /preference-led/);
    assert.match(ideationCompact, /Any point where more than one direction is defensible is user-owned/);
    assert.match(ideationCompact, /Open with free-form exploration, not options/);
    assert.match(ideationCompact, /reject the axis itself/);
    assert.match(ideationCompact, /offer to continue with `intent-elicitation`/);

    const elicitationCompact = elicitation.replace(/\s+/g, " ");
    assert.match(elicitationCompact, /user already substantially holds/);
    assert.match(elicitationCompact, /Challenge user input only when it conflicts with observed evidence or with itself/);
    assert.match(elicitationCompact, /observation, its concrete impact, and a viable alternative/);
    assert.match(elicitationCompact, /further answers can no longer change the requested outcome/);
    assert.match(elicitationCompact, /For software work, these may include existing interfaces/);
    assert.match(elicitationCompact, /offer to continue with `ideation-dialogue`/);
});

void test("design prompts add only artifact and scale contracts to generalized dialogue", async () => {
    const promptCases = [
        ["idea-design", "ideation-dialogue", "intent-elicitation"],
        ["spec-design", "intent-elicitation", "ideation-dialogue"],
    ] as const;

    for (const [promptName, dialogueSkill, otherDialogueSkill] of promptCases) {
        const prompt = await text(join(piRoot, "prompts", `${promptName}.md`));
        const compact = prompt.replace(/\s+/g, " ");
        assert.match(prompt, new RegExp("Use `" + dialogueSkill + "` as the dialogue method"));
        assert.match(compact, /`agent-artifact` as the format, approval, and persistence owner/);
        assert.match(compact, /one implementation-ready `design` artifact/);
        assert.match(compact, /when warranted, a companion `decision-record`/);
        assert.match(compact, /expected footprint, required new interfaces or dependencies, and an explicit do-not-build list/);
        assert.match(compact, /obtain the user's explicit agreement/);
        assert.match(prompt, /Design: <approved design path>/);
        assert.match(prompt, /Decision record: <path or none>/);
        assert.doesNotMatch(prompt, new RegExp(`${otherDialogueSkill}|ideation-design|specification-design`));
    }
});

void test("profiles expose command-independent implementation, validation, review, and operator capabilities", async () => {
    const profile = await text(join(piRoot, "extensions", "profile", "default.nix"));

    for (const profileName of ["scout", "taskmaster", "artisan", "operator", "tester", "reviewer"]) {
        const marker = `        ${profileName} = {`;
        const start = profile.indexOf(marker);
        assert.notEqual(start, -1);
        const block = profile.slice(start, profile.indexOf("        };", start) + 10);
        assert.match(block, /description = "[^"\n]+"/);
        assert.match(block, /instructions =/);
        assert.doesNotMatch(block, /entrypoint-selected|\/execute|\/operate|\/impl|slash command/);
    }
    assert.match(profile, /Use ideation-dialogue for open, preference-led shaping/);
    assert.match(profile, /intent-elicitation to draw out an outcome the user already substantially holds/);
    assert.match(profile, /Investigate directly when neither dialogue mode is needed/);
    assert.match(profile, /artifact creation is not a prerequisite for either dialogue mode/);
    assert.match(profile, /focused, broad, or full/);
    assert.match(profile, /profileCycle = listOfOption str \["scout" "taskmaster" "artisan" "operator" "reviewer"\]/);
    assert.match(profile, /review = "reviewer"/);
    assert.match(profile, /schemaVersion = 4/);
    assert.match(profile, /profiles = lib\.mapAttrs serializeProfile/);
    assert.match(profile, /profileNames == profileIdNames/);
    assert.match(profile, /profileIdValues.*lib\.unique/s);
    assert.match(profile, /act = "artisan"/);

    const artisanStart = profile.indexOf("        artisan = {");
    const artisanBlock = profile.slice(artisanStart, profile.indexOf("        scout = {", artisanStart));
    assert.match(artisanBlock, /model = "openai-codex\/gpt-5\.6-luna"/);
    assert.match(artisanBlock, /availability = \["top-level"\]/);
    assert.match(artisanBlock, /thinkingLevel = "xhigh"/);
    assert.match(artisanBlock, /tools = \["write" "edit"\]/);
    assert.match(artisanBlock, /lightweight-implementation-lifecycle in direct mode unless the current request explicitly selects another mode/);
    assert.match(artisanBlock, /Do not delegate source implementation or validation/);

    const taskmasterStart = profile.indexOf("        taskmaster = {");
    const taskmasterBlock = profile.slice(taskmasterStart, profile.indexOf("        artisan = {", taskmasterStart));
    assert.match(taskmasterBlock, /source-changing implementation specialist/);
    assert.match(taskmasterBlock, /Default to source-implementation.*implementation-lifecycle/);
    assert.match(taskmasterBlock, /required input is unavailable.*stop/);
    assert.doesNotMatch(taskmasterBlock, /inspect your diff|artifact persistence|Return concrete changed-file/);

    const explorerStart = profile.indexOf("        explorer = {");
    const explorerBlock = profile.slice(explorerStart, profile.indexOf("        tester = {", explorerStart));
    assert.match(explorerBlock, /read-only explorer subagent/);
    assert.match(explorerBlock, /Default to codebase-exploration/);
    assert.match(explorerBlock, /required local question is unavailable.*stop/);
    assert.doesNotMatch(explorerBlock, /expected report content|stopping condition|allowed operations/);

    const testerStart = profile.indexOf("        tester = {");
    const testerBlock = profile.slice(testerStart, profile.indexOf("        reviewer = {", testerStart));
    assert.match(testerBlock, /read-only validation specialist/);
    assert.match(testerBlock, /Default to implementation-validation/);
    assert.match(testerBlock, /required handoff input is unavailable.*stop/);
    assert.doesNotMatch(testerBlock, /aggregate command|classify every failure|persist non-trivial|Return concrete command evidence/);

    const reviewerStart = profile.indexOf("        reviewer = {");
    const reviewerBlock = profile.slice(reviewerStart, profile.indexOf("        focused-reviewer = {", reviewerStart));
    assert.match(reviewerBlock, /model = "openai-codex\/gpt-5\.6-sol"/);
    assert.match(reviewerBlock, /thinkingLevel = "high"/);
    assert.match(reviewerBlock, /Default to adaptive-review in auto mode/);
    assert.match(reviewerBlock, /required target is unavailable.*stop/);
    assert.doesNotMatch(reviewerBlock, /persist exactly one canonical review report|return its verdict/);

    const operatorStart = profile.indexOf("        operator = {");
    const operatorBlock = profile.slice(operatorStart, profile.indexOf("        cursor-implementer = {", operatorStart));
    assert.match(operatorBlock, /Default to implementation-lifecycle in delegated-reviewed mode/);
    assert.match(operatorBlock, /selecting taskmaster or cursor-implementer/);
    assert.match(operatorBlock, /required input is unavailable.*stop/);
    assert.doesNotMatch(operatorBlock, /same implementation agent ID|persist the artifact chain|independently inspect every diff/);
});
