---
name: contract-implementation
disable-model-invocation: true
description: >-
  Use when a taskmaster must implement an explicit approved design, obtain
  delegated full automated validation, and persist the terminal implementation
  handoff. Trigger for post-approval implementation from a design path. Do not
  use for design dialogue, direct small changes without a design, validation-
  only work, or review-only work.
---

# Contract Implementation

Implement one approved design through a source-changing taskmaster, settle
validation through the locally provided tester capability, and persist the
terminal result through `agent-artifact`.

## Required Input

Require all of:

- an explicit project-local path under `.agents/designs/`;
- a readable finalized design whose status is `implementation-ready`;
- the current repository target and any caller context.

Reject a missing path, a pending-artifact path, a missing file, or a design not
marked implementation-ready. Never search for or infer the latest design.
Read the complete design before changing files. Treat its scope, acceptance
criteria, work order, scale contract, exclusions, and verification section as
the governing contract.

## Implementation Procedure

1. Inspect repository guidance and the design's affected ownership surfaces.
2. Confirm the requested footprint remains within the scale contract. Stop and
   report the mismatch if implementation would require a material expansion or
   a forbidden interface.
3. Implement in the design's dependency order. Keep each responsibility correct
   rather than leaving temporary duplicate contracts for later cleanup.
4. Track changed files, design alignment, deviations, validation attempts, and
   unresolved risk for the terminal handoff.
5. If no source or configuration change is necessary, return a no-op outcome
   with evidence and create no implementation report.
6. After changes, delegate one post-change full automated validation objective
   to `tester` in one task. The handoff must include the approved design path,
   changed scope or diff reference, exactly one objective asking whether the
   implementation satisfies applicable full automated validation, and known
   risks. Load no tester procedure into the handoff; the tester owns
   `implementation-validation`.
7. Use the aggregated evidence to decide whether implementation is settled.

## Failure and Repair Policy

A tester result may classify a failure as `regression`, `flaky`, `test bug`,
`environment/infra`, or `unknown`.

When one tester result identifies multiple concrete implementation regressions,
repair them together when every repair remains inside the approved design and
scale contract. Then request the same full validation objective in one fresh
tester task. Record the failed run, any failure-report path, all repairs, and
the fresh result.

Stop when the cause is unknown, the same material failure recurs without
progress, repair would expand scope, or ownership belongs to tests or
infrastructure. Do not claim skipped or blocked validation passed. Do not start
review unless a separate composition contract explicitly requires it.

## Terminal Artifact

When source or configuration changed, load `agent-artifact`, read its
implementation-report format, and save exactly one terminal
`implementation-report` after validation settles or stops. Include every failed
and successful validation attempt, failure-report paths, repairs, deviations,
terminal status, unresolved items, and reviewer attention points. Do not copy
an artifact schema into this Skill or write a second report version.

Return:

- `Implementation report: <path>` when changes were made;
- `Outcome: implemented | blocked | failed | no-op`;
- concise validation evidence and unresolved blockers.
