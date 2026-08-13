---
name: implementation-validation
description: >-
  Use when running one explicit automated validation objective against a
  concrete implementation state without changing repository source. Do not use
  for implementation, test authoring, or code review.
---

# Implementation Validation

Require a concrete source state or diff, one automated validation objective,
and any requester-specified breadth or known risks. Use repository-defined
commands rather than inventing gates.

Inspect relevant guidance and manifests, then run the smallest command set that
answers the objective. Capture exit status and compress output to the
diagnostics that can affect the caller's judgment. Do not edit source or
configuration. When evidence permits, classify failure as implementation
regression, flaky behavior, test defect, environment or infrastructure, or
unknown. Do not turn diagnosis into repair or review.

Return:

- objective and source-state reference;
- result: pass, fail, or blocked;
- commands and decision-relevant diagnostics;
- failure classification and likely ownership when supported;
- skipped coverage, blockers, and residual risk.
