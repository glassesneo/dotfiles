# Description Patterns

## Purpose

Use this reference to write skill frontmatter descriptions that route the right requests to the skill and exclude nearby non-tasks.

## Description as Routing Contract

The `description` field is the primary routing surface.
Write it for the agent that decides whether to load the skill before seeing the full skill body.

A strong description answers:

- What task should trigger this skill?
- Which user words, artifact names, or file names signal that task?
- Which adjacent requests should not trigger it?
- What boundary keeps the skill from taking over a broader domain?

## Recommended Structure

Use three compact moves:

1. `Use when...`
   State the core reusable task.
2. `Trigger when...`
   Add concrete phrases, artifact names, and user intents.
3. `Do not use for...`
   Exclude nearby requests that share vocabulary but need a different response.

## Include Artifact Terms

Include terms users are likely to say:

- `SKILL.md`
- frontmatter
- description
- references
- assets
- scripts
- skill package
- skill structure
- routing
- overlap audit

Prefer concrete artifact names over abstract labels.

## Include Nearby Non-Tasks

Call out adjacent requests that should not select the skill.
Examples:

- ordinary end-user answers
- one-off prompts that are not reusable skills
- application implementation work
- domain-specific guidance unless it is being packaged as a skill
- security analysis except where artifact boundaries are the task

## Avoid Vague Verbs

Avoid descriptions built around vague verbs such as:

- help with
- assist
- improve
- support
- optimize

Use them only with a concrete task boundary.

Weak:

```yaml
description: Help with better skills and prompts.
```

Stronger:

```yaml
description: Use when creating, reviewing, revising, splitting, merging, or packaging Agent Skill artifacts. Trigger when the user asks to write SKILL.md, define skill frontmatter, choose references/assets/scripts, or audit overlap between skills. Do not use for one-off prompts or ordinary domain answers.
```

## Avoid Domain Overreach

Do not make an artifact-structural skill responsible for a domain.
If the skill packages testing guidance, it may define how that guidance becomes a skill.
It should not teach testing strategy itself unless the skill's purpose is testing.

## Description Revision Contract

When revising a description, output:

- before description
- after description
- what became more specific
- what was excluded
- trigger eval changes

Use trigger evals to show the routing effect of the revision.
Include at least a few should-trigger and should-not-trigger examples when the description change is material.

## Examples

### Good: Skill Architecture

```yaml
description: Use when designing, reviewing, revising, splitting, merging, or packaging Agent Skill artifacts. Trigger when the user asks to create a skill, improve SKILL.md, design frontmatter, decide references/assets/scripts, or audit overlap between skills. Do not use for ordinary end-user answers or domain implementation guidance unless it is being converted into a reusable skill.
```

Why it works:

- Names the artifact.
- Lists concrete trigger phrases.
- Excludes nearby non-tasks.
- Keeps the routing boundary on reusable skills.

### Bad: Generic Skill Help

```yaml
description: Helps agents write better instructions and improve workflows.
```

Problems:

- No concrete artifact boundary.
- No non-use cases.
- Overlaps with prompt writing, workflow design, documentation, and implementation.

### Bad: Domain Overreach

```yaml
description: Use when creating skills and when testing, securing, refactoring, or architecting applications.
```

Problems:

- Combines unrelated routing intents.
- Replaces domain-specific skills.
- Does not define a stable output contract.

### Good: Narrow Domain Packaging

```yaml
description: Use when converting existing accessibility review guidance into a reusable Agent Skill package. Trigger when the user asks to define accessibility skill frontmatter, SKILL.md workflow, references, assets, or eval cases. Do not use to perform an accessibility review unless the task is to package that review process as a skill.
```

Why it works:

- Keeps the skill-design task separate from the domain task.
- Allows domain vocabulary only as routing context.
