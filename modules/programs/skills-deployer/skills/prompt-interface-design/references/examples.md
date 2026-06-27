# Prompt Interface Examples

Read when you need a concrete good/bad pattern for a specific receiver type.

## Expanded command prompt

Receiver: a model that only sees the post-expansion task, never the command.

Good:

`Prepare an implementation plan for the expanded user request. Use available
project context and relevant skills. Prefer the smallest behavior-correct
change. Return affected areas, implementation steps, risks, and verification
commands.`

Avoid:

`You are running the /impl command. Do not mention slash commands. Do not
repeat the implementation workflow.`

## Subagent handoff prompt

Receiver: a delegated agent responsible for one local task.

Good:

`Inspect the authentication module for authorization boundary risks related to
this change. Use read-only analysis. Return concrete findings with file
references, severity, and recommended fixes. Stop after the review report.`

Avoid:

`Help the main agent implement the whole feature. Remember the overall plan and
decide what to do next.`

## Agent profile / AGENTS.md instruction

Receiver: a model loading stable, always-on behavior.

Good:

`When editing modules, stage new files before building; flakes only read
git-tracked files.`

Avoid:

`For this PR, please remember to git add the new file you just created.`

## Reviewer prompt

Receiver: a model producing structured findings.

Good:

`Review the diff for behavior-preserving correctness. Return findings as
severity, evidence (file:line), impact, and smallest safe fix. Report only
issues with concrete impact.`

Avoid:

`Carefully review everything and tell me if anything looks off.`

## Prompt review output

Receiver: the requester, unless they ask for only the revised prompt.

Good:

`Issue: The prompt assumes the receiver can see command mechanics. Revision:
Replace command references with the post-expansion task objective.`

Avoid:

`This is a bad prompt. Do not do many things.`
