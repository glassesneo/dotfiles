---
name: liminal-lens
description: Use when the user is exploring an unclear idea, shaping an underspecified requirement, naming a pattern, comparing vague options, designing a workflow, or turning an intuition into a reusable concept. Trigger when the user's input appears to be a compressed intermediate thought rather than a finalized instruction. Use to prevent premature closure by surfacing latent assumptions, unresolved tensions, alternative frames, and bounded decision points while preserving the normal task workflow. Do not use when the user has clearly decided, asks for direct execution, requests a final artifact, provides concrete implementation details, or signals convergence.
---

# Liminal Lens Skill

## Purpose

`liminal-lens` keeps the assistant from treating unresolved user input as either
a completed specification or a missing form.

The receiver is the assistant handling the current user task. The assistant uses
this skill to decide how to surface unresolved decisions while continuing that
task's normal workflow.

It helps the assistant stay in the liminal phase between unclear intuition and
fixed specification long enough to expose useful frames, latent branches,
unresolved tensions, and bounded choices.

The skill changes how unresolved decisions are surfaced to the user. It does not
replace the normal work required by the task.

## Core Correction

Correct premature closure without turning uncertainty into detached
brainstorming.

When this skill applies, do not immediately collapse the prompt into:

- a final answer
- a fixed specification
- an implementation plan
- a single assumed interpretation
- a generic clarification checklist

Also do not stop at abstract exploration. Use ordinary task discipline first or
in parallel: inspect relevant artifacts, verify claims, understand existing
constraints, and then surface only the unresolved decisions that matter.

The core move is to treat the user prompt as a compressed intermediate thought:
something that may contain an approaching decision, a hidden assumption, an
unresolved distinction, or a frame that has not yet become explicit.

## When to Use

Use this skill when the user is:

- exploring an unclear idea
- shaping an underspecified requirement
- naming a pattern or distinction
- comparing vague options
- designing a workflow, prompt, skill, or reusable concept
- expressing friction, mismatch, or dissatisfaction before the desired change is fixed
- turning an intuition into an artifact
- asking for help with a not-yet-finalized direction

Typical signals include:

- "I have a feeling but not a spec yet."
- "Something about this workflow is off."
- "Could this become a skill?"
- "I want to name this pattern."
- "The requirement is still fuzzy."
- "I'm not sure whether this is X or Y."

## When Not to Use

Do not use this skill when the user has clearly converged or wants direct
execution.

Examples:

- "This is decided."
- "Implement this exact change."
- "Output the full text."
- "Give me only the final answer."
- "Use this specification."
- "Make the patch."
- "Do not ask questions."

Also avoid this skill for simple factual questions, concrete debugging where the
next step is already obvious, fixed-format assignments, or final-artifact
requests where the user has already supplied enough direction.

If a task begins as exploratory but the user later signals convergence, stop
opening new frames and follow the converged task request.

## Surface and Latent Reading

Read the prompt in two layers.

Surface layer:

- what the user explicitly asked for
- named artifact, codebase, document, workflow, or concept
- examples and constraints
- requested action or output
- words that signal uncertainty or convergence

Latent layer:

- what decision may be approaching
- what distinction may still be unresolved
- what assumption may be hidden
- what alternatives may not yet be visible
- where scope may be ambiguous
- where the assistant may be trying to close too early
- whether the problem is framing, scope, naming, execution, or verification

Use the surface layer as evidence. Use the latent layer to decide what needs to
be made visible before the next concrete step.

## Non-Interference Principle

This skill changes dialogue posture, not task discipline.

When this skill is active, continue to perform the normal work required by the
task.

If the task involves an existing codebase, inspect the relevant code as usual.
If the task involves factual claims, verify them as usual. If the task involves
implementation, planning, testing, or review, follow the relevant project
workflow as usual.

Use the skill to shape how unresolved decisions are surfaced to the user.

Do not use exploratory framing as a substitute for investigation, verification,
planning, or execution.

## Liminal Dialogue Procedure

When the skill applies:

1. Determine whether the user is exploring or executing.
2. Read the surface request: what artifact, action, or context is named?
3. Infer the latent tension or unresolved decision.
4. Continue any normal investigation required by the task.
5. Avoid closing the issue before the relevant context is understood.
6. Present 2 to 4 meaningful frames or directions when useful.
7. Keep options concise and user-selectable.
8. Offer a provisional recommendation when evidence supports one.
9. Ask a bounded question only if the answer changes the next step.
10. Stop opening the discussion once the user signals convergence.

Use this procedure to preserve the in-between state briefly and productively,
not to prolong discussion for its own sake.

## Hypothesis Before Question

Usually state a provisional judgment before asking the user anything.

Prefer:

```text
Provisional judgment:
The unresolved point is not the implementation method yet; it is the scope of
the change. The existing structure suggests three viable scopes.
```

Avoid starting with broad extraction questions such as:

```text
What exactly do you want?
Please provide the full requirements.
What is the target user, output format, and constraints?
What specification should I implement?
```

Those questions treat the user as if they already have a complete hidden spec.
When the prompt is liminal, first expose the likely decision axis.

## Bounded Choice Questions

Ask a bounded question when the answer changes what happens next.

Good bounded questions contain concrete candidate paths:

```text
Based on the codebase, this can be handled at three scopes: minimal change,
natural change, or including related cleanup. I recommend the natural change.
Which scope should I use?
```

```text
The design changes depending on whether we treat this as a naming problem or as
an issue with the skill's trigger conditions. I recommend the latter. Which
direction should I optimize for?
```

```text
The unresolved point seems to be scope, not implementation method. Should I use
the minimal fix, align it with the existing flow, or include related cleanup?
```

Prefer one bounded question. Ask two only when the decisions are independent and
both materially affect the next step.

## Convergence Gate

Convergence signals include:

- "decided"
- "this is decided"
- "go with option 2"
- "implement it"
- "write the code"
- "output the full text"
- "make the patch"
- a short concrete answer after options were presented
- an explicit final artifact request

After convergence:

- stop introducing new frames
- do not reopen settled choices
- preserve the selected direction
- perform the requested task work
- mention only essential assumptions or risks
- ask only if a new blocker appears

## Anti-Patterns

### Detached Brainstorming

Bad behavior:

The assistant produces ideas only because the requirement is unclear while
skipping investigation that the task normally requires.

Better behavior:

Perform the normal task investigation first, then surface unresolved decision
points as bounded options or frames.

### Form-Filling Clarification

Bad behavior:

The assistant begins with a checklist of generic requirements questions.

Better behavior:

Offer a hypothesis about the actual unresolved decision, then ask one bounded
choice question if needed.

### Premature Specification

Bad behavior:

The assistant turns a compressed thought into a full specification before the
main distinction or scope is settled.

Better behavior:

Name the unsettled frame and ask the user to choose among concrete directions.

### One-Answer Collapse

Bad behavior:

The assistant assumes the first plausible interpretation is the intended one.

Better behavior:

Show 2 to 4 plausible interpretations when the difference would change the
work, and recommend one only when evidence supports it.

### Endless Divergence

Bad behavior:

The assistant keeps opening alternatives after the user has chosen a direction.

Better behavior:

Use the convergence gate. Once the user chooses, execute.

### Workflow Interference

Bad behavior:

The assistant treats this skill as permission to ignore repository inspection,
planning, testing, review, or other required task workflow.

Better behavior:

Continue the normal workflow and use this skill only to present unresolved
choices in a better dialogue shape.

## Output Guidance

Keep responses grounded, compact, and selectable.

When useful, include:

- a provisional judgment about the unresolved decision
- the relevant context checked
- 2 to 4 possible directions with implications
- a recommended default when evidence supports one
- one bounded question or the next concrete action

Do not force a fixed template onto every response. Use the references for
examples and review calibration when the response shape is unclear.

## References

- `references/examples.md`: additional examples for liminal dialogue responses.
- `references/review-checklist.md`: compact review checklist for routing and response quality.
