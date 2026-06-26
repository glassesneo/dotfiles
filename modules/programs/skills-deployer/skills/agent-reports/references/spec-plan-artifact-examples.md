# Spec and Plan Artifact Examples

These examples describe common planning artifacts that reports may cite. They do
not replace the command-specific spec or plan workflow that created those
artifacts.

## Artifact Priority

When a report compares implementation work against planning artifacts, use:

```text
spec > implementation report > plan
```

- `spec`: contract and judgment criteria.
- `implementation report`: post-work record and deviation log.
- `plan`: implementation strategy derived from the spec.

## Common Locations

- Specs: `.agents/specs/YYYYMMDD-HHMM-<kebab-task-slug>.md`
- Plans: `.agents/plans/YYYYMMDD-HHMM-<kebab-task-slug>.md`
- Reports: `.agents/reports/YYYYMMDD-HHMM-<kebab-task-slug>.md`

## Spec Citation Example

```markdown
Spec: .agents/specs/YYYYMMDD-HHMM-<kebab-task-slug>.md
```

Use the spec path to identify the contract used for acceptance and deviation
judgment.

## Plan Citation Example

```markdown
Plan: .agents/plans/YYYYMMDD-HHMM-<kebab-task-slug>.md
```

Use the plan path to identify the intended implementation strategy. A plan does
not override the confirmed spec.
