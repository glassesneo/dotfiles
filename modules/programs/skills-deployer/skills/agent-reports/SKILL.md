---
name: agent-reports
description: >-
  Use when writing or updating durable handoff reports under .agents/reports/
  for agentic workflows. Trigger when the user asks for an implementation
  report, review report, bug report, or failure/triage report, or when a task
  needs a post-work record of what changed, what evidence exists, and what
  remains unresolved. Do not use for spec or plan authoring, for inline PR
  review comments, for commit messages, or for ordinary status updates that do
  not need a persisted report file.
---

# Agent Reports

Use this skill to create durable handoff reports under `.agents/reports/`.
The report must tell the next agent or reviewer what happened, what evidence
exists, and what remains unresolved.

## Report Types

Choose exactly one report type for the current handoff:

- **Implementation report**: source/configuration work was performed and the
  result needs a post-work record.
- **Review report**: a diff, PR, commit, directory, or other target was
  inspected for findings.
- **Bug report**: a defect was reproduced or investigated and needs a concise
  repair handoff.
- **Failure report**: validation or tests produced non-trivial failures that
  need triage evidence.

Read the matching reference template before writing the report:

- `references/implementation-report-format.md`
- `references/review-report-format.md`
- `references/bug-report-format.md`
- `references/failure-report-format.md`

For surrounding artifact hierarchy and generic filename examples, use
`references/spec-plan-artifact-examples.md`.

## Priority When Inputs Conflict

Use this priority when assessing alignment for implementation reports:

```text
spec > implementation report > plan
```

- The confirmed spec is the contract.
- The implementation report is the post-work record and deviation log.
- The plan is implementation strategy, not a substitute for the spec.

For review reports, compare the review target against the spec, plan, and any
existing implementation report when those artifacts exist.

## Report Location

Create a NEW timestamped file:

`.agents/reports/YYYYMMDD-HHMM-<kebab-task-slug>.md`

Rules:

- `<kebab-task-slug>` is required and must be non-empty.
- Use only lowercase letters, digits, and hyphens in the slug.
- Do not create missing-slug names such as `YYYYMMDD-HHMM-.md`.
- Never overwrite existing files.
- If collision occurs, append `-v2`, `-v3`, etc.

## Required Report Qualities

- Use the selected reference template's headings and constrained fields.
- Put the decision summary near the top.
- Record validation commands actually run and their outcomes.
- If validation was not run, state why.
- Do not imply skipped or failed checks passed.
- Document unresolved risks and open items explicitly.
- Known spec deviations are not automatically justified. Classify each spec
  deviation as `no_action`, `follow_up`, `spec_update_required`, or `blocking`.

## Completion Checklist

Before returning the report path, confirm:

1. The file is under `.agents/reports/` and uses the timestamped filename rule.
2. The report type matches the handoff need.
3. Required sections from the matching reference are present.
4. Spec, plan, implementation report, and validation context are cited when
   they materially affect judgment.
5. Remaining uncertainty is explicit rather than hidden in prose.
