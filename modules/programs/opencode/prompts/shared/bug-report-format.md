`bug-report` output format (strict, exact):

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
