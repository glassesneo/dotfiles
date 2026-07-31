---
name: orchestrated-review
disable-model-invocation: true
description: >-
  Use when a review-orchestrator receives an explicit implementation report and
  must perform one full risk-tiered review with focused reviewers and one
  dissent pass, then persist one review report. Do not use for source changes,
  validation-only work, focused re-review, or remediation.
---

# Orchestrated Review

Perform one evidence-first, non-source-changing full review using explicit
artifact handoffs and a bounded one-to-four reviewer tier.

## Required Input and Priority

Require an explicit implementation-report path and review target or context.
Read its governing approved design and require that finalized design; never
infer a latest artifact. Use priority
`design > implementation report > diff > other context`. Treat deviations as
attention points rather than permission to override the design.

## Procedure

1. Make a small read-only sizing pass over behavior, boundaries, sensitive
   risks, validation gaps, and uncertainty.
2. Select the highest applicable tier:
   - **1 — broad default:** one combined reviewer for narrow, low-risk work;
   - **2 — moderate:** two distinct reviewers for meaningful multi-file work,
     moderate uncertainty, or two concerns in one subsystem;
   - **3 — high:** three reviewers for multiple subsystems, public interfaces,
     permissions, migrations, compatibility, generated artifacts, or
     model-facing contracts;
   - **4 — critical:** four reviewers for broad architecture, critical
     security/privacy/data-loss exposure, destructive behavior, or unusually
     high uncertainty.
3. Give each `focused-reviewer` only its distinct risk-driven lens and rationale,
   target, design and implementation-report paths, cited excerpts, and local
   output contract. Include correctness for behavioral and interface risks;
   include security for credentials, permissions, authentication, sandboxing,
   destructive operations, network boundaries, or user-data exposure.
4. Triage results: merge duplicates, reject unsupported claims, preserve
   uncertainty, and record severity disputes, skipped perspectives, and gaps.
5. Start `dissent-reviewer` exactly once with a compact dossier of tentative
   findings, evidence, triage decisions, disputes, uncovered perspectives, and
   uncertainty. Reference paths and excerpts instead of copying full logs.
6. Reconcile dissent. Mark claims inconclusive when evidence remains unavailable.
7. Load `agent-artifact` and save exactly one canonical `review-report` that
   references the target implementation report and previous review report when
   supplied.

One invocation never changes source or configuration, repairs findings, or
starts a second dissent pass. This boundary does not prohibit a caller from
starting a later remediation or review invocation.

## Output

Return only:

- `Review report: <path>`;
- `Verdict: blocking-findings | non-blocking-findings | no-findings | inconclusive`;
- `Highest severity: critical | high | medium | low | none`;
- `Residual risks or blockers: <none | concise list>`.
