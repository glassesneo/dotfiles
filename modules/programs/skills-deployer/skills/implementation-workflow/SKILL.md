---
name: implementation-workflow
disable-model-invocation: true
description: >-
  Use when a taskmaster must compose approved-design implementation and
  orchestrated review in one post-approval execution. Trigger for an explicit
  design-to-implementation-report-to-review-report workflow. Do not use for
  design authoring, implementation without review, review-only work, or direct
  small changes.
---

# Implementation Workflow

Compose `contract-implementation` and `orchestrated-review` through their
canonical artifact paths. This Skill owns ordering, stop conditions, and final
aggregation only; each component Skill owns its local procedure.

## Required Input

Require an explicit finalized approved design path and caller context. Reject a
missing, pending, unreadable, or non-implementation-ready design. Never infer a
latest artifact and never begin design dialogue.

## Composition

1. Load and execute `contract-implementation` with the approved design path and
   caller context.
2. Stop if implementation is blocked or failed. Return its implementation
   report path when source or configuration changed.
3. If implementation returns no-op, report that outcome and do not start
   review; no implementation report exists for review.
4. Require the single terminal implementation-report path returned by the
   implementation procedure.
5. Delegate to `review-orchestrator` with that implementation-report path, its
   explicit governing design path, validation evidence referenced by the
   report, and the repository change target. The child owns
   `orchestrated-review`; do not copy its procedure into the handoff.
6. Return the two artifact paths and terminal assurance summary.

Review findings end the workflow as findings. Do not feed them into an
implementation repair loop and do not request automatic re-review. Validation
repair remains exclusively inside `contract-implementation` before its terminal
report.

## Output

Return:

- `Implementation report: <path | none for no-op>`
- `Review report: <path | none when stopped or no-op>`
- `Outcome: implemented-and-reviewed | blocked | failed | no-op`
- concise validation result, review verdict, and unresolved blockers or risks.
