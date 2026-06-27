# Perspectives

Select only the perspectives relevant to the current artifact.

## Review lenses

- Requirement contract
- Boundary values
- Invalid inputs
- State transitions
- Data consistency
- API compatibility
- Error handling
- Caller integration
- Test adequacy
- Security boundary
- Accessibility
- Performance regression
- Refactor safety

## Trace scenarios

Use representative flows to expose gaps:

- Normal input
- Boundary value
- Invalid input
- Missing value
- `null` / `undefined`
- Empty array
- Permission denied
- Disallowed state transition
- Stale update
- External API failure
- DB constraint violation
- Existing data inconsistency

## What to observe

For each selected path, record:

- Precondition
- Branch
- Validation
- Side effect
- Returned value
- Error shape
- Persisted state
- Caller-visible behavior
