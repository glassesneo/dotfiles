---
name: codebase-exploration
disable-model-invocation: true
description: >-
  Use when one bounded codebase question needs read-only evidence, constraints,
  and implications. Trigger only for an explicit exploration task. Do not use
  for requester-level orchestration, design decisions, implementation, or user
  dialogue.
---

# Codebase Exploration

Investigate one bounded repository question for its caller. Own the evidence
quality needed to update the caller's working model without taking ownership of
the caller's broader decision.

## Required Handoff

Require the local question, why it matters, and the included scope or explicit
exclusions. Starting files or symbols are optional. When task-specific
information is missing and evidence cannot answer the question, identify the
missing condition and stop rather than widening the task.

## Explore

1. Restate the question and boundaries.
2. Select only the investigation modes the question needs: map responsibilities
   and entrypoints; trace control, data, events, configuration, or state;
   identify interfaces, schemas, invariants, lifecycle and compatibility rules;
   inspect tests and analogous implementations; or trace consumers and impact.
3. Record concrete evidence while investigating. Prefer paths, symbols, line
   locations, tests, configuration, and command results over unsupported
   summaries.
4. Distinguish confirmed facts from inference. Treat analogies as evidence, not
   as a design decision.
5. Stop when the bounded question has an evidence-backed answer, the stated
   scope is exhausted, required information is inaccessible, or further work is
   unlikely to change the caller's decision.

Do not change source or configuration, coordinate other agents, ask the user
questions, decide the final design, or direct the caller's broader task. For a
question about alternatives, report evidence-supported implications without
making the final choice.

## Output Contract

Return the bounded question and scope, findings with concrete file references,
established constraints, material unknowns, and implications for the caller.
Separate confirmed facts from inference and state the confidence basis.
