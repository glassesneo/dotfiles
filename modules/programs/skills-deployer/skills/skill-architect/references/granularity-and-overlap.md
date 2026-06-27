# Granularity and Overlap

## Purpose

Use this reference when deciding whether to keep, split, merge, replace, or de-duplicate Agent Skills.

## One Routing Intent Per Skill

A skill should have one routing intent: one recognizable class of user request that selects the skill and leads to a coherent execution contract.

One skill may support multiple modes when they share the same artifact boundary.
For example, creating, reviewing, and revising skill packages can belong together because they all operate on Agent Skill artifacts.

## Split When Trigger Population Differs

Split skills when different users, phrases, or situations should select different guidance.

Signals:

- One request mentions `SKILL.md`; another mentions application code.
- One task is a reusable artifact design task; another is a one-off answer.
- One skill should trigger automatically; another should be rare and explicit.

## Split When Required Inputs Differ

Split when the agent needs different inputs to proceed.

Examples:

- A skill-package task needs intended receiver, routing boundary, and output contract.
- A domain-review task needs source files, threat model, test results, or product requirements.

## Split When Output Contract Differs

Split when outputs are structurally different.

Examples:

- Skill creation outputs frontmatter, `SKILL.md`, references, assets, and eval cases.
- Code review outputs findings with severity and evidence.
- Implementation outputs source changes and validation results.

## Split When Safety Boundary Differs

Split when one task has materially different risk, authority, or side effects.

Examples:

- A skill design task is usually text/artifact work.
- A migration skill may alter many files or data paths.
- A security skill may handle sensitive threat assumptions.

## Merge When Skills Always Trigger Together

Merge when two skills have the same trigger population, require the same inputs, and produce one artifact.

Good merge candidate:

- A `skill-frontmatter-writer` skill and a `skill-body-writer` skill that are always used together to produce one `SKILL.md`.

Poor merge candidate:

- A skill architecture skill and a refactoring skill.
  One is artifact-structural; the other is domain-specific implementation guidance.

## Keep Separate: Domain-Specific vs Artifact-Structural

Keep skills separate when one skill defines how to package guidance and another defines domain execution.

Example:

- Artifact-structural skill: decides frontmatter, references, assets, scripts, and eval cases.
- Domain-specific skill: defines how to perform testing, security review, refactoring, architecture review, or requirements work.

The artifact-structural skill may help convert domain guidance into a reusable skill.
It should not replace the domain skill's expertise.

## Overlap Audit Table

Use this table for overlap audits:

| Candidate skill | Overlapping trigger | Unique responsibility | Conflict risk | Recommendation |
| --- | --- | --- | --- | --- |
| `<name>` | `<shared user phrase or task>` | `<what only this skill should own>` | `<low/medium/high and why>` | `<keep/split/merge/replace>` |

## Recommendations

Use these recommendation meanings:

- Keep: routing boundaries overlap in words but responsibilities are distinct.
- Split: one skill contains multiple routing intents or divergent outputs.
- Merge: skills always trigger together and produce one artifact.
- Replace: one skill fully subsumes another with a clearer routing and execution contract.

Include migration notes when users, file paths, or skill names must change.
