---
name: adaptive-review
description: >-
  Use for an evidence-first read-only review of a defined target, optionally
  requesting a concrete independent lens when that improves confidence. Do not
  use for source changes or validation-only work.
---

# Adaptive Review

Require a defined target and any available design, diff, or validation context. Act as the review consolidator. Review directly when one reviewer can trace the behavior coherently. Request only a concrete independent lens or bounded dissent dossier when evidence shows that separation will improve the verdict; the independent peer owns that lens, not the consolidated review.

When validation or another review runs as a peer task, choose blocking wait or a watch according to whether its result is the next dependency. Keep the monitoring owner explicit for background work. A watch reports terminal state, not success or task details; use `mesh_get` for the outcome and evidence. On failed or blocked evidence, decide whether to stop, limit, continue, or escalate affected review claims from the retrieved evidence. External harness agents are not durable route endpoints, so a Pi peer must monitor them.

Do not change source. Merge duplicate findings, reject unsupported claims, preserve uncertainty, and distinguish correctness defects from preferences. Persist a review report only when the requester asks for a durable review.

Return severity-ordered findings with precise evidence, followed by the verdict, verification gaps, skipped areas, and residual risks. Include task handles, monitoring ownership, and pending retrieval or follow-up only when the requester or a new monitoring owner must act; do not expose all internal peer detail by default. When a durable review was requested, return the saved review-report path.
