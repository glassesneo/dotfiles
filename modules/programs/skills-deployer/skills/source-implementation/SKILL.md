---
name: source-implementation
description: >-
  Use when completing one bounded source or configuration change and returning
  a concrete source handoff. Do not use for read-only validation or review.
---

# Source Implementation

Require one bounded source objective, repository target, relevant constraints, and current findings or diff context when they exist. Report missing authority or material scope expansion instead of guessing.

Read repository guidance and affected ownership surfaces. Implement in dependency order without leaving duplicate contracts. Run focused development diagnostics appropriate to the changed locations and inspect the resulting diff.

When independently checkable exploration, automated validation, or read-only review would materially improve the outcome, use `task-orchestration` to request or observe that bounded peer work without transferring the source objective. For every background task, keep a monitoring owner explicit. Treat terminal notification as state only and use `mesh_get` when outcome or evidence matters. A Pi peer must monitor external harness tasks because they are not durable route endpoints.

Return:

- outcome: changed, no-op, blocked, or failed;
- changed files and concrete diff reference;
- objective alignment and deviations;
- diagnostics performed;
- unverified risks and blockers;
- task handles, monitoring ownership, and pending retrieval, integration,
  repair, or full-gate work only when the requester or a new monitoring owner
  must act on them.
