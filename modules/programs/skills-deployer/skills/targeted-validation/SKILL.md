---
name: targeted-validation
disable-model-invocation: true
description: >-
  Use when a tester receives one bounded validation question for an
  implementation and must execute, triage, and return evidence without changing
  repository source. Trigger for delegated post-change checks. Do not use for
  implementation, broad test planning, review orchestration, or successful
  validation report authoring.
---

# Targeted Validation

Answer one bounded implementation-validation question with the smallest useful
execution scope and an explicit triage result.

## Required Handoff

Require:

- the explicit approved design path;
- changed scope or a concrete diff reference;
- exactly one bounded validation question;
- known risks, including `none known` when applicable.

If an input is unavailable, return the blocker rather than broadening the task.
Use context priority `design > implementation report > diff > source`. A
recorded deviation never overrides the design.

## Procedure

1. Read only the governing design sections and changed scope needed to answer
   the question.
2. Choose the smallest relevant check, then widen only when its evidence is
   insufficient.
3. Do not edit repository source or configuration. Run commands that may write
   generated files or caches in a temporary workspace when feasible; otherwise
   state the mutation risk or blocker.
4. Capture commands, exit status, failing identifiers, relevant diagnostics,
   environment limits, and skipped checks.
5. Re-run a failure when useful to distinguish deterministic behavior from
   flakiness; use three to five repeats when feasible and proportionate.
6. Classify failures as `regression`, `flaky`, `test bug`,
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

- the validation question and scope actually checked;
- result: `pass | trivial-failure | non-trivial-failure | blocked`;
- commands and concrete evidence;
- classification and likely owner when not passing;
- `Failure report: <path | none>`;
- blockers, skipped checks, and residual risk.
