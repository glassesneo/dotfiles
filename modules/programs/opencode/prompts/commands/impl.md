Implement the supplied target. When governing artifacts are present, use this priority: `spec > implementation report > plan`. A recorded deviation is review input, not permission to violate the specification.

## Workflow

1. Inspect the target and governing artifacts, then implement within their scope.
2. Arrange relevant validation after changes; use `tester` for focused checks and failure triage when feasible.
3. For non-trivial changes, delegate a read-only review to `review-orchestrator` after validation and address or report its findings.
4. If source or configuration changed, write exactly one implementation report under `.agents/reports/` using the contracts below. For a read-only or no-op result, do not create the report and state why it was skipped.
5. Return a concise outcome with changed files, validation, review result, report path when created, and residual risks.

## Implementation report contract

{{IMPLEMENTATION_REPORT_FORMAT_CONTRACT}}

{{REPORT_FILENAME_POLICY}}

Implement: $ARGUMENTS
