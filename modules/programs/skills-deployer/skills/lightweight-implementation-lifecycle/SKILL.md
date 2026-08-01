---
name: lightweight-implementation-lifecycle
description: >-
  Use when a source-changing receiver must directly complete a bounded request or
  small approved design with self-validation and optional focused-review
  remediation. Trigger for ordinary small implementation work or explicit
  aligned-request mode. Do not use for the heavy approved-design lifecycle,
  independent tester or full assurance, orchestrated or standalone review,
  validation-only work, or unbounded implementation.
---

# Lightweight Implementation Lifecycle

Complete one bounded source change locally, including proportionate validation,
evidence-backed repair, and focused review only when explicitly requested.

## Required Input

Require exactly one mode:

- `direct`: receive an explicit bounded implementation contract or a readable,
  finalized small approved design. Ask only for missing information needed to
  make the contract bounded; return `blocked` if that is not possible.
- `aligned-request`: receive a request without requiring a design path. Before
  changing source or configuration, inspect only enough repository evidence to
  propose a short contract covering understood objective, change scope,
  planned validation, review requirement, and material assumptions. Use
  `question` to obtain explicit confirmation or revision. Update and reconfirm
  a revised contract; do not mutate source until it is confirmed.

Apply every automated check required by the agreed contract or governing design.
The user decides whether a task is small enough for this lifecycle. If repository
evidence shows material scope or scale expansion, stop and return that decision
to the user rather than widening the contract.

## Implementation and Validation

1. Implement the agreed bounded contract directly. Do not delegate source work
   or validation to taskmaster, tester, cursor implementer, or another child.
2. Inspect the resulting diff for contract alignment and unintended changes.
3. Run checks proportionate to the affected subsystem: relevant tests,
   typecheck, lint, format checks, or configuration evaluation. Run full checks
   when the contract or governing design requires them.
4. Repair concrete, evidence-backed, in-scope implementation regressions
   together, inspect the new diff, and repeat the relevant validation. Initial
   implementation does not consume a repair round; source-changing
   validation repair is limited to two rounds.
5. Stop without success on an unknown cause, repeated failure without progress,
   test or infrastructure ownership, required validation without adequate
   evidence, material scope or scale expansion, or exhausted repair budget.
   A remaining validation failure is blocking.

## Optional Focused Review

Start review only when the user or governing contract explicitly requests it,
either initially or later in the same active session.

- Select one risk-based `focused-reviewer` lens normally, or at most two
  distinct lenses for two independent risk surfaces. Do not use generic full
  review, orchestrated review, or dissent.
- Reuse started reviewer sessions for rechecking within this lifecycle.
- A review round consists of the reviewer pass, parent triage, in-scope repair,
  and self-validation. Repair evidence-backed correctness or contract defects;
  unsupported concerns, style preferences, and accepted low residual risks are
  non-blocking.
- Stop early when findings converge and allow at most two reviewer passes total.
  If source changes after the second pass, run final self-validation without a
  third pass and report the unre-reviewed repair as residual risk.
- Return `blocked` for material unresolved findings, blocking uncertainty, no
  progress, scope expansion, or exhaustion of the two-round review budget.

## Artifacts

Return results inline by default. Persist an implementation, review, or failure
report only when the user or governing design explicitly requires one; then
load `agent-artifact` and follow its existing kind and format contract. Do not
make artifact creation a success condition.

## Output

Return:

- `Outcome: implemented | implemented-and-reviewed | no-op | blocked | failed`;
- changed files and a concrete diff reference;
- validation commands and results, plus validation-repair count;
- when review was requested: lenses, reviewer count, round count, findings, and
  remediation summary;
- deviations from the agreed contract or approved design;
- unresolved risks, any final repair not independently re-reviewed, and
  blockers.
