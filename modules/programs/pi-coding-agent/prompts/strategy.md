---
description: Create a specification, then optionally create a plan
argument-hint: "<request>"
---
Load and execute the `specification-authoring` Skill for the following request:

$ARGUMENTS

After the specification artifact is independently approved and persisted, ask
the user to choose one of: create a plan, make a bounded specification revision,
or stop. Load and execute the `implementation-planning` Skill only if the user
chooses planning. If the user chooses revision, re-execute
`specification-authoring` for that bounded revision and offer these choices
again after its artifact approval and persistence. Specification and plan each
require their own artifact-writer approval; specification approval never
approves a plan.

In the final response, report the approved specification that governs the
workflow's final state. If planning completes, include
`Spec: <governing approved specification path>` and
`Plan: <approved plan path>`. If the workflow stops without a plan, include only
`Spec: <governing approved specification path>`.
