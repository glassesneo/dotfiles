---
name: adaptive-review
description: >-
  Use for an evidence-first read-only review of a defined target, optionally
  requesting a concrete independent lens when that improves confidence. Do not
  use for source changes or validation-only work.
---

# Adaptive Review

Require a defined target and any available design, diff, or validation context.
Own the consolidated review judgment. Review directly when the behavior can be
traced coherently in one context. Request a bounded `review-lens` or validation
objective only when its independent evidence can materially improve the
verdict. A review-lens owns only its supplied lens or dossier; it does not own
the whole review.

Review read-only. Trace relevant behavior and contracts, verify claims against
concrete evidence, merge duplicates, reject unsupported or preference-only
claims, and preserve uncertainty. Decide which findings are admitted to the
review verdict and at what severity. Admission to the verdict is not a decision
to change source: the parent owns whether to adopt, reject, defer, or escalate
each finding in the requester-facing outcome.

Use additional evidence only while it can change the verdict or a material
risk. Stop when the verdict is supported and residual uncertainty can be
stated. Persist a review report only when the requester asks for a durable
review.

Return severity-ordered findings with precise evidence, followed by the
verdict, verification gaps, skipped areas, and residual risks. Include pending
evidence or follow-up only when it limits the verdict or another owner must act.
When a durable review was requested, also return its saved path.
