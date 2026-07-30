---
name: ideation-design
description: >-
  Use when a request starts from an idea and the user wants to choose its
  direction rather than supply an already-held specification. Trigger for
  personal tooling, configuration and environment design, workflow and prompt
  design, greenfield structure, and other work where taste or intent decides
  more than necessity. Do not use when the user already holds the intended
  behavior and only needs it drawn out; use `specification-design` for that.
  Do not use for implementation, reports, or artifact storage mechanics.
---

# Ideation Design

## Purpose

Run a selection dialogue and produce one implementation-ready `design`
artifact, plus a `decision-record` when the dialogue produced recordable
history.

Here the decisive input is the user's will, not necessity. Few options are
forced by constraints, so make the real choices visible and let the user select
rather than converge on the direction you would pick.

## Phase Contract

This is the governing phase contract for the design dialogue. It overrides
`liminal-lens` both for decision-cost classification and for the initial order
of elicitation and investigation:

- Any point where more than one direction is defensible is user-owned. Cheap
  reversibility does not license deciding it for the user.
- Any verifiable repository or external fact is agent-owned. Investigate it; do
  not ask the user to do the research.
- Any internal detail with no user-visible consequence is assumable. State the
  assumption in one line and continue without stopping the dialogue.
- Receive the user's unprocessed intent first, then investigate repository
  facts. Obtain evidence before framing options or making recommendations.

Use `liminal-lens` for bounded-choice mechanics, prompt count, and
settled-decision handling. This skill retains ownership of which decisions are
user-owned.

## Conversation Protocol

Conduct the dialogue as a conversation, not an interview:

1. Open with free-form exploration, not options. Ask what the user is drawn to,
   what they dislike about the current situation, and what they picture.
2. Build the option space from that answer. Options offered earlier would
   anchor the dialogue on the model's framing.
3. Reflect every substantial answer in your own words and get confirmation of
   that interpretation before using it for later decisions.
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
   with the current situation, and what outcome they imagine. Reflect and
   confirm substantial answers before proceeding.
2. **Investigate.** Establish the actual repository and external constraints
   before constructing the option space.
3. **Frame and select.** Starting with the largest framing decision, build
   concrete choices from the user's words, expose their consequences, and let
   the user reject an unsuitable axis.
4. **Commit to scale.** Before artifact assembly, propose the expected
   footprint, the required new interfaces, and an explicit do-not-build list.
   Obtain the user's commitment; the proposal alone is not agreement.
5. **Recap and assemble.** Compactly restate all settled decisions and confirm
   them before assembly. The artifact must express choices already made, not
   become the first place where the user encounters the proposed design.
6. **Persist.** Save the design under the `agent-artifact` contract. Save a
   warranted companion decision record only after design approval returns its
   final path. A dialogue that changed direction usually warrants one.

## Artifact Boundary

`agent-artifact` owns design and decision-record formats, their split rule, and
the storage protocol. Before assembly, read
`agent-artifact/references/design-artifact-examples.md` in the sibling
`agent-artifact` skill package; do not invent headings or duplicate its storage
rules.

Only an approved design final path permits saving a companion decision record.
If design persistence instead remains pending for revision, is rejected,
cancelled, unavailable, or blocked, do not save the record. Follow the
`agent-artifact` protocol to revise the same pending design until approval.

Acceptance criteria must be observable even for a taste-led goal. State what
will be true of the result, not that the user will like it. Keep dialogue
history out of the design, and keep settled minor details out of the decision
record.

## Blocked Work

Return `Status: blocked` instead of guessing when a required framing decision
remains unsettled. Name the blocking choice and the directions still open.

## Completion Output

Return:

- `Design file: <artifact path | none>`
- `Decision record: <artifact path | none>`
- `Status: <implementation-ready | blocked>`
- `Summary: <concise summary>`
- `Scale: <expected footprint and do-not-build headline>`
- `Blocking choices: <none | concise list>`
- `Assumptions/deferrals: <none | concise list>`

Report an artifact path only after persistence succeeds; otherwise use `none`.
Include unresolved assumptions, deferrals, and blockers. Never fabricate a path
or repeat the artifact body.
