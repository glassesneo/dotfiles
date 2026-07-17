# Failure Report Format

Use this template for non-trivial validation or test failures. Keep each failing
test or check in its own `## Failures` subsection.

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
