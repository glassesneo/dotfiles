---
name: implementation-validation
description: >-
  Use when running one explicit automated validation objective against a
  concrete implementation state without changing repository source. Do not use
  for implementation, test authoring, or code review.
---

# Implementation Validation

Require a concrete source state or diff, one validation objective, and any requester-specified breadth or known risks. Use repository-defined commands rather than inventing gates.

Inspect relevant guidance and manifests, run the smallest command set that answers the objective, and capture exit status and diagnostics. Do not edit source or configuration. Classify failures as implementation regression, flaky behavior, test defect, environment or infrastructure, or unknown when evidence permits.

When failed or blocked evidence changes a known implementer, reviewer, or consolidator premise, consider a bounded signal to that durable Pi consumer. Successful queueing is not acknowledgement that the receiver processed or acted on it, so keep responsibility for the requester-facing validation result. If this validation is background peer work, preserve the explicit monitoring owner and include the task handle, current state, and expected follow-up only when the requester or a new monitoring owner must act. A terminal notification is not proof of passage; use `mesh_get` when complete outcome or evidence must be retrieved. External harness agents cannot be route endpoints and require a Pi monitoring owner.

Return:

- objective and source-state reference;
- result: pass, fail, or blocked;
- commands and evidence;
- failure classifications and likely owners;
- skipped checks, blockers, and residual risk;
- any materially relevant signal, monitoring handoff, or pending follow-up.
