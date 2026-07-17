---
description: Create a specification, then optionally create a plan
argument-hint: "<request>"
---
Load and execute the `specification-authoring` Skill for the following request:

$ARGUMENTS

After the specification is approved and persisted, ask the user to choose one
of: create a plan, make a bounded specification revision, or stop. Load and
execute the `implementation-planning` Skill only if the user chooses planning.
If the user chooses revision, re-execute `specification-authoring` for that
bounded revision and offer these choices again after its approval and
persistence. Keep the two Skills' candidate approvals separate and require
each approval before its artifact is persisted.
