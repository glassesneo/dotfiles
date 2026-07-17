---
name: agent-artifact
disable-model-invocation: true
description: >-
  Use when creating durable agent artifacts: specifications, implementation
  plans, research notes, implementation reports, review reports, bug reports,
  or failure reports. Trigger when an agentic workflow needs a persisted
  contract, reusable evidence, or handoff record. Do not use for inline review
  comments, commit messages, transient scratch notes, or ordinary status
  updates that do not need a durable Markdown artifact.
---

# Agent Artifact

Create durable artifacts with an explicit type, stable location, and
collision-safe filename. This skill owns artifact formats and location policy;
the storage tool only performs validated writes.

## Artifact Types

Choose exactly one kind:

- `spec` → `.agents/specs/`: a decision-ready behavior contract and acceptance
  criteria.
- `plan` → `.agents/plans/`: implementation-ready scope, ordered work,
  verification, risks, and task breakdown.
- `research` → `.agents/research/`: reusable investigation evidence,
  alternatives, sources, and conclusions.
- `implementation-report` → `.agents/implementation-reports/`: post-change
  record of modifications, validation, deviations, and remaining risk.
- `review-report` → `.agents/review-reports/`: evidence-grounded findings and a
  review verdict for a defined target.
- `bug-report` → `.agents/bug-reports/`: reproduced or investigated defect,
  impact, evidence, likely cause, and repair handoff.
- `failure-report` → `.agents/failure-reports/`: non-trivial validation failure,
  reproduction evidence, triage, and one recommended next step.

For a report kind, read its matching format before authoring content:

- `references/implementation-report-format.md`
- `references/review-report-format.md`
- `references/bug-report-format.md`
- `references/failure-report-format.md`

For the artifact hierarchy and concise spec, plan, and research examples, read
`references/spec-plan-artifact-examples.md`.

## Location

When `save_agent_artifact` is available, always use it instead of writing the
artifact file directly. Pass the selected `kind`, complete Markdown `content`,
and a non-empty lowercase kebab-case `slug`.

When the tool is unavailable in the current runtime, create only the
project-local artifact directly under the kind directory above, applying the
same filename and no-overwrite rules.

The canonical filename is:

`YYYYMMDD-HHMMSS-<kebab-slug>.md`

Rules:

- Generate the timestamp in JST.
- The slug must match `^[a-z0-9]+(-[a-z0-9]+)*$` and must not be empty.
- Never overwrite an existing artifact.
- On collision, try `-v2`, `-v3`, and so on through `-v99` before failing.

## Priority When Inputs Conflict

For implementation and review reports, use:

```text
spec > implementation report > plan
```

- The confirmed spec is the contract.
- The implementation report is the post-work record and deviation log.
- The plan is implementation strategy, not a substitute for the spec.

For review reports, compare the target against the spec, plan, and existing
implementation report when those artifacts exist.

## Required Report Qualities

These requirements apply to the four report kinds only:

- Use the selected reference template's headings and constrained fields.
- Put the decision summary near the top.
- Record validation commands actually run and their outcomes.
- If validation was not run, state why.
- Do not imply skipped or failed checks passed.
- Document unresolved risks and open items explicitly.
- For implementation reports, classify each known spec deviation as
  `no_action`, `follow_up`, `spec_update_required`, or `blocking`.

## Completion Checklist

Before returning an artifact path, confirm:

1. The selected kind and directory match the artifact's purpose.
2. The storage tool was used when available; otherwise only the project-local
   direct fallback was created.
3. The slug, JST timestamp, collision suffix, and no-overwrite rules hold.
4. The content follows the matching format or example guidance.
5. Reports cite material spec, plan, implementation, validation, and review
   context and expose remaining uncertainty.
