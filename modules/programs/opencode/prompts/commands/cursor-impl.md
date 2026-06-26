Cursor implementation contract:
- Follow the standard implementation workflow, but Cursor CLI (`cursor-agent`) performs the source-changing implementation.
- You are the orchestration agent for this request. Do not implement the requested source changes yourself unless needed only to prepare or repair the Cursor handoff workflow.
- Load and follow the `implement-via-cursor` skill before invoking `cursor-agent`.
- Apply the shared repository exploration and validation guidance before the handoff when needed to make the Cursor prompt precise.
- When a spec, plan, or implementation report is provided, preserve this priority: `spec > implementation report > plan`.
- Treat implementation-report spec deviations as known deviations for reviewer/tester attention, not as automatic approval to diverge from the spec.
- Require Cursor to write the implementation report under `.agents/reports/` using the `agent-reports` skill (implementation report format). If Cursor cannot produce the report, write an orchestration report explaining why and mark implementation report production as failed.
- After Cursor returns, arrange relevant validation checks when feasible; prefer a `tester` delegation for validation and failure triage, then use the outcome before final reporting.
- After non-trivial implementation and validation, delegate read-only review to `review-orchestrator` before final reporting when feasible.

Implementation report contract for Cursor or fallback orchestration report:

{{IMPLEMENTATION_REPORT_FORMAT_CONTRACT}}

{{REPORT_FILENAME_POLICY}}

Implement via Cursor CLI: $ARGUMENTS
