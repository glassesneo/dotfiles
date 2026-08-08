---
name: implementation-validation
description: >-
  Use when running one explicit automated validation objective against a
  concrete implementation state without changing repository source. Do not use
  for implementation, test authoring, or code review.
---

# Implementation Validation

Require a concrete source state or diff, one validation objective, and any caller-requested breadth or known risks. Use repository-defined commands rather than inventing gates.

Inspect relevant guidance and manifests, run the smallest command set that answers the objective, and capture exit status and diagnostics. Do not edit source or configuration. Classify failures as implementation regression, flaky behavior, test defect, environment or infrastructure, or unknown when evidence permits.

Return:

- objective and source-state reference;
- result: pass, fail, or blocked;
- commands and evidence;
- failure classifications and likely owners;
- skipped checks, blockers, and residual risk.
