---
name: implementation-validation
disable-model-invocation: true
description: >-
  Use when a tester receives one explicit focused, broad, or full automated
  validation objective for an implementation and must return aggregated
  evidence without changing repository source. Do not use for implementation,
  review orchestration, test authoring, or success-only artifact persistence.
---

# Implementation Validation

Answer one post-change automated validation objective at the requested assurance
level and return evidence tied to the concrete source state.

## Required Handoff

Require:

- the explicit approved design path;
- changed scope or a concrete diff reference;
- requested level: `focused`, `broad`, or `full`;
- rationale for that level;
- exactly one concrete validation objective;
- known risks, including `none known` when applicable;
- any successful independent stage evidence offered for reuse, including its
  stage, command, environment, concrete diff reference, and source-state
  reference.

Return a blocker when required input is unavailable. Use context priority
`design > implementation report > diff > source`; a recorded deviation never
overrides the design. Do not silently lower the requested level.

## Levels

- **focused:** checks directly related to the changed locations, including the
  relevant test, typecheck, lint, or format check. This is the default for a
  narrow remediation or short inner loop.
- **broad:** canonical typecheck, lint, and test suite for the affected package
  or subsystem, plus applicable cross-boundary checks. Prefer this for initial
  multi-file, interface, or structure-changing work.
- **full:** every applicable automated validation required by the design and
  repository for terminal assurance.

Every automated check explicitly required by the design applies at every level.
Escalate to `broad` or `full` when failures, expanding impact, boundary
uncertainty, or insufficient narrower evidence require it. Record both requested
and actual levels and why escalation occurred.

## Procedure

1. Read the design, repository guidance, diff, and standard manifests or scripts.
2. Select canonical commands matching the requested level and objective. Do not
   guess commands. Reuse offered successful stage evidence only when source,
   relevant configuration, test definitions, and toolchain are unchanged and
   the evidence identifies the same source state, stage, command, environment,
   and concrete diff reference. Failure, incomplete evidence, or any such
   change requires that stage to be rerun.
3. Prefer the canonical aggregate command when the level calls for it. If it
   stops before later stages, run only unexecuted stages whose standard
   independent commands are identifiable, safe, and independent of failed
   generated output.
4. Do not edit source or configuration. Use a temporary workspace for generated
   output or caches when feasible; otherwise report mutation risk.
5. Capture commands, exit status, failing identifiers, diagnostics, successful
   stages, blockers, skipped checks, and the concrete diff reference. Record
   reused successful stages separately from stages actually rerun; full
   validation still runs every applicable stage not covered by valid evidence.
6. Re-run a failure when proportionate to distinguish deterministic behavior
   from flakiness, usually three to five repeats when feasible.
7. Classify each failure as `regression`, `flaky`, `test bug`,
   `environment/infra`, or `unknown`, and identify the likely owner.

## Persistence

Return passing evidence inline. Keep only a certain trivial invocation or
expectation mistake inline. For every non-trivial failing run, load
`agent-artifact` and save one canonical `failure-report`. Do not create a
success-only validation artifact.

## Output

Return:

- objective and concrete diff reference;
- requested level, actual level, rationale, and any escalation reason;
- result: `pass | trivial-failure | non-trivial-failure | blocked`;
- commands and evidence for each applicable stage;
- failure classifications and likely owners;
- `Failure report: <path | none>`;
- blockers, skipped checks, and residual risk.
