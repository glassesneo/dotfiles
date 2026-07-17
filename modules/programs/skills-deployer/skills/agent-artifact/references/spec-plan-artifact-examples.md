# Agent Artifact Examples

These concise examples show the common hierarchy and minimum useful shape of
non-report artifacts. They do not replace a workflow-specific output contract.

## Artifact Priority

When a report compares implementation work against planning artifacts, use:

```text
spec > implementation report > plan
```

- `spec`: contract and judgment criteria.
- `implementation report`: post-work record and deviation log.
- `plan`: implementation strategy derived from the spec.

## Common Locations

- Specs: `.agents/specs/YYYYMMDD-HHMMSS-<kebab-slug>.md`
- Plans: `.agents/plans/YYYYMMDD-HHMMSS-<kebab-slug>.md`
- Research: `.agents/research/YYYYMMDD-HHMMSS-<kebab-slug>.md`
- Implementation reports:
  `.agents/implementation-reports/YYYYMMDD-HHMMSS-<kebab-slug>.md`
- Review reports: `.agents/review-reports/YYYYMMDD-HHMMSS-<kebab-slug>.md`
- Bug reports: `.agents/bug-reports/YYYYMMDD-HHMMSS-<kebab-slug>.md`
- Failure reports: `.agents/failure-reports/YYYYMMDD-HHMMSS-<kebab-slug>.md`

## Spec Citation Example

```markdown
Spec: .agents/specs/YYYYMMDD-HHMMSS-<kebab-slug>.md
```

Use the spec path to identify the contract used for acceptance and deviation
judgment.

## Plan Citation Example

```markdown
Plan: .agents/plans/YYYYMMDD-HHMMSS-<kebab-slug>.md
```

Use the plan path to identify the intended implementation strategy. A plan does
not override the confirmed spec.

## Research Example

```markdown
# Topic

## Question

State the bounded question and why it matters.

## Evidence

Record sources, observations, and material uncertainty.

## Conclusion

State the supported conclusion, rejected alternatives, and recommended use.
```

## Report Examples

Use the kind-specific report references rather than inventing report headings:

- `implementation-report` → `implementation-report-format.md`
- `review-report` → `review-report-format.md`
- `bug-report` → `bug-report-format.md`
- `failure-report` → `failure-report-format.md`
