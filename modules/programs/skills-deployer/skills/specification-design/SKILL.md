---
name: specification-design
description: >-
  Use when the user already holds most of the intended behavior and the work is
  to draw it out, resolve what remains undecided together, and produce one
  implementation-ready design. Typical triggers include existing requirements,
  fixed external contracts, bug-driven changes, and work inside an established
  system. Do not use when direction is open and the user wants to choose it by
  preference; use `ideation-design` for that. Do not use for implementation,
  reports, or artifact storage mechanics.
---

# Specification Design

## Purpose

Run an elicitation dialogue and produce one implementation-ready `design`
artifact, plus a `decision-record` when the dialogue produced recordable
history.

The user is the source of the intended behavior. Draw it out, verify it against
the repository, challenge what does not hold, and settle the remainder with the
user. Do not invent a complete specification first and merely ask for approval.

## Phase Contract

This is the governing phase contract for the design dialogue. It overrides
`liminal-lens` both for decision-cost classification and for the initial order
of elicitation and investigation:

- Any point carrying user intent, externally visible behavior, or product
  preference is user-owned. Cheap reversibility does not license deciding it
  for the user.
- Any verifiable repository or external fact is agent-owned. Investigate it; do
  not ask the user to do the research.
- Any purely internal detail with no user-visible consequence is assumable.
  State the assumption in one line and continue without stopping the dialogue.
- Receive the user's unprocessed intended behavior first, then investigate
  repository facts. Obtain evidence before challenging the user's account or
  proposing closure.

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
- Stop eliciting when further answers can no longer change scope, acceptance
  criteria, or approach.

## Workflow

1. **Elicit.** Draw out the intended behavior, fixed parts, and known open
   parts in free form.
2. **Investigate.** Resolve discoverable facts such as existing interfaces,
   ownership boundaries, constraints, and prior art. Bring the evidence back
   into the dialogue.
3. **Challenge.** Where evidence or self-contradiction requires it, present the
   observation, concrete impact, and viable alternative, then settle the
   outcome with the user.
4. **Settle the remainder.** Close only open points that can affect scope,
   acceptance criteria, or approach, and stop when further answers cannot
   change them.
5. **Commit to scale.** Before artifact assembly, propose the expected
   footprint, the required new interfaces, and an explicit do-not-build list.
   Obtain the user's commitment; the proposal alone is not agreement.
6. **Recap and assemble.** Compactly restate all settled decisions, then
   assemble the artifact from them. If the recap exposes a concrete
   inconsistency, resolve only that point first. The artifact must express
   decisions already made, not become the first place where the user encounters
   the proposed specification.
7. **Persist.** Save the design under the `agent-artifact` contract. Save a
   warranted companion decision record only after design approval returns its
   final path.

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

Keep dialogue history out of the design, and keep settled minor details out of
the decision record.

## Blocked Work

Return `Status: blocked` instead of guessing when a required behavior decision
for scope or acceptance criteria remains unsettled, or when a required external
contract is unavailable. Name the blocking question.

## Completion Output

Return:

- `Design file: <artifact path | none>`
- `Decision record: <artifact path | none>`
- `Status: <implementation-ready | blocked>`
- `Summary: <concise summary>`
- `Scale: <expected footprint and do-not-build headline>`
- `Blocking questions: <none | concise list>`
- `Assumptions/deferrals: <none | concise list>`

Report an artifact path only after persistence succeeds; otherwise use `none`.
Include unresolved assumptions, deferrals, and blockers. Never fabricate a path
or repeat the artifact body.
