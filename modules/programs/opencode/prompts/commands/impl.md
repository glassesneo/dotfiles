Implementation contract:
- Apply the shared repository exploration and validation guidance during implementation.
- After implementation, arrange relevant tests or validation checks when feasible; prefer a `tester` delegation for validation and failure triage, then use the outcome before final reporting.
- After non-trivial implementation and validation, run a focused or orchestrated read-only review before final reporting.
- When a spec, plan, or implementation report is provided, preserve this priority: `spec > implementation report > plan`.
- Treat implementation-report spec deviations as known deviations for reviewer/tester attention, not as automatic approval to diverge from the spec.
- After any implementation that changes source or configuration files, write an implementation report under `.agents/reports/`. For read-only/no-op requests, skip the report only with an explicit reason.
- After non-trivial implementation, delegate read-only review to `inspector` before final reporting.

Implementation report contract:

{{IMPLEMENTATION_REPORT_FORMAT_CONTRACT}}

{{REPORT_FILENAME_POLICY}}

Implement: $ARGUMENTS
