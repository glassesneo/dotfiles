---
name: review
description: Use for review requests, /review, /primary-review, code review, diff review, implementation review, and evidence-grounded regression/security/maintainability inspection.
---

# Review Skill

Use this skill when orchestrating review work.

Workflow:
1. Compare the requested target, diff, spec, plan, and implementation report against intended behavior.
2. Inspect correctness, regressions, maintainability, permissions, security, and validation gaps.
3. Use `explore` first for narrow read-only discovery if it has not already run.
4. For code review, collect independent viewpoints from `reviewer1` and `reviewer2` when feasible.
5. Treat implementation-report deviations as focused review inputs, not approval to diverge from the spec.
6. Keep only evidence-grounded findings; mark unconfirmed issues with the missing evidence and recommended next check.
