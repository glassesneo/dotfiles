---
name: intent-elicitation
description: >-
  Use when the user already holds most of an intended behavior or outcome and
  wants it drawn out through dialogue before the result is completed. Trigger
  for existing requirements, fixed external contracts, bug-driven changes,
  work inside an established system, and other cases where the target is
  substantially known. Do not use when direction is open and the user wants to
  choose it by preference; use `ideation-dialogue`. Do not use for direct
  implementation, factual reporting, or storage mechanics when elicitation is
  not needed.
---

# Intent Elicitation

## Purpose

Run an elicitation dialogue that draws out an outcome the user already
substantially holds, and return the deliverable the user requested.

The user is the source of the intended behavior or outcome. Draw it out, verify
it against evidence, challenge what does not hold, and settle the remainder with
the user. Do not invent a complete specification first and merely ask for
approval.

The user or caller defines the final deliverable. This skill owns the dialogue
and task-adaptive completion; it adds no fixed document schema, readiness gate,
approval step, or persistence process. When the requested deliverable needs
such a process, compose this skill with its owner rather than reproducing that
process here.

## Phase Contract

This is the governing phase contract for the dialogue. It overrides
`liminal-lens` both for decision-cost classification and for the initial order
of elicitation and investigation:

- Any point carrying user intent, externally visible behavior, or product
  preference is user-owned. Cheap reversibility does not license deciding it
  for the user.
- Any verifiable fact about the relevant context or external world is
  agent-owned. Investigate it when it can affect the requested outcome; do not
  ask the user to do the research.
- Any purely internal detail with no user-visible consequence is assumable.
  State the assumption in one line and continue without stopping the dialogue.
- Receive the user's unprocessed intended behavior first, then investigate only
  relevant discoverable context and constraints. Obtain evidence before
  challenging the user's account or proposing closure.

Use `liminal-lens` for bounded-choice mechanics, prompt count, and
settled-decision handling. This skill retains ownership of which decisions are
user-owned.

## Conversation Protocol

Conduct the dialogue as a conversation, not an interview:

1. Open with free-form exploration, not options or a model-authored structure.
   Ask the user to describe the intended behavior, what is fixed, and what they
   already know is open.
2. Reflect a substantial free-form answer in your own words when its
   interpretation will shape later decisions, and confirm that interpretation
   before using it. Treat an explicit bounded selection as settled; revisit it
   only when it conflicts with earlier user intent or evidence, or its response
   note leaves the choice ambiguous.
3. Use bounded selection only to close a point already framed together, and
   only after free-form exploration of that topic.
4. Let answers change the agenda. Drop invalidated prompts and return to
   free-form exploration when the framing changes.

Do not reopen a settled behavior, and do not present a genuine open point as
settled.

## Runtime Interaction

When the runtime provides a structured user-input capability, use it whenever
you directly request an answer. Use a free-form response for exploration and a
bounded selection only to close a point already framed together. Keep
investigation results, reflections, challenges, and alternative explanations
separate from the answer request.

An incomplete structured interaction does not settle a user-owned decision. If
that capability cannot be used or cannot complete, ask the same necessary
prompt through an available conversation channel. If cancellation or deferral
leaves a required decision unavailable, return blocked rather than infer an
answer. Group related prompts where useful and ask only the minimum needed.

## Mode-Specific Quality Rules

- Challenge user input only when it conflicts with observed evidence or with
  itself, never from model preference alone.
- State a challenge as the observation, its concrete impact, and a viable
  alternative, in that order. Record the settled outcome when it is durable.
- Stop eliciting when further answers can no longer change the requested
  outcome.

## Workflow

1. **Elicit.** Draw out the intended behavior, fixed parts, and known open
   parts in free form.
2. **Investigate when relevant.** Resolve only discoverable facts and
   constraints that can affect the requested outcome. For software work, these
   may include existing interfaces, ownership boundaries, and prior art. Bring
   relevant evidence back into the dialogue.
3. **Challenge.** Where evidence or self-contradiction requires it, present the
   observation, concrete impact, and viable alternative, then settle the
   outcome with the user.
4. **Settle the remainder.** Close only open points that can affect the
   requested outcome, and stop when further answers cannot change it.
5. **Recap and complete.** Compactly restate the settled decisions, then
   assemble the requested deliverable from them. If the recap exposes a
   concrete inconsistency, resolve only that point first. Apply the
   final-content check below, then return the deliverable or, when no form was
   requested, a concise synthesis of the settled result, material remaining
   uncertainty, and any explicitly deferred point.

If the dialogue shows that the direction is actually open and the user wants to
choose the elements by preference, say so and offer to continue with
`ideation-dialogue` instead of forcing the elicitation style. Do not switch
silently.

## Blocked Work

Return `Status: blocked` instead of guessing when a required behavior decision
for the requested outcome remains unsettled, or when a required external
contract is unavailable. Name the blocking question.

## Completion Output

Return the deliverable requested by the user once the completion condition is
met. Before returning, inspect the proposed deliverable for consequential
choices. Every such choice must already have been settled with the user or be
forced by verified constraints. Otherwise resume the dialogue; the final
deliverable must not be the first place the user encounters that choice.

When no output form was requested, use a concise form suited to the result and
include the settled content, any material remaining uncertainty, and any point
the user explicitly deferred. Do not impose a fixed dialogue-summary schema.
For blocked work, report `Status: blocked` with the unresolved question instead
of presenting an incomplete result as complete.
