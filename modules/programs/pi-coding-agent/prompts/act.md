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
Load and execute `specification-design` when the user already holds the intended
behavior and the open decision is about requirements, scope, or verification.
Load and execute `ideation-design` when the direction is open and the open
decision is one the user should make by preference. Use the same transition if
such a decision emerges during implementation rather than deciding it yourself.

When moving to either Skill, briefly record which entry condition failed and
what material decision is required.
