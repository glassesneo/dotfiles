---
name: specification-design
description: >-
  Use when the user already holds most of the intended behavior and the work is
  to draw it out, resolve what is still undecided together, and produce one
  implementation-ready design. Trigger for requests with existing requirements,
  fixed external contracts, bug-driven changes, or work inside an established
  system. Do not use when the direction is open and the user wants to choose
  elements by preference; use `ideation-design` for that. Do not use for
  implementation, reports, or artifact storage mechanics.
---

# Specification Design

Run an elicitation dialogue and produce one `design` artifact, plus a
`decision-record` when the dialogue produced recordable history.

The user is the source of the intended behavior. Your job is to draw it out,
verify it against the repository, challenge what does not hold, and settle the
remainder with them. Do not present a fully invented specification and ask for
approval of it.

## Dialogue Contract

This skill declares a governing phase contract that overrides the default
question-cost handling in `liminal-lens` for the duration of the design
dialogue:

- Any point carrying user intent, externally visible behavior, or product
  preference is user-owned. Surface it even when a wrong assumption would be
  cheap to reverse.
- Any point that is a verifiable repository or external fact is yours to
  resolve. Investigate it; do not ask.
- Any purely internal detail with no user-visible effect stays low cost. State
  the assumption in one line and continue.

Use `liminal-lens` for the mechanics of bounded choices and question count.

Conduct the dialogue as a conversation, not an interview:

1. Open with free text, not options. Ask the user to describe what they already
   have in mind before you propose any structure.
2. Reflect back what you understood in your own words before the next step. Do
   not proceed on an unconfirmed reading of a substantial answer.
3. Use selection questions only to close a point you have already framed
   together, and only after free-text exploration on that topic.
4. Let answers change the agenda. When an answer invalidates the direction of
   your remaining questions, drop them and re-open with free text.

When a `question` capability is available, use it whenever you ask the user for
an answer. Use `text` for free-text exploration and `single`, `multi`, or
`confirm` for selection and commitment. Keep ordinary chat for investigation
results, reflection, and explanation; do not request an answer there. If the
capability is unavailable, ask the same necessary question in ordinary chat.
Continue to group related questions and ask only the minimum needed.

## Workflow

1. **Elicit.** Ask the user to describe the intended behavior, the parts they
   consider fixed, and what they know is still open. Use a `text` question when
   the capability is available; free text describes the answer format, not the
   conversation channel.
2. **Investigate.** Resolve discoverable facts: existing interfaces, ownership
   boundaries, constraints, and prior art. Bring evidence back into the
   dialogue.
3. **Challenge.** When user input conflicts with observed evidence or with
   itself, state the observation, the concrete impact, and a viable
   alternative. Do not challenge from preference alone. Record the outcome.
4. **Settle the remainder.** Work through the open points that matter for the
   next step. Stop when further answers cannot change scope, acceptance
   criteria, or approach.
5. **Estimate scale.** Before assembling, propose the expected footprint, the
   new interfaces the work does need, and an explicit do-not-build list.
   Confirm it with the user through `confirm` when the capability is available.
   Frontier models over-build by default; this contract is what constrains the
   implementer.
6. **Recap and assemble.** Restate the settled decisions compactly, then build
   the design from them. The user should recognize the document as the
   decisions they already made, not meet it for the first time at approval.
7. **Persist.** Save the design, then the decision record when one is
   warranted.

## Content Boundary

`agent-artifact` owns the design and decision-record formats, the split rule
between them, and the storage contract. Read
`references/design-artifact-examples.md` there before assembling, and follow it
rather than inventing headings.

Keep the design free of dialogue history. A settled minor detail is ordinary
design text, not a recorded decision.

## Blocked Work

Return `Status: blocked` instead of guessing when the user cannot supply a
behavior decision that scope or acceptance criteria depend on, or when a
required external contract is unavailable. Name the blocking question.

## Completion Output

Return:

- `Design file: <artifact path | none>`
- `Decision record: <artifact path | none>`
- `Status: <implementation-ready | blocked>`
- `Summary: <concise summary>`
- `Scale: <expected footprint and do-not-build headline>`
- `Blocking questions: <none | concise list>`
- `Assumptions/deferrals: <none | concise list>`

Report an artifact path only when persistence completed; otherwise use `none`.
Never fabricate a path or repeat the artifact body in this output.
