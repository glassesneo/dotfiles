---
name: assumption-reversal
description: >-
  Use when the user explicitly asks or agrees to reconsider a current approach
  without treating prior agreements, explicit or implicit solution constraints,
  or compatibility as fixed. Trigger on requests to rethink all prior
  agreements or ask what would be best if existing constraints did not apply,
  including during ideation-dialogue. Do not use without explicit user consent,
  without a baseline to reconsider, or to bypass higher-priority safety,
  authority, privacy, or factual boundaries.
---

# Assumption Reversal

## Purpose

Reconsider a current approach as though accumulated solution commitments were
not fixed, then return the resulting option to the workflow that owns the task.
This skill modifies an existing problem-solving workflow; it does not replace
that workflow or automatically change prior agreements.

## Activation Boundary

Use this skill only when both conditions hold:

- there is a current approach, prior agreement, established system, or other
  baseline to reconsider
- the user has explicitly requested or agreed to the reconsideration

A user request may activate the skill at the start of a task or during an
ongoing workflow. If the agent proposes assumption reversal, wait for explicit
user agreement before applying it; the proposal itself is not consent. Do not
ask again when the user's request already provides explicit consent.

For greenfield ideation with no baseline, use the ordinary ideation workflow
instead. Never use assumption reversal to evade higher-priority safety,
authority, privacy, or factual boundaries.

## Composition Contract

Inherit the calling workflow's problem, responsibility boundary, investigation
method, dialogue method, and output format. Do not replace design,
implementation, review, or another domain workflow with generic ideation.
During `ideation-dialogue`, follow the user's underlying intent as far as that
workflow permits; do not duplicate its dialogue procedure here.

## Workflow

1. Confirm explicit user consent and identify the baseline being reconsidered.
2. Keep the calling workflow's responsibilities and interaction method.
3. Treat prior solution agreements, explicit and implicit solution constraints,
   compatibility commitments, and conventions as variable. Do not decide in
   advance how far back reconsideration may reach.
4. Preserve reality and higher-priority safety, authority, and privacy
   boundaries. Recognize external contracts and compatibility requirements as
   facts while allowing their preservation, change, or migration to be
   reconsidered within the user's authority.
5. Explore what would now be best without returning prematurely to bracketed
   commitments. Do not reject an option merely because it conflicts with one of
   those commitments.
6. Rely on the agent's own exploration by default. Only when choosing a better
   option depends on missing user values, elicit those values through the
   calling workflow's dialogue method; do not ask again for information already
   obtained.
7. Return the resulting option and identify which prior commitments it makes
   worth reconsidering. Include benefits, costs, and uncertainties only as
   needed for the decision; do not impose a fixed analysis phase, comparison
   table, or document schema.
8. Leave existing agreements unchanged until the user decides otherwise and
   the calling workflow carries out that decision.

If no option improves on the current approach, return that result directly. Do
not invent a commitment to reverse merely to justify using the skill.

## Output Contract

Within the calling workflow's output format, make clear:

- the option preferred when the existing frame is not fixed, or that no better
  option was found
- the prior agreements, constraints, or compatibility commitments now worth
  reconsidering
- the benefits, costs, and uncertainties material to adoption
- that existing agreements remain in effect until the user chooses to change
  them
