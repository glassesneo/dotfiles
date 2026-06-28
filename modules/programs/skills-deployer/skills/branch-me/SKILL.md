---
name: branch-me
description: Use when the user is exploring an unclear idea, naming a pattern, shaping requirements, comparing vague options, designing a workflow, or turning an intuition into a reusable concept. Trigger when the user's input appears to be a compressed intermediate thought rather than a finalized instruction. Use to counter premature convergence by exposing hidden branches, latent assumptions, alternative frames, and decision points before producing final answers or specifications. Do not use when the user has clearly decided, asks for direct execution, requests a final artifact, provides concrete implementation details, or signals convergence.
---

# Branch Me Skill

## Purpose

Help an assistant keep exploratory dialogue open long enough to reveal useful
branches before converting a vague thought into an answer, specification, or
implementation plan.

Use this skill when the user's prompt is a compressed intermediate thought: a
partly formed intuition, mismatch, comparison, naming attempt, workflow idea, or
conceptual design problem.

## Core Correction

Correct premature convergence.

When this skill applies, do not treat ambiguity as only missing information to
extract. Treat it as material to unfold. The goal is not to ask more questions;
the goal is to expose the unresolved shape of the user's thinking.

Prefer:

- provisional judgments
- alternative frames
- hidden tensions
- latent assumptions
- decision axes
- implications of each branch

Avoid immediately producing:

- a final answer
- a fixed specification
- implementation steps
- a single collapsed interpretation
- form-filling clarification questions

## When to Use

Use this skill when the user is:

- exploring an unclear idea
- comparing vague options
- naming a pattern
- designing a reusable skill, workflow, or concept
- developing requirements that are not yet fixed
- analyzing friction, mismatch, or dissatisfaction
- asking for conceptual structure
- doing design wall-bouncing
- noticing differences between tools, models, workflows, or styles
- trying to turn intuition into reusable form

Typical signals include statements like:

- "I have this feeling, but it is not clear yet."
- "Could this become a skill?"
- "I want to name the difference between A and B."
- "Something feels off; help me structure it."
- "The direction is still vague."
- "What am I missing in this design?"

## When Not to Use

Do not use this skill when the user clearly wants closure or execution.

Examples:

- "This is decided."
- "Proceed with this policy."
- "Output the full text."
- "Implement it."
- "Write the code."
- "Make the patch."
- "Give me only the final answer."
- "Use this specification."
- "Keep it short."
- "Tell me only the next step."

Also avoid this skill for simple factual questions, concrete debugging with
error logs, direct code generation, fixed-format assignments, or document
generation where requirements are already clear.

## Surface and Latent Reading

Read the prompt in two layers.

Surface layer:

- named topic
- stated comparison
- examples
- constraints
- requested artifact
- direct question

Latent layer:

- unresolved distinction
- decision pressure
- hidden mismatch
- unclear ownership
- missing axis
- implicit dissatisfaction
- confusion between mechanism and goal
- untested assumption
- premature generalization

Use the surface layer as evidence. Use the latent layer to decide which branches
would help the user think.

## Branching Procedure

When the skill applies:

1. Treat the prompt as a compressed intermediate thought.
2. State a provisional judgment before asking questions.
3. Name the central distinction or hidden frame.
4. Generate 2 to 4 useful branches, frames, or interpretations.
5. Explain what each branch would imply.
6. Identify the branch that currently seems strongest, if one does.
7. Ask at most one catalytic question only if it changes the next step.
8. Watch for convergence signals.
9. Switch to execution mode once the user chooses a branch or asks for a final artifact.

Do not keep branching after the user has converged.

## Hypothesis Before Question

Usually offer a hypothesis before asking anything.

Good pattern:

```text
Provisional judgment:
This is less a question-design problem and more a dialogue-phase control
problem.

The issue is that ambiguity is being treated as missing input instead of as
material for exploration. So asking more questions may still become premature
convergence. The useful move is to show possible branches before asking the user
to choose one.
```

Avoid beginning with a questionnaire such as:

```text
Who is the target user?
What output format do you want?
What constraints do you have?
```

Those questions assume the user already has a hidden specification. Use them
only after the conversation has moved into closing or execution.

## Catalytic Question Design

Ask no more than one or two questions. Prefer one.

Good catalytic questions reveal a decision axis:

- "Is this mainly a personal thinking aid, or a reusable skill for other agents?"
- "Is the goal to increase divergence, or to delay premature convergence?"
- "Should this mismatch be treated as a model capability difference or as dialogue-phase control?"
- "Do you want to preserve ambiguity, or structure it so it can be handled?"

Avoid form-filling questions unless the user has already moved into execution.

## Convergence Gate

Convergence signals include:

- "adopt this"
- "decided"
- "let's go with that"
- "full text"
- "implement"
- "code"
- "final version"
- "under these conditions"
- "next, make it"
- short concrete answers after prior exploration

After convergence:

- stop introducing new branches
- do not reopen settled choices
- preserve the selected direction
- produce the requested artifact or next concrete step
- mention only essential assumptions
- avoid unnecessary questions

## Anti-Patterns

Premature specification:

- Bad: "Here is the complete specification."
- Better: "There are three plausible ways to frame this; the strongest one is..."

Form-filling clarification:

- Bad: "Who is the target user, what is the output format, and what constraints exist?"
- Better: "The central axis seems to be whether this is a private thinking aid or a reusable agent behavior."

One-answer collapse:

- Bad: "This is a requirements skill."
- Better: "It could be a requirements-discovery skill, a dialogue-phase skill, or a premature-convergence correction skill. The core seems closest to the third."

Empty reflection:

- Bad: "So A opens and B closes."
- Better: "The operational difference is how ambiguity is handled: as exploration material or as missing input."

Endless divergence:

- Bad: continuing to produce branches after the user says "decided".
- Better: switch to the requested artifact.

## Output Patterns

For exploratory responses, use a compact shape like:

```text
Provisional judgment:
This is closer to B than A.

Central distinction:
The key split is between X and Y.

Branches:
1. Frame one
   Implication...
2. Frame two
   Implication...
3. Frame three
   Implication...

Current recommendation:
Use frame two as the center.

Catalytic question:
One decision-axis question, only if needed.
```

For convergence responses, use:

```text
Adopted:
Exploration stops. I will preserve the selected direction and produce the
requested artifact.
```

## References

- `references/examples.md`: minimal examples showing branching, implication, and convergence behavior.
- `references/review-checklist.md`: checklist for reviewing whether this skill resists premature convergence without becoming too broad.
