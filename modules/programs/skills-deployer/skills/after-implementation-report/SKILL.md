---
name: after-implementation-report
description: Use after source-changing implementation to write a structured implementation report under .agents/reports/ matching the shared implementation report contract.
---

# After Implementation Report

Use this skill after any implementation that changes source or configuration files.

## When to Apply

- After completing implementation work requested via spec and plan.
- Before declaring the task finished.
- Skip only for read-only or no-op requests, with an explicit reason stated to the user.

## Artifact Priority

Preserve this priority when assessing alignment:

```text
spec > implementation report > plan
```

- The confirmed spec is the contract.
- This report is the post-work record and deviation log.
- The plan is implementation strategy, not a substitute for the spec.

## Report Location

Create a NEW timestamped file:

`.agents/reports/YYYYMMDD-HHMM-<kebab-task-slug>.md`

Rules:

- `<kebab-task-slug>` is required and must be non-empty.
- Use only lowercase letters, digits, and hyphens in the slug.
- Do not create missing-slug names such as `YYYYMMDD-HHMM-.md`.
- Never overwrite existing files.
- If collision occurs, append `-v2`, `-v3`, etc.

## Required Format

Write the report using this strict structure:

```markdown
# Implementation Report: <title>

Spec: <path-to-spec>
Plan: <path-to-plan>

## Summary

- <concise outcome summary>

## Changed Files

- <path>: <what changed>

## Spec Alignment

- <how the implementation satisfies the referenced spec, or `not assessed` with reason>

## What Was Implemented

- <actual changes made>

## Plan Deviations

- <deviation from plan, or `none`>

## Spec Deviations

- <classification: no_action | follow_up | spec_update_required | blocking>
- <deviation from spec, or `none`>

## Reason for Deviations

- <reason, or `not applicable`>

## Validation Results

- <commands/checks run and outcomes, or `not run` with reason>

## Unresolved Items

- <open issue, or `none`>

## Reviewer Notes

- <specific attention points for reviewer/tester, or `none`>

## Known Risks

- <risk, validation gap, or `none known`>

## Follow-up Required

- <required follow-up, or `none`>
```

## Deviation Policy

Known spec deviations are not automatically justified. Classify each spec deviation explicitly. Reviewers decide whether a deviation is approvable, requires a spec update, requires follow-up, or blocks completion.

## Validation

Record validation commands actually run and their outcomes. If validation was not run, state why. Prefer checks named in the plan or spec when feasible.
