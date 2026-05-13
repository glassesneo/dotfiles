`test-spec` output format (strict, exact):

# Test Spec: <title>

## Summary

- **Target**: <module or function under test>
- **Type**: new | modification | both
- **Behavior**: <one-line description of behavior being tested>
- **Framework**: <test framework and relevant utilities>
- **Run command**: `<exact command to run these tests>`

## Existing Test Context

<!-- omit section entirely if Type is "new" -->

- **File**: <path to existing test file>
- **What changes**: <one-line: what about existing tests needs to change and why>

## Test Matrix

| ID | Category | Input / Condition | Expected Outcome |
|----|----------|-------------------|------------------|
| 1  | happy    | ...               | ...              |
| 2  | edge     | ...               | ...              |
| 3  | error    | ...               | ...              |

## Setup

- **Fixtures**: <list with one-line description each>
- **Mocks**: <what to mock and why, one-line each>
- **Environment**: <env vars, config, or preconditions>

## Constraints

- <hard constraint, one per line>

## Pass/Fail Criteria

- <criterion, one per line>
