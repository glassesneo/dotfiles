# Assumptions

Expose the assumptions that were fixed during implementation or review.

## Common assumptions to check

- This input always exists
- This state can only come from one path
- This API is always called in one order
- This value is validated elsewhere
- This error is already handled upstream
- This data is protected by a DB constraint
- This branch never executes
- This existing component expects the same contract

## Assumption taxonomy

Classify each assumption as one of:

- guaranteed by code
- guaranteed by schema
- guaranteed by DB
- guaranteed by caller
- guaranteed only by convention
- not guaranteed
