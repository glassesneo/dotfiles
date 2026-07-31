---
name: implementation-lifecycle
disable-model-invocation: true
description: >-
  Use when an approved design must run through a complete local or delegated
  implementation lifecycle with proportional validation and optional bounded
  review remediation. Trigger for explicit local-no-review, local-reviewed, or
  delegated-reviewed execution. Do not use for design authoring, standalone
  review, validation-only work, or an unbounded implementation request.
---

# Implementation Lifecycle

Compose source implementation, independent validation, optional review, repair,
and immutable reporting for one approved design. This Skill owns mode, ordering,
round budgets, artifact chaining, and terminal outcome; receiver Skills own
their local procedures.

## Required Input

Require an explicit readable finalized design path marked
`implementation-ready`, caller context, and exactly one mode:

- `local-no-review`: implement locally, obtain terminal full validation, and
  save a terminal implementation report without review;
- `local-reviewed`: implement locally and complete bounded review remediation;
- `delegated-reviewed`: delegate source work to one child implementation
  capability while the caller owns inspection, assurance, artifacts, and the
  terminal decision.

Reject pending or missing artifacts and never infer the latest design. Read the
complete design, including scope, acceptance criteria, scale, exclusions, and
verification.

## Capability Handoffs

A source handoff includes the design, bounded objective, current diff context,
known findings, and the `source-implementation` output contract. In delegated
mode, start one child source-changing capability and reuse its idle session for
initial work and remediation. The child returns source results inline and does
not own validation, implementation reports, or review verdicts. Independently
inspect the diff and design alignment after every handoff.

A validation handoff includes the design, concrete diff reference, requested
`focused | broad | full` level, level rationale, exactly one objective, and
known risks. Initial reviewed work normally receives focused or broad validation
proportionate to risk. Every final source state requires full validation.
Successful full evidence may be reused only while source and relevant
configuration remain unchanged.

## Artifact Chain

At every material implementation or assurance checkpoint, load
`agent-artifact` and save one immutable `implementation-report`. Reference the
governing design, concrete diff, requested and actual validation level, commands,
round number, deviations, residual risks, and previous implementation and review
reports. Each full or focused review invocation saves one `review-report`
referencing its target implementation report and previous review report.

If terminal full validation occurs after the latest implementation report with
no source change, save a terminal implementation report linking the latest
review and full evidence. Never overwrite an artifact or invent a lifecycle
artifact kind.

## Local No-Review Mode

1. Execute `source-implementation` locally.
2. Return no-op without a report if no source or configuration changed.
3. Delegate one `full` validation objective to the tester capability.
4. When one result identifies multiple concrete implementation regressions,
   repair all evidence-backed in-scope regressions together, then repeat the
   same objective in a fresh tester task. Each source-changing repair consumes
   one of the three remediation rounds.
5. Stop on unknown cause, no progress, scope or scale expansion, or test or
   infrastructure ownership.
6. Save one terminal implementation report after validation settles or stops.
   Do not start review.

## Reviewed Modes

1. Obtain the initial source handoff locally or from the delegated child. Initial
   implementation does not consume a remediation round.
2. Inspect the diff, run proportional focused or broad validation, and save an
   implementation report.
3. Run the initial `orchestrated-review` and save its review report.
4. Triage findings. Automatically remediate evidence-backed, in-scope critical,
   high, and medium findings. Remediate a low finding only when it is a concrete
   correctness or contract defect. Style preference, unsupported concern, and
   acceptable low residual risk are non-blocking.
5. Every source change made from review or terminal-validation evidence consumes
   one remediation round, up to three. For each round: invoke the source
   capability, inspect the diff, run focused or broad validation, save an
   implementation report, then re-review.
6. Use `orchestrated-review` only for the initial review and the re-review after
   round 1, at most twice per lifecycle. For rounds 2 and 3, select one or two
   distinct risk-based focused review capabilities directly, omit dissent, triage
   their results, and save one consolidated canonical review report.
7. When review converges, run `full` validation unless valid full evidence already
   applies to the unchanged source state. An in-scope concrete regression found
   here consumes the next remediation round; after repair, repeat full validation
   and re-review within the remaining budgets.

Stop early for an unknown cause, repeated material failure or finding without
progress, scope or scale expansion, test or infrastructure ownership, or the
three-round limit. A stop condition ends only this invocation; a later explicit
user task is a new task.

## Terminal Decision

Success requires both successful full validation for the current source state
and a latest review pass with no blocking finding in reviewed modes. State all
unresolved risks. If the round limit is exhausted without these conditions,
return `blocked`, not success.

Return:

- `Implementation report: <terminal path | none for no-op>`;
- `Review report: <terminal path | none>`;
- `Outcome: implemented | implemented-and-reviewed | blocked | failed | no-op`;
- validation and review summary;
- unresolved risks or blockers.
