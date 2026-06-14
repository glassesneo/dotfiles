---
name: agent-reports
description: Use when writing .agents/reports/ implementation, review, bug, or failure reports for agentic workflows.
---

# Agent Reports

## Artifact Priority

Preserve this priority when assessing alignment for implementation reports:

```text
spec > implementation report > plan
```

- The confirmed spec is the contract.
- The implementation report is the post-work record and deviation log.
- The plan is implementation strategy, not a substitute for the spec.

For review reports, compare the review target against the spec, plan, and any existing implementation report when those artifacts exist.

## Report Location

Create a NEW timestamped file:

`.agents/reports/YYYYMMDD-HHMM-<kebab-task-slug>.md`

Rules:

- `<kebab-task-slug>` is required and must be non-empty.
- Use only lowercase letters, digits, and hyphens in the slug.
- Do not create missing-slug names such as `YYYYMMDD-HHMM-.md`.
- Never overwrite existing files.
- If collision occurs, append `-v2`, `-v3`, etc.

## Validation and Honesty

Record validation commands actually run and their outcomes. If validation was not run, state why. Do not imply checks passed when they were skipped or failed. Document unresolved risks and open items explicitly.

Known spec deviations are not automatically justified. Classify each spec deviation explicitly. Reviewers decide whether a deviation is approvable, requires a spec update, requires follow-up, or blocks completion.

## Implementation Report Format

`implementation-report` output format (strict, minimum):

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

## Review Report Format

`review-report` output format (strict, exact):

```markdown
# Review Report: <title>

## Summary

- **Target**: <path, directory, PR, commit, commit range, patch, or diff reviewed>
- **Target type**: path | directory | PR | commit | commit-range | patch | diff | other
- **Overall verdict**: blocking-findings | non-blocking-findings | no-findings | inconclusive
- **Highest severity**: critical | high | medium | low | none
- **Finding counts**: critical <N>, high <N>, medium <N>, low <N>
- **Target context used**: <PR body, linked issue, commit message, plan, user rationale, or none>
- **External research used**: yes | no

## Findings

### Critical

#### <finding title>

- **Impact**: <one-line user/system impact>
- **Evidence**: <file:line or concrete observed evidence>
- **Diff provenance**: <how the target diff introduced/exposed/worsened this, or non-diff target scope reason>
- **Why it matters**: <one concise explanation>
- **Suggested fix direction**: <one concrete direction>

### High

#### <finding title>

- **Impact**: <one-line user/system impact>
- **Evidence**: <file:line or concrete observed evidence>
- **Diff provenance**: <how the target diff introduced/exposed/worsened this, or non-diff target scope reason>
- **Why it matters**: <one concise explanation>
- **Suggested fix direction**: <one concrete direction>

### Medium

#### <finding title>

- **Impact**: <one-line user/system impact>
- **Evidence**: <file:line or concrete observed evidence>
- **Diff provenance**: <how the target diff introduced/exposed/worsened this, or non-diff target scope reason>
- **Why it matters**: <one concise explanation>
- **Suggested fix direction**: <one concrete direction>

### Low

#### <finding title>

- **Impact**: <one-line user/system impact>
- **Evidence**: <file:line or concrete observed evidence>
- **Diff provenance**: <how the target diff introduced/exposed/worsened this, or non-diff target scope reason>
- **Why it matters**: <one concise explanation>
- **Suggested fix direction**: <one concrete direction>

## Perspective Results

- **Correctness/regression**: <attempted | skipped> — <concise result or skip reason>
- **Security/privacy/secrets**: <attempted | skipped> — <concise result or skip reason>
- **Maintainability/simplicity**: <attempted | skipped> — <concise result or skip reason>
- **Architecture/ownership**: <attempted | skipped> — <concise result or skip reason>
- **Tests/validation**: <attempted | skipped> — <concise result or skip reason>
- **Domain-specific**: <attempted | skipped> — <concise result or skip reason>

## Verification Suggestions

- `<command or manual check>` — <why this verifies risk>

## Residual Risks

- <risk or uncertainty, one per line; use `none` if none>

## Out of Scope

- <explicitly unreviewed area, one per line; use `none` if none>

## Recommended Next Step

- <exactly one concrete action>
```

## Bug Report Format

`bug-report` output format (strict, exact):

```markdown
# Bug Report: <title>

## Summary

- **Symptom**: <one-line observed behavior>
- **Expected**: <one-line expected behavior>
- **Root cause**: <one-line hypothesis with confidence: confirmed | probable | uncertain>
- **Fix direction**: <one-line recommended approach>
- **Affected files**: <comma-separated paths>

## Reproduction

1. <step>
2. <step>

- **Minimal command**: `<single command that triggers the bug>`

## Root Cause Analysis

- **Entry point**: <file:line where the fault originates>
- **Mechanism**: <2-3 sentences max: what goes wrong and why>
- **Impact radius**: <what else could break - list affected callers/dependents>

## Fix Specification

- **Target files**: <path - one per line>
- **What to change**: <one-line per file: specific change needed>
- **What NOT to change**: <guard rails - one per line>
- **Regression check**: `<command to verify fix>`

## Unknowns

- <anything unverified, one per line - empty section if none>
```

## Failure Report Format

`failure-report` output format (strict, exact):

```markdown
# Failure Report: <title>

## Summary

- **Scope**: <what was run - command and test scope>
- **Result**: <X passed, Y failed, Z skipped>
- **Classification**: regression | flaky | test-bug | env-issue | unknown
- **Likely owner**: implementation | test-code | infrastructure

## Failures

### <test identifier>

- **Error**: <one-line error message or assertion failure>
- **Stack**: <file:line of innermost relevant frame>
- **Repro**: `<minimal command to reproduce this single failure>`
- **Flaky check**: deterministic | flaky (<N/M passes on re-run>)

### <test identifier>

...

## Evidence

- **Commands run**: <numbered list of commands and their exit codes>
- **Environment**: <OS, runtime version, relevant config>

## Recommended Next Step

- <one specific action, e.g. "fix assertion in X" or "investigate regression in Y">
```
