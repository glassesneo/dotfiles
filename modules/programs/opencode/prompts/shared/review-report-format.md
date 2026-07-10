`review-report` output format (strict, exact):

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

Include one entry for every selected perspective and every perspective that was replaced, skipped, or scaled down:

- **<perspective name>**: <attempted | replaced | skipped | scaled-down> — <selection/handling rationale>; <concise result or gap>

## Verification Suggestions

- `<command or manual check>` — <why this verifies risk>

## Residual Risks

- <risk or uncertainty, one per line; use `none` if none>

## Out of Scope

- <explicitly unreviewed area, one per line; use `none` if none>

## Recommended Next Step

- <exactly one concrete action>
