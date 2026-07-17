---
name: liminal-lens
description: >-
  Use when a task has underspecified requirements, unresolved design directions,
  durable concept naming, vague option comparisons, workflow/prompt/skill design,
  or dissatisfaction without a settled desired change. Investigate the task
  normally, preserve settled decisions, state reversible assumptions visibly,
  and surface costly open decisions as bounded choices. Do not use for simple
  factual questions, fixed-format assignments, debugging with an obvious next
  step, or direct execution/final-artifact requests whose relevant decisions are
  already settled.
---

# Liminal Lens Skill

## Purpose

Use `liminal-lens` to continue ordinary task work while handling unresolved
decisions in proportion to the cost of assuming incorrectly. The unit of work is
an individual decision point, not the conversation as a whole.

This skill prevents both premature closure and unnecessary requirements
interviews. It does not turn the task into brainstorming and does not replace
investigation, planning, implementation, testing, review, or any other
task-specific discipline.

## Routing Boundary

Use this skill for underspecified requirements, unresolved design directions,
durable concept naming, vague option comparison, workflow, prompt, or skill
design, and dissatisfaction whose desired change is not settled.

Do not use it for simple factual questions, fixed-format assignments, debugging
with an obvious next step, or direct execution and final-artifact requests whose
relevant decisions are already settled. Concrete implementation details do not
by themselves make the skill inapplicable: a request may contain settled details
and still have another costly decision open.

If every relevant decision point is settled, perform the ordinary task directly.
Do not add special dialogue or narrate a transition.

## Decision Points and Settlement

Consider only decisions relevant to the next concrete step.

A decision point is **settled** when it is:

- explicitly stated by the user
- previously selected by the user
- forced to one viable option by verified constraints or investigation

Every other relevant point is **open**. Treat each settled point as part of the
task contract. Preserve it while handling other open points, and never reopen it.
Record a user's answer to a surfaced decision as settled.

### Execution Override

An explicit command such as "implement it," "do not ask," or "this is decided,"
or complete acceptance criteria, settles the request globally for execution
purposes. Treat any remaining assumable point as low cost: state the necessary
assumption visibly and proceed. Ask only about a true blocker for which no
workable assumption exists. Deliver the requested work rather than describing
this rule or a change in dialogue posture.

## Assumption Cost Test

Apply this test to every open decision point. The only branch criterion is the
breadth and reversibility of the rework required if the assumption is wrong.
Topic labels may illustrate likely cost, but they never independently determine
whether to ask.

An incorrect assumption is **high cost** when correcting it would likely:

- cross architecture or ownership boundaries
- revise a durable or external contract
- rename a durable concept
- substantially change scope or approach
- reveal that the user's goal was misunderstood

An incorrect assumption is **low cost** when it can be corrected later through
one small local edit, such as changing an internal name or value, formatting,
a default, independent step ordering, or another easily overridden detail.

For a low-cost open point, choose the most plausible assumption, state it in one
user-visible line, do not ask about it, and proceed.

For a high-cost open point, use the bounded-choice procedure below before taking
the step that depends on it.

## Procedure

1. **Do the ordinary task work first.** Inspect relevant artifacts, verify
   claims, understand constraints, and follow the task's normal workflow.
   Bounded options cannot substitute for this work.
2. **Enumerate relevant decision points.** Use the explicit request and verified
   context as evidence. Unstated assumptions, tensions, scope boundaries, and
   framing choices may help reveal candidate points, but they do not override
   surface evidence.
3. **Classify each point independently.** Mark it settled or open. Keep every
   settled point fixed.
4. **Apply the Assumption Cost Test to each open point.** Use later rework and
   reversibility as the sole axis.
5. **Act on the result.** State low-cost assumptions and continue. Surface
   high-cost points as bounded choices. If all points are settled, continue the
   ordinary task without extra dialogue.
6. **Persist answers.** Treat every user selection as settled in subsequent
   work.

## High-Cost Bounded Choices

For each high-cost open point that affects the next step:

1. State a provisional judgment about the decision axis before asking anything.
2. Present two to four concrete directions and the practical implication of
   each.
3. Recommend one direction when evidence supports it.
4. Explicitly allow the user to correct the proposed axis as well as choose an
   option.
5. Ask one bounded, selectable question.

Prefer one question. Ask at most two only when independent high-cost points both
affect the next step, and combine them in one message rather than questioning the
user serially.

Keep the judgment provisional to reduce anchoring. Avoid generic extraction
questions such as requests for a complete hidden specification.

## Anti-Patterns

### Reopening Settled Points

Do not present alternatives for a user choice or constraint-forced decision.
Carry it forward as part of the task contract.

### Asking About Low-Cost Points

Do not block work on an internal name, local value, formatting detail, default,
or similarly reversible choice. State the assumption in one line and proceed.

### Silently Assuming High-Cost Points

Do not choose an architecture boundary, durable contract, durable name, broad
scope, or goal interpretation without surfacing the costly open decision.

### Detached Brainstorming

Do not generate abstract possibilities before inspecting artifacts or verifying
the context the task normally requires. Investigate first, then expose only the
high-cost points that remain open.

### Form-Filling Clarification

Do not begin with a generic requirements checklist. For a high-cost point, offer
a provisional axis and bounded directions before the question.

### Workflow Interference

Do not let dialogue shaping replace repository exploration, factual
verification, planning, implementation, testing, review, or required approval
gates.

## Output Guidance

Keep user-facing responses grounded and compact. State low-cost assumptions in
one visible line and continue the work. For high-cost points, provide the
provisional axis, bounded directions with implications, a supported
recommendation, permission to correct the axis, and one bounded question. Do not
force this into a diagnostic template when natural prose is clearer.

## References

- Read `references/examples.md` when response shape or cost classification needs
  calibration.
- Use `references/review-checklist.md` before finalizing a response when open
  points were assumed or surfaced.
