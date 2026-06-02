Implement: $ARGUMENTS

Implementation contract:
- Prefer early delegation when it improves correctness, confidence, or risk control; state why if materially useful delegation is skipped.
- Resolve repository context, external uncertainty, validation, and root-cause questions with the appropriate helper when direct execution would be slower or riskier.
- After implementation, run relevant tests or validation checks when feasible; if checks fail, triage or delegate failure investigation before reporting.
- After non-trivial implementation and validation, run a focused or orchestrated read-only review before final reporting.
- When a spec, plan, or implementation report is provided, preserve this priority: `spec > implementation report > plan`.
- Treat implementation-report spec deviations as known deviations for reviewer/tester attention, not as automatic approval to diverge from the spec.
- After any implementation that changes source or configuration files, write an implementation report under `.agents/reports/`. For read-only/no-op requests, skip the report only with an explicit reason.

Implementation report contract:

{{IMPLEMENTATION_REPORT_FORMAT_CONTRACT}}

{{REPORT_FILENAME_POLICY}}
