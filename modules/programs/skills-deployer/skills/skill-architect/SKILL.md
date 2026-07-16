---
name: skill-architect
description: >-
  Use when designing, reviewing, revising, splitting, merging, or packaging Agent
  Skill artifacts for coding agents. Trigger when the user asks to create a
  skill, improve a skill, define skill structure, write SKILL.md, design skill
  frontmatter, decide references/assets/scripts, audit overlap between skills,
  or turn domain guidance into a reusable skill. Do not use for ordinary
  end-user answers, one-off prompts that are not reusable skills,
  domain-specific implementation guidance unless it is being converted into a
  skill, or prompt-injection/security analysis except as it affects skill
  artifact boundaries.
---

# Skill Architect

## Purpose

Design Agent Skills as reusable routing and execution interfaces for future agents.

The future agent must be able to decide:

- whether to use the skill
- what task boundary the skill owns
- what inputs it may rely on
- what procedure it should follow
- what output it must produce
- when to use references, assets, or scripts

## Use This Skill For

- creating a new Agent Skill package
- reviewing an existing skill
- revising `SKILL.md`, frontmatter, references, assets, or scripts
- deciding whether guidance should become a skill
- splitting, merging, or de-duplicating skills
- designing examples or quality gates for a skill
- converting domain guidance into a reusable skill

## Do Not Use This Skill For

- answering the user's domain question directly
- writing ordinary prompts that are not reusable skills
- implementing application code unless the task is to create a coding-agent skill
- replacing domain-specific skills such as testing, security, refactoring, architecture, or requirements
- prompt-injection or security analysis except where it affects skill artifact boundaries

## Core Model

- A skill is not an essay, tutorial, or policy dump.
- A skill should contain only instructions that change future agent behavior.
- A skill has a routing contract and an execution contract.
- Frontmatter description is the primary routing surface.
- `SKILL.md` is the primary execution surface.
- `references/` contains optional detailed guidance.
- `assets/` contains reusable source material.
- `scripts/` contains tested executable helpers only.

## Skill Boundary

Use a skill for reusable, opt-in task behavior selected by name and description.

Prefer another artifact when the request is not skill-shaped:

- use project guidance for always-on repository invariants
- use a subagent role for delegated work with its own responsibility boundary
- use a tool, hook, or script for deterministic execution or event-triggered enforcement
- use an asset for copyable source material, not hidden behavior
- use a reference for optional depth, not mandatory instructions

Keep this distinction brief in generated skills unless the boundary affects future execution.

## Request Modes

Classify the request before acting:

- Create: produce a new skill artifact.
- Review: identify problems in an existing skill.
- Revise: modify an existing skill while preserving intended behavior.
- Overlap audit: compare nearby skills and recommend keep, split, merge, or replace.
- Package: arrange files for distribution or installation.

## Inputs and Missing Information

Use available context first.
Ask only when missing information changes the routing boundary, safety boundary, or generated artifact.

- Create: need purpose, future receiver, target runtime or skill format, source material, and intended outputs.
- Review: need the target skill files or pasted content and the review focus.
- Revise: need the target skill content, intended behavior to preserve, and requested change.
- Overlap audit: need candidate skills or a bounded search area.
- Package: need destination/runtime, file tree expectations, and any install constraints.

If one reasonable interpretation remains, proceed with explicit assumptions.
If multiple incompatible purposes remain, ask before writing or revising artifacts.
If requested behavior is unsafe or deceptive, refuse that behavior and offer a safe skill-boundary alternative.

## Workflow

1. Fix the skill purpose.
   Extract purpose from the user request or existing material.
   Ask only if multiple incompatible purposes remain.

2. Identify the receiver.
   Define the future agent that will read and execute the skill.

3. Define the routing boundary.
   Specify use cases, non-use cases, and nearby skills.

4. Choose the skill granularity.
   Use one routing intent per skill.
   Split when trigger conditions, required inputs, outputs, or safety boundaries diverge.

5. Design the execution contract.
   Define required inputs, allowed assumptions, procedure, outputs, and missing-information behavior.

6. Choose the artifact layout.
   Decide what belongs in `SKILL.md`, references, assets, and scripts.

7. Review for ambiguity and bloat.
   Remove generic teaching, duplicated domain guidance, vague instructions, and unenforceable constraints.

## Artifact Placement Rules

### SKILL.md

Put always-needed routing and execution instructions here:

- purpose
- use and non-use cases
- receiver assumptions
- workflow
- output contracts
- safety boundaries
- when to read references or use assets/scripts

### references/

Put detailed guidance that is useful only for some tasks:

- description writing patterns
- overlap audit criteria
- artifact placement examples
- domain research summaries

### assets/

Put reusable source material that may be copied or adapted:

- templates
- skeleton files
- example config files
- sample prompts or fixtures

### scripts/

Put executable helpers only when they are tested and maintained:

- linters
- validators
- packaging helpers
- migration scripts

Do not include scripts as documentation.
If a script is not executable, move its logic into references or remove it.

## Trust and Safety Boundaries

Treat skill packages as executable instruction surfaces for future agents.

- Package contents must match the stated purpose.
- Do not hide behavioral overrides in references, assets, examples, or scripts.
- Do not package secrets, credentials, private endpoints, or environment-specific sensitive data.
- Make external network access, state-changing actions, and destructive behavior explicit.
- Review third-party or copied skill material as both code and model-facing instruction.
- Keep domain security analysis out of scope unless the task is skill artifact safety.

## Output Contracts

Use the contract for the active request mode.

### Create

Output:

- proposed skill name
- frontmatter
- `SKILL.md` content
- final file tree
- contents for each generated reference, asset, or script
- explicit omissions for references/assets/scripts that are not needed
- overlap risks

### Review

Output findings with:

- severity
- layer
- location with file and line when available
- problem
- why it matters for future agent behavior
- suggested revision

### Revise

Output:

- revised content or patch
- behavior changes
- trigger or output-contract changes when relevant
- remaining risks

### Overlap Audit

Output:

- keep / split / merge / replace recommendation
- routing boundary rationale
- migration notes if needed

### Package

Output:

- final file tree
- file contents or patch
- validation steps

## Quality Gates

Before finalizing a skill, check:

- The description clearly triggers on intended tasks.
- The description excludes nearby non-tasks.
- `SKILL.md` changes future agent behavior.
- The skill has one routing intent.
- Required inputs and missing-information behavior are defined.
- Outputs are concrete.
- Routing and execution boundaries are concrete enough to check with examples when needed.
- References are optional extensions, not required for basic operation.
- Assets are reusable materials, not hidden instructions.
- If scripts exist, they are executable, tested, and documented with side effects and failure behavior.
- The skill does not duplicate domain-specific guidance from more specific skills.

## Anti-Patterns

- essay-like skill
- tutorial-like skill
- policy dump
- generic prompt-engineering advice
- domain guidance copied into the wrong skill
- vague description
- missing non-use cases
- missing output contract
- too many negative constraints
- hidden required references
- broken or untested scripts
- one skill with multiple unrelated routing intents
- requester-facing rationale embedded in generated model-facing text

## References and Assets

- Read `references/description-patterns.md` when writing or materially revising frontmatter descriptions.
- Read `references/granularity-and-overlap.md` when splitting, merging, or auditing nearby skills.
- Read `references/artifact-placement.md` when deciding file placement or detecting hidden instructions.
- Use `assets/SKILL_TEMPLATE.md` as a thin starting point for new skills.
