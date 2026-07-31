---
name: implementation-validation
disable-model-invocation: true
description: >-
  Use when a tester receives one full automated validation objective for an
  implementation and must execute, triage, and aggregate evidence without
  changing repository source. Trigger for delegated post-change validation
  against an approved design. Do not use for implementation, test planning,
  review orchestration, or successful validation report authoring.
---

# Implementation Validation

Answer one post-change full automated validation objective with applicable
checks and one aggregated triage result.

## Required Handoff

Require:

- the explicit approved design path;
- changed scope or a concrete diff reference;
- exactly one objective asking whether the implementation satisfies applicable
  full automated validation;
- known risks, including `none known` when applicable.

If an input is unavailable, return the blocker rather than broadening the task.
Use context priority `design > implementation report > diff > source`. A
recorded deviation never overrides the design.

## Procedure

1. Read the governing design's verification requirements, relevant repository
   guidance, changed scope, and manifests or standard scripts needed to identify
   canonical commands.
2. Include every additional automated check required by the design. At minimum,
   include each repository-provided typecheck, lint, and full test-suite command
   that applies to the changed scope.
3. Prefer the repository's canonical aggregate command. If it succeeds, use it
   as evidence for every stage it covers.
4. If the aggregate command stops before later stages, continue with each
   unexecuted applicable stage only when its standard independent command is
   identifiable, safe to run, and does not require an earlier stage's generated
   output. Do not guess commands or accept unsafe side effects to simulate full
   coverage; report an unexecutable stage as a blocker or residual risk.
5. Do not edit repository source or configuration. Run commands that may write
   generated files or caches in a temporary workspace when feasible; otherwise
   state the mutation risk or blocker.
6. Capture commands, exit status, failing identifiers, relevant diagnostics,
   environment limits, successful stages, blockers, and skipped checks in one
   result.
7. Re-run a failure when useful to distinguish deterministic behavior from
   flakiness; use three to five repeats when feasible and proportionate.
8. Classify failures as `regression`, `flaky`, `test bug`,
   `environment/infra`, or `unknown`, and identify the likely owner.

## Persistence Branch

Return passing evidence inline. Keep a trivial invocation or expectation
mistake inline when the cause and one-line correction are certain and no
behavioral uncertainty remains.

For every non-trivial failing run—including regressions, flaky behavior,
environment failures, and unknown causes—load `agent-artifact`, read its
failure-report format, and save one canonical `failure-report`. When uncertain
whether a failure is trivial, treat it as non-trivial. Do not invent a report
format or create a success-only validation artifact.

## Output

Return:

- the validation objective and scope actually checked;
- result: `pass | trivial-failure | non-trivial-failure | blocked`;
- commands and concrete evidence for each applicable stage;
- classification and likely owner for every non-passing stage;
- `Failure report: <path | none>`;
- blockers, skipped checks, and residual risk.
