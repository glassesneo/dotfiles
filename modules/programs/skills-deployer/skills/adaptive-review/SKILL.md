---
name: adaptive-review
description: >-
  Use for an evidence-first read-only review of a defined target, optionally
  delegating a concrete independent lens when that improves confidence. Do not
  use for source changes or validation-only work.
---

# Adaptive Review

Require a defined target and any available design, diff, or validation context. Review directly when one reviewer can trace the behavior coherently. Delegate only a concrete independent lens or bounded dissent dossier when evidence shows that separation will improve the verdict.

Do not change source. Merge duplicate findings, reject unsupported claims, preserve uncertainty, and distinguish correctness defects from preferences. Persist a review report only when the caller requests a durable review.

Return severity-ordered findings with precise evidence, followed by the verdict, verification gaps, skipped areas, and residual risks. When a durable review was requested, return the saved review-report path.
