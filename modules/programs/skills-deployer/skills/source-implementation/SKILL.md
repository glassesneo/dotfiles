---
name: source-implementation
disable-model-invocation: true
description: >-
  Use when a source-changing taskmaster receives an approved design or explicit
  bounded implementation contract and must return a concrete source-only
  handoff. Trigger for local implementation or a delegated implementation or
  remediation step. Do not use for validation verdicts, implementation-report
  persistence, review, or lifecycle orchestration.
---

# Source Implementation

Change source or configuration within one explicit implementation contract and
return the evidence needed by the caller that owns assurance.

## Required Input

Require:

- an explicit approved design path or other explicit bounded implementation
  contract;
- the source objective and repository target;
- current diff context, known findings, and caller constraints when applicable.

When a design path is supplied, require a readable finalized design marked
`implementation-ready`. Never infer the latest design. Read the complete design
and treat its scope, acceptance criteria, work order, scale contract,
exclusions, and verification requirements as governing.

## Procedure

1. Read repository guidance and inspect the affected ownership surfaces.
2. Confirm that the objective fits the governing scope and scale contract. Stop
   rather than introducing a forbidden interface or material expansion.
3. Implement in dependency order without leaving duplicate old and new runtime
   contracts.
4. Inspect the resulting diff for design alignment and unintended changes.
5. When the parent lifecycle owns independent validation, run only focused
   development diagnostics directly needed by the changed locations. Do not
   preemptively run package full checks, flake aggregate checks, or
   representative host builds unless a concrete failure must be reproduced or
   a repair must be confirmed. These commands are not an independent validation
   verdict and the caller must not treat them as one.
6. Return the source handoff inline. Do not persist an implementation report or
   decide review or validation outcomes.

If no source or configuration change is needed, return a no-op handoff with the
evidence that established it.

## Output

Return:

- `Source outcome: changed | no-op | blocked | failed`;
- changed files and a concrete diff reference;
- design or bounded-contract alignment;
- deviations, or `none`;
- development diagnostics performed;
- unverified risks and blockers.

Validation verdicts, implementation reports, review verdicts, lifecycle round
accounting, and terminal success belong to the caller.
