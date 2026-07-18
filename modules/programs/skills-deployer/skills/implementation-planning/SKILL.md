---
name: implementation-planning
description: >-
  Use when creating or revising an implementation-ready plan from a governing
  specification, artifact, or approved request. Covers coverage, task breakdown,
  verification, approval, and persistence; do not use for specification authoring,
  source changes, or reports.
---

# Implementation Planning

Create or revise one implementation-ready plan. This Skill owns planning and
the plan's approval contract, not specification authoring, implementation,
delegation, reports, or physical storage behavior.

## Governing Basis

Classify the plan as one of:

- `spec-derived`: based on a governing specification; include its path and use
  `complete-spec` or `partial-spec` coverage;
- `artifact-derived`: based on another identified artifact; use
  `not-applicable` coverage;
- `request-derived`: based directly on an approved request; use
  `not-applicable` coverage.

A governing specification takes priority over other planning input. Record any
deviation rather than silently justifying it. For `partial-spec` coverage,
identify the selected slice, covered acceptance criteria, and work intentionally
left for later plans.

Resolve discoverable facts before asking the user. Do not invent scope,
architecture, interfaces, acceptance criteria, or verification. If the basis is
insufficient, report `Status: blocked` with the missing decisions in the
completion output. Do not submit a plan artifact until those decisions are
resolved and the plan is implementation-ready.

## Planning Workflow

1. Establish the governing basis, coverage, constraints, and repository facts.
   Resolve material blocking decisions first; the `question` tool may be used
   for those decisions.
2. Complete an implementation-ready candidate plan with scope, paths, ordered
   work, verification, risks, defaults, and deferrals.
3. When the runtime artifact writer provides pending review and approval,
   submit the completed Markdown body directly to it with logical kind `plan`.
   Do not print the full candidate in normal assistant text first or ask a
   separate `question` solely to approve its body. The writer's pending review
   is the single candidate-approval and final-promotion gate.
4. If the writer returns a revision request, revise the same pending artifact
   and resubmit the complete body with the same pending identifier. Do not
   repeat the revised body in normal assistant text.
5. Report a final artifact path only after the writer reports approval. If no
   writer exists, or its contract cannot obtain approval before final
   persistence, stop and report the blocker instead of inventing storage
   behavior.

Do not create a final plan before approval. Plan approval is independent of any
approval previously given to its governing specification.

## Implementation-Ready Content

Include:

- title and summary;
- `Status: implementation-ready` or `Status: blocked`;
- basis, governing artifact path when applicable, and coverage;
- implementation scope and exclusions;
- ordered implementation steps;
- known or candidate paths;
- risks and mitigations;
- verification approach;
- open questions, defaults, and intentional deferrals;
- a `Task Breakdown` with task IDs (`T1`, `T2`, ...).

For every task, include:

- target files to edit;
- the change required in each target file;
- documentation update targets, using `none` when no update is needed;
- files to refer to and why, when needed;
- prerequisites or dependency graph, when needed;
- completion criteria.

Use `Status: implementation-ready` only when implementation can proceed without
inventing scope, architecture, interfaces, acceptance criteria, or verification.
Otherwise use `Status: blocked` and record the blocker.

## Completion Output

Return:

- `Plan file: <artifact path | none>`
- `Status: <implementation-ready | blocked>`
- `Basis: <spec-derived | artifact-derived | request-derived>`
- `Coverage: <complete-spec | partial-spec | not-applicable>`
- `Summary: <concise summary>`
- `Verification: <concise verification approach>`
- `Risks/defaults/deferrals: <none | concise list>`

Use `Plan file: none` when no artifact was persisted because approval,
readiness, or the writer contract is missing. Never fabricate an artifact path
or repeat the full artifact body in this completion output.
