---
name: ideation-design
description: >-
  Use when a request starts from an idea rather than a specification, technical
  constraints are weak, and the user wants to select the elements themselves.
  Trigger for personal tooling, configuration and environment design, workflow
  and prompt design, greenfield structure, and any work where taste or intent
  decides more than necessity. Do not use when the user already holds the
  intended behavior and only needs it drawn out; use `specification-design` for
  that. Do not use for implementation, reports, or artifact storage mechanics.
---

# Ideation Design

Run a selection dialogue and produce one `design` artifact, plus a
`decision-record` when the dialogue produced recordable history.

Here the decisive input is the user's will, not necessity. Few options are
forced by constraints, so your job is to make the real choices visible and let
the user select, rather than to converge on the direction you would pick.

## Dialogue Contract

This skill declares a governing phase contract that overrides the default
question-cost handling in `liminal-lens` for the duration of the design
dialogue:

- Any point where more than one direction is defensible is user-owned. Cheap
  reversibility does not license deciding it for them.
- Any point that is a verifiable repository or external fact is yours to
  resolve. Investigate it; do not ask.
- Any detail with no visible consequence for the user stays low cost. State the
  assumption in one line and continue.

Use `liminal-lens` for the mechanics of bounded choices and question count.

Conduct the dialogue as a conversation, not an interview:

1. Open with free text, not options. Ask what the user is drawn to, what they
   dislike about the current situation, and what they picture. Do not present
   an option set before this.
2. Build the option space from that answer. Options you enumerate before
   hearing the user anchor the whole dialogue on your framing.
3. Reflect back what you understood in your own words before the next step. Do
   not proceed on an unconfirmed reading of a substantial answer.
4. Offer the axis alongside the options, and say explicitly that the user may
   reject the axis itself, not just pick from it.
5. Let answers change the agenda. When a choice makes later questions moot or
   reframes them, drop them and re-open with free text.

When a structured question capability is available, use it for commitment
points. Ordinary chat remains the main channel.

## Selection Quality

- Present concrete directions with their practical consequence, not abstract
  labels. Two to four is usually enough.
- Recommend one when evidence supports it, and separate that recommendation
  from the enumeration so it reads as input rather than a default.
- Never present a decided direction as a question, and never present a genuine
  choice as settled.
- Record a preference as a preference. Do not manufacture technical
  justification for a choice the user made on taste.

## Workflow

1. **Draw out intent.** Free-text exploration of what the user wants and why
   the current situation dissatisfies them.
2. **Investigate.** Establish what the repository actually constrains, so the
   option space is real. Weak constraints still bound some choices.
3. **Frame and select.** Work through the decisions that shape the result,
   largest framing decision first, using bounded choices built from the user's
   own words.
4. **Estimate scale.** Before assembling, propose the expected footprint, the
   new interfaces the work does need, and an explicit do-not-build list.
   Confirm it with the user. An open-ended brief is where over-building starts;
   this contract is what constrains the implementer.
5. **Recap and assemble.** Restate the settled decisions compactly, then build
   the design from them. The user should recognize the document as the choices
   they already made, not meet it for the first time at approval.
6. **Persist.** Save the design, then the decision record when one is
   warranted. A dialogue that changed direction usually warrants one.

## Content Boundary

`agent-artifact` owns the design and decision-record formats, the split rule
between them, and the storage contract. Read
`references/design-artifact-examples.md` there before assembling, and follow it
rather than inventing headings.

Acceptance criteria must still be observable even when the goal is a matter of
taste. State what will be true of the result, not that the user will like it.

Keep the design free of dialogue history. A settled minor detail is ordinary
design text, not a recorded decision.

## Blocked Work

Return `Status: blocked` instead of guessing when the user defers a framing
choice that the rest of the design depends on. Name the blocking choice and the
directions still open.

## Completion Output

Return:

- `Design file: <artifact path | none>`
- `Decision record: <artifact path | none>`
- `Status: <implementation-ready | blocked>`
- `Summary: <concise summary>`
- `Scale: <expected footprint and do-not-build headline>`
- `Blocking choices: <none | concise list>`
- `Assumptions/deferrals: <none | concise list>`

Report an artifact path only when persistence completed; otherwise use `none`.
Never fabricate a path or repeat the artifact body in this output.
