# Implementation Report Format

Use this template after source or configuration changes. Preserve the headings
and include `none`, `not applicable`, or `not run` where a section has no data.

```markdown
# Implementation Report: <title>

Design: <path-to-design>

## Summary

- <concise outcome summary>

## Changed Files

- <path>: <what changed>

## Design Alignment

- <how the implementation satisfies the referenced design, or `not assessed` with reason>

## What Was Implemented

- <actual changes made>

## Scale Contract Adherence

- <observed footprint against the design's scale contract, or `not assessed` with reason>

## Design Deviations

- <classification: no_action | follow_up | design_update_required | blocking>
- <deviation from design, or `none`>

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
