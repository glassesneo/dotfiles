---
name: source-implementation
description: >-
  Use when completing one bounded source or configuration change and returning
  a concrete source handoff. Do not use for read-only validation or review.
---

# Source Implementation

Require one bounded source objective, repository target, relevant constraints, and current findings or diff context when they exist. Report missing authority or material scope expansion instead of guessing.

Read repository guidance and affected ownership surfaces. Implement in dependency order without leaving duplicate contracts. Run focused development diagnostics appropriate to the changed locations and inspect the resulting diff.

Return:

- outcome: changed, no-op, blocked, or failed;
- changed files and concrete diff reference;
- objective alignment and deviations;
- diagnostics performed;
- unverified risks and blockers.
