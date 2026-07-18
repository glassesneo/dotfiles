---
name: implementation-planning
description: >-
  Use when creating or revising an implementation-ready plan from a governing
  specification, artifact, or approved request. Covers approach selection,
  coverage, verification, and conditional task breakdown; do not use for
  specification authoring, source changes, or reports.
---

# Implementation Planning

Create or revise one implementation-ready plan. This Skill owns the correctness
of the implementation direction: a justified durable approach, coverage of the
governing basis, and verification that can demonstrate correctness. It does not
own specification authoring, implementation, delegation, reports, or physical
storage behavior.

## Governing Basis and Coverage

Classify the plan as one of:

- `spec-derived`: based on a governing specification; include its path and use
  `complete-spec` or `partial-spec` coverage;
- `artifact-derived`: based on another identified artifact; use
  `not-applicable` coverage;
- `request-derived`: based directly on an approved request; use
  `not-applicable` coverage.

A governing specification takes priority over other planning input. Record any
deviation rather than silently justifying it. For `partial-spec` coverage,
identify the selected slice and covered AC IDs, and list scope left for later
plans. For `complete-spec` coverage, cover every non-withdrawn AC through
verification or an explicit not-applicable rationale.

Resolve discoverable facts before asking the user. Do not invent scope,
interfaces, acceptance criteria, constraints, or verification requirements. An
`artifact-derived` or `request-derived` plan must use only correctness criteria
stated by its input plus plan-specific checks.

## Durable Approach

The first part of the plan must define the durable implementation approach.
Before selecting it:

1. Identify the viable approaches supported by repository evidence.
2. Compare their relevant tradeoffs, constraints, and effects on ownership or
   interfaces.
3. Select one approach and record why it is preferred.

When only one approach is genuinely viable, do not fabricate alternatives.
Instead, record why other apparent directions cannot satisfy the governing
basis or verified constraints.

## Verification Contract

For a `spec-derived` plan, map every in-scope AC ID to:

- the command, inspection, or runtime observation that will verify it; and
- the observable result that constitutes evidence of success.

Also define plan-specific regression checks, static analysis, formatting,
builds, evaluations, and runtime checks as applicable. A `partial-spec` plan
must distinguish covered AC IDs and the scope deferred to later plans. A
`complete-spec` plan must account for every non-withdrawn AC.

For an `artifact-derived` or `request-derived` approach-only plan, state why no
AC mapping exists. Verify only correctness criteria explicit in the input and
plan-specific risks; do not create missing acceptance criteria, scope, or
verification requirements.

## Specification Defect Feedback

If planning reveals a missing, contradictory, or unverifiable governing
specification requirement, do not repair it silently in the plan. Return
`Status: blocked` with a `spec_update_required` finding that identifies the
defect, the affected AC IDs or scope, its planning impact, and the required
specification revision. Resume planning only after the revised specification is
approved.

## Conditional Task Breakdown

The task breakdown is subordinate to the selected approach. Persist it as the
second part of a plan only when at least one condition applies:

- multiple implementers need parallel dispatch;
- work must be handed off across sessions;
- a `partial-spec` must be delivered in multiple phases.

Otherwise keep execution steps as a runtime todo and do not place a task
breakdown in the durable plan.

Only a `spec-derived` plan may persist a task breakdown. If an
`artifact-derived` or `request-derived` plan meets a persistence condition,
return `Status: blocked`: the need for durable coordination is evidence that a
specification is required. Create and obtain normal approval for the minimal
sufficient specification, then resume with a `spec-derived` plan.

Each persisted task must include:

- a stable task ID such as `T1`;
- its purpose;
- dependencies;
- completion criteria that reference applicable AC IDs;
- candidate paths bounded no more narrowly than individual files.

Do not fix future symbol names in the plan.

## Implementation-Ready Content

Include:

- title and summary;
- `Status: implementation-ready` or `Status: blocked`;
- basis, governing artifact path when applicable, and coverage;
- implementation scope and exclusions;
- repository facts and constraints;
- considered approaches, tradeoffs, selected approach, and rationale;
- AC-mapped verification when the basis is `spec-derived`, plus plan-specific
  checks;
- risks and mitigations;
- open questions, defaults, and intentional deferrals;
- a task breakdown only when the conditional persistence contract requires it.

Use `Status: implementation-ready` only when the selected approach and
verification have no material unresolved decisions and implementation can
proceed without inventing scope, interfaces, acceptance criteria, constraints,
or verification. Otherwise use `Status: blocked` and record the blocker.

## Artifact Boundary

The runtime artifact-writer contract alone owns candidate approval and
persistence. Follow that contract for those operations without reproducing its
storage or approval procedure in this Skill. Plan approval remains independent
of approval for any governing specification.

## Completion Output

Return:

- `Plan file: <artifact path | none>`
- `Status: <implementation-ready | blocked>`
- `Basis: <spec-derived | artifact-derived | request-derived>`
- `Coverage: <complete-spec | partial-spec | not-applicable>`
- `Summary: <concise summary>`
- `Verification: <concise verification approach>`
- `Risks/defaults/deferrals: <none | concise list>`

Report an artifact path only when approval and persistence completed; otherwise
use `Plan file: none`. Never fabricate a path or repeat the full artifact body
in this completion output.
