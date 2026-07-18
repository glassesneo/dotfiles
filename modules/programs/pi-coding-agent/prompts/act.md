---
description: Directly implement a small, reversible change
argument-hint: "<request>"
---
Implement the following request directly only when it introduces no new
interface, has effectively one viable approach, and has small, reversible
impact. If it does, include one line in the final response stating why these
entry conditions were satisfied:

$ARGUMENTS

If the initial assessment fails any entry condition, do not implement directly.
Load and execute `specification-authoring` for a material scope, interface,
acceptance-criteria, or constraint decision, or `implementation-planning` for a
material approach or verification decision. Use the same transition if such a
decision emerges during implementation rather than deciding it yourself.

When moving to either Skill, briefly record which entry condition failed and
what material decision is required.
