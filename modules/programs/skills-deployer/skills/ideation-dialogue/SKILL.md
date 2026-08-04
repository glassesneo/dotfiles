---
name: ideation-dialogue
description: >-
  Use when a request starts from an idea and the user wants to choose its
  direction through preference-led dialogue rather than supply an already-held
  outcome. Trigger for personal tooling, environments, workflows, prompts,
  greenfield structures, schedules, plans, and other work where taste or intent
  decides among defensible directions. Do not use when the user already holds
  most of the intended outcome and needs it drawn out; use `intent-elicitation`.
  Do not use for direct implementation, factual reporting, or storage mechanics
  when no preference-led dialogue is needed.
---

# Ideation Dialogue

## Purpose

Run a preference-led selection dialogue and return the deliverable the user
requested.

Here the decisive input is the user's will, not necessity. Few options are
forced by constraints, so make the real choices visible and let the user select
rather than converge on the direction you would pick.

The user or caller defines the final deliverable. This skill owns the dialogue
and task-adaptive completion; it adds no fixed document schema, readiness gate,
approval step, or persistence process. When the requested deliverable needs
such a process, compose this skill with its owner rather than reproducing that
process here.

## Phase Contract

This is the governing phase contract for the dialogue. It overrides
`liminal-lens` both for decision-cost classification and for the initial order
of elicitation and investigation:

- Any point where more than one direction is defensible is user-owned. Cheap
  reversibility does not license deciding it for the user.
- Any verifiable fact about the relevant context or external world is
  agent-owned. Investigate it when it can affect the requested outcome; do not
  ask the user to do the research.
- Any internal detail with no user-visible consequence is assumable. State the
  assumption in one line and continue without stopping the dialogue.
- Receive the user's unprocessed intent first, then investigate only relevant
  discoverable context and constraints. Obtain evidence before framing options
  or making recommendations.

Use `liminal-lens` for bounded-choice mechanics, prompt count, and
settled-decision handling. This skill retains ownership of which decisions are
user-owned.

## Conversation Protocol

Conduct the dialogue as a conversation, not an interview:

1. Open with free-form exploration, not options. Ask what the user is drawn to,
   what they dislike about the current situation, and what they picture.
2. Build the option space from that answer. Options offered earlier would
   anchor the dialogue on the model's framing.
3. Reflect a substantial free-form answer in your own words when its
   interpretation will shape later decisions, and confirm that interpretation
   before using it. Treat an explicit bounded selection as settled; revisit it
   only when it conflicts with earlier user intent or its response note leaves
   the choice ambiguous.
4. Present the decision axis with the options and explicitly allow the user to
   reject the axis itself, not merely select an option.
5. Let answers change the agenda. Drop invalidated prompts and return to
   free-form exploration when the framing changes.

Do not reopen a settled direction, and do not present a genuine choice as
settled.

## Runtime Interaction

When the runtime provides a structured user-input capability, use it whenever
you directly request an answer. Use a free-form response for exploration and a
bounded selection only to close a point already framed together. Keep
investigation results, reflections, recommendations, and option explanations
separate from the answer request.

An incomplete structured interaction does not settle a user-owned decision. If
that capability cannot be used or cannot complete, ask the same necessary
prompt through an available conversation channel. If cancellation or deferral
leaves a required decision unavailable, return blocked rather than infer an
answer. Group related prompts where useful and ask only the minimum needed.

## Mode-Specific Quality Rules

- Present concrete directions and their practical consequences, not abstract
  labels. Two to four directions are usually enough.
- When evidence supports a recommendation, state it separately from the option
  enumeration so it remains input rather than a default.
- Record a user choice based on taste as a preference. Do not manufacture
  technical necessity to justify it afterward.
- Start with the largest framing decision so upstream choices can eliminate
  irrelevant downstream detail.

## Workflow

1. **Draw out intent.** Explore in free form what the user wants, what is wrong
   with the current situation, and what outcome they imagine.
2. **Investigate when relevant.** Establish only the discoverable facts and
   external constraints that can affect the available directions or requested
   outcome.
3. **Frame and select.** Starting with the largest framing decision, build
   concrete choices from the user's words, expose their consequences, and let
   the user reject an unsuitable axis.
4. **Complete.** Finish when the remaining dialogue can no longer materially
   improve the requested outcome and the final-content check below passes.
   Return the requested deliverable, or when no form was requested, a concise
   synthesis of the settled result, material remaining uncertainty, and any
   explicitly deferred point.

If the dialogue shows that the user already holds the intended behavior and only
needs it drawn out, say so and offer to continue with `intent-elicitation`
instead of manufacturing choices. Do not switch silently.

## Blocked Work

Return `Status: blocked` instead of guessing when a required framing decision
remains unsettled. Name the blocking choice and the directions still open.

## Completion Output

Return the deliverable requested by the user once the completion condition is
met. Before returning, inspect the proposed deliverable for consequential
choices. Every such choice must already have been settled with the user or be
forced by verified constraints. Otherwise resume the dialogue; the final
deliverable must not be the first place the user encounters that choice.

When no output form was requested, use a concise form suited to the result and
include the settled content, any material remaining uncertainty, and any point
the user explicitly deferred. Do not impose a fixed dialogue-summary schema.
For blocked work, report `Status: blocked` with the unresolved choice instead
of presenting an incomplete result as complete.
