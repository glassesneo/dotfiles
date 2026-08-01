---
name: adaptive-review
disable-model-invocation: true
description: >-
  Use when a reviewer must perform one adaptive read-only review in auto,
  solo-only, or orchestrated mode and persist exactly one canonical review
  report. Do not use for source changes, validation-only work, or remediation.
---

# Adaptive Review

Perform one evidence-first, source-read-only review and save exactly one
canonical `review-report`, whether the target has findings, has no reviewable
diff, or cannot support a reliable verdict.

## Required Input and Priority

Require exactly one mode (`auto | solo-only | orchestrated`), a defined target,
and optional context. Lifecycle callers provide the approved design,
implementation-report path, concrete diff, prior review report when present,
and selected mode. Standalone callers need not manufacture missing artifacts.
Use available context in this priority:
`design > implementation report > diff > source > other context`.

The default standalone target is current-worktree staged, unstaged, and
untracked changes; ignored files are excluded unless explicitly targeted. If
that target has no reviewable change, save an `inconclusive` report that says no
diff was available. Never report `no-findings` for an empty target.

## Modes and Sizing

Begin with a small direct sizing pass over behavior, changed boundaries,
validation evidence, conflicts, breadth, and uncertainty.

- `auto`: review solo by default. Escalate only when target evidence establishes
  a hard gate below.
- `solo-only`: never delegate. If a hard gate makes a solo verdict materially
  unreliable, save an `inconclusive` report identifying the gate and return a
  blocker recommending a heavy reviewed workflow.
- `orchestrated`: skip solo eligibility and run bounded orchestration.

Do **not** orchestrate because of file count, LOC, risk words, hypothetical risk,
a generic desire for reassurance, multiple ordinary perspectives, or several
low/medium findings. Coherent multi-file work, a local interface or migration,
local concurrency, and identifiable validation gaps remain solo-eligible when
one reviewer can trace them coherently.

A hard gate requires concrete evidence for at least one condition:

1. a changed authentication, authorization, secret, sandbox,
   destructive-operation, privacy, or data-loss boundary has multiple
   independent material failure modes;
2. interacting subsystem changes prevent coherent whole-behavior judgment from
   the local changes;
3. design, implementation, and runtime evidence materially conflict so the
   verdict depends on an unresolved interpretation;
4. repository-wide breadth would otherwise leave material areas uncovered; or
5. direct review uncovers a concrete severe finding or counter-hypothesis that
   requires independent challenge for a reliable verdict.

## Orchestration

For `orchestrated`, or `auto` with a hard gate:

1. Select two to four distinct, risk-driven `focused-reviewer` lenses. Never use
   generic duplicate lenses.
2. Give each child its lens and rationale, target, available design and report
   paths, relevant excerpts, and local output contract.
3. Triage results: merge duplicates, reject unsupported claims, preserve
   uncertainty, and record severity disputes and uncovered areas.
4. Start exactly one `dissent-reviewer` with a compact dossier of tentative
   findings, evidence, disputes, gaps, and uncertainty.
5. Reconcile dissent. Mark unavailable evidence inconclusive.

Solo execution delegates to no reviewer and omits dissent. One invocation never
changes source or configuration, repairs findings, or starts a second dissent
pass.

## Report and Output

Load `agent-artifact` and save exactly one canonical `review-report`. In its
Summary include:

- `Execution mode: solo | orchestrated | focused-consolidated`; and
- `Escalation evidence: none` for solo, or the concrete hard-gate evidence for
  orchestration.

Record the actual sizing rationale, context used, target implementation report
and previous review report when supplied, findings, gaps, and residual risks.
Return only:

- `Review report: <path>`;
- `Verdict: blocking-findings | non-blocking-findings | no-findings | inconclusive`;
- `Highest severity: critical | high | medium | low | none`;
- `Execution mode: solo | orchestrated | focused-consolidated`;
- `Residual risks or blockers: <none | concise list>`.
