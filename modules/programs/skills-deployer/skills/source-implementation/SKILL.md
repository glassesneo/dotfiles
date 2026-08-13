---
name: source-implementation
description: >-
  Use when completing one bounded source or configuration change and returning
  a concrete source handoff. Do not use for read-only validation or review.
---

# Source Implementation

Require one bounded source objective, repository target, relevant constraints,
and current findings or diff context when they exist. Report missing authority
or material scope expansion instead of guessing.

Read repository guidance and affected ownership surfaces. Implement in
dependency order without leaving duplicate contracts. Inspect the resulting
diff and run proportionate focused diagnostics appropriate to the changed
locations.

When the runtime authorizes an alternate execution profile for this same
purpose, use it only when it can materially improve the bounded implementation.
The profile changes execution, not responsibility or scope. Do not assume
independent exploration, validation, or review authority; return any additional
assurance need for the parent to judge.

Return:

- outcome: changed, no-op, blocked, or failed;
- changed files and a concrete diff reference;
- objective alignment and deviations;
- diagnostics performed and decision-relevant evidence;
- unverified risks, blockers, and additional assurance that may matter.
