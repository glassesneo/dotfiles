---
name: orchestrated-review
disable-model-invocation: true
description: >-
  Use when a review-orchestrator must review an explicit implementation report
  through risk-tiered focused reviewers and one dissent pass, then persist one
  review report. Trigger for post-implementation assurance. Do not use for
  source changes, implementation, validation-only work, or automatic finding
  remediation.
---

# Orchestrated Review

Orchestrate an evidence-first, non-source-changing review using explicit
artifact handoffs and a bounded one-to-four reviewer tier.

## Required Input and Priority

Require an explicit implementation-report path and an explicit review target
or target context. Read the implementation report's governing design path and
require that finalized approved design; never search for a latest artifact.
Use priority `design > implementation report > diff > other context`.
Validation evidence recorded in the implementation report is review input.
Design deviations are attention points, not permission to violate the design.

## Procedure

1. Make a small read-only sizing pass over the target and identify behavior,
   boundaries, sensitive risks, validation gaps, and uncertainty.
2. Choose the highest applicable fixed tier:
   - **1 — broad default:** start exactly one focused reviewer for narrow
     low-risk work in one subsystem. Define one combined perspective covering
     every material correctness, safety, ownership, and validation risk.
   - **2 — moderate:** start exactly two focused reviewers for meaningful
     behavior across several files, moderate uncertainty, or two distinct
     concerns in one subsystem.
   - **3 — high:** start exactly three focused reviewers for multiple
     subsystems, public interfaces, permissions or secrets, migrations,
     compatibility, generated artifacts, or model-facing prompt/interface
     contracts.
   - **4 — critical:** start exactly four focused reviewers for broad
     architecture change, critical security/privacy/data-loss exposure,
     destructive behavior, or unusually high uncertainty.
3. Select exactly the tier's reviewer count with distinct risk-driven
   perspectives. Record every selected, replaced, skipped, or scaled-down
   perspective and its rationale for the dissent dossier and final report.
   Start one `focused-reviewer` per selected perspective. Give each only its
   lens and rationale, review target, governing design and implementation-report
   paths, relevant cited excerpts, and local output contract. Correctness is
   mandatory for behavior, interface, data-shape, migration, generated-output,
   or compatibility changes. Security is mandatory for credentials,
   permissions, authentication, sandboxing, destructive operations, network
   boundaries, or user-data exposure.
4. Triage focused results: merge duplicates, reject unsupported claims,
   preserve uncertainty, and record severity disputes, uncovered perspectives,
   skipped areas, and verification gaps.
5. Start `dissent-reviewer` exactly once with a compact dossier. For every
   tentative finding include its claim, cited evidence, triage decision,
   severity dispute, uncovered perspective, and known uncertainty. Pass paths
   and excerpts rather than concatenating complete reports or logs. Permit the
   dissenter to inspect referenced source when a dispute requires it.
6. Reconcile dissent into final findings and severity. Mark claims
   inconclusive when required evidence remains unavailable.
7. Load `agent-artifact`, read its review-report format, and save exactly one
   canonical `review-report`.

Do not change source or configuration, repair findings, start a second dissent
pass, or create multi-round report versions. If a required delegate or material
context is unavailable, preserve the limitation in an inconclusive report.

## Output

Return only:

- `Review report: <path>`
- `Verdict: blocking-findings | non-blocking-findings | no-findings | inconclusive`
- `Highest severity: critical | high | medium | low | none`
- `Residual risks or blockers: <none | concise list>`
