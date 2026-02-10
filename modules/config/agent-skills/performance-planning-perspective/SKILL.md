---
name: performance-planning-perspective
description: Apply performance-first planning lens for bottleneck validation, measurement strategy, and safe optimization rollout. Use only when the user explicitly asks for performance-focused planning.
---

# Performance Planning Perspective

Use this skill only when the user explicitly asks for performance-focused planning.

## Focus

Prioritize decisions that improve measurable performance without correctness regressions:

- bottleneck identification and hypothesis validation
- baseline measurement design
- optimization sequencing and guardrails
- post-change verification and rollback triggers

## Required Planning Checks

1. Baseline and targets
- define current baseline metrics
- define explicit success thresholds

2. Bottleneck hypotheses
- list likely bottlenecks and expected impact
- define how each hypothesis will be validated

3. Optimization stages
- sequence changes from low-risk/high-signal to higher-risk
- isolate changes to simplify attribution of gains/regressions

4. Regression guardrails
- define correctness constraints that cannot regress
- define performance rollback triggers and fallback steps

5. Verification
- include benchmark/profile checks per stage
- include acceptance criteria tied to target metrics

## Output Adaptation

When contributing to a plan, emphasize:

- measurable goals and thresholds
- instrumentation and benchmark commands
- risk-managed optimization sequencing
- explicit rollback conditions for regressions
