---
name: specification-authoring
description: >-
  Use when creating or revising a decision-ready specification from a request.
  Covers requirements discovery, settlement, acceptance criteria, and readiness;
  do not use for implementation planning, source changes, or reports.
---

# Specification Authoring

Create or revise one decision-ready specification. This Skill owns the
correctness of what is to be built: alignment with the user's goal, coherent
scope and constraints, verifiable acceptance criteria, and resolution of
material open decisions. It does not own implementation approaches, task
breakdowns, implementation, delegation, reports, or physical storage behavior.

## Required Input and Settlement

Start from the user's request and any governing artifacts they identify. Treat
the user's goal as fixed input. At the start of discovery, treat user-provided
solutions, requirements, and constraints as drafts that may be challenged until
the user confirms them.

Use available repository and external evidence to resolve discoverable facts.
Delegate question-cost decisions, bounded choices, provisional judgments, and
question-count control to `liminal-lens`; do not reproduce those mechanics here.

After a challenge, treat points the user confirms as settled. Treat every point
in an approved specification as settled. Do not reopen settled points later in
the same workflow.

## Discovery Workflow

1. Establish the problem, fixed user goal, governing evidence, and material
   decision boundaries.
2. Test proposed solutions, requirements, and constraints for alignment with
   the goal and for consistency with scope, interfaces, acceptance criteria,
   and other constraints.
3. When challenging draft input, provide observed evidence, the problematic
   impact, and a viable alternative. Do not challenge from preference alone.
4. Use `liminal-lens` for any material decision that remains after
   investigation. Stop asking questions once further answers cannot change
   scope, acceptance criteria, or implementation approach.
5. Record both accepted and rejected challenges. For each, preserve the
   challenged input, evidence, alternative, user decision, and resulting effect
   on the specification.
6. Complete the candidate only after scope, interfaces, constraints, and
   acceptance criteria are coherent and all material decisions are settled.

## Acceptance-Criteria Identity

Assign stable sequential IDs such as `AC1` and `AC2` to acceptance criteria.
Treat IDs as append-only across revisions: never renumber an existing ID and
never reuse a gap. Keep a withdrawn criterion in place and mark it `withdrawn`
instead of deleting it.

AC IDs are logical references between specification, plan, task completion
criteria, and reports. Keep them in the artifact layer; do not embed them in
code, comments, or test names. Record test-to-AC mappings in a plan or report.

## Decision-Ready Content

The specification must include:

- title, summary, problem, and user goal;
- `Status: decision-ready` or `Status: not decision-ready`;
- in-scope and out-of-scope work;
- interfaces, constraints, and non-goals at the level needed for planning;
- acceptance criteria with stable AC IDs;
- implementation, review, and testing correctness criteria;
- risks and mitigations;
- blocking and non-blocking open questions;
- chosen defaults and intentional deferrals;
- accepted and rejected challenge records;
- affected repository areas and useful evidence notes.

Use `Status: decision-ready` only when planning can proceed without inventing
scope, interfaces, constraints, or acceptance criteria. Otherwise use
`Status: not decision-ready` and identify the blocking questions.

## Artifact Boundary

The runtime artifact-writer contract alone owns candidate approval and
persistence. Follow that contract for those operations without reproducing its
storage or approval procedure in this Skill.

## Completion Output

Return:

- `Spec file: <artifact path | none>`
- `Status: <decision-ready | not decision-ready>`
- `Summary: <concise summary>`
- `Blocking questions: <none | concise list>`
- `Non-blocking questions/defaults/deferrals: <none | concise list>`

Report an artifact path only when approval and persistence completed; otherwise
use `Spec file: none`. Never fabricate a path or repeat the full artifact body
in this completion output.
