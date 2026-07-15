Produce an implementation-ready plan from the governing spec, artifact, or approved request.

- Write exactly one new plan artifact.
- Classify its basis as `spec-derived`, `artifact-derived`, or `request-derived`.
- For a spec-derived plan, include `Spec: <path>` and classify coverage as `complete-spec` or `partial-spec`; otherwise use `Coverage: not-applicable`.
- For partial coverage, identify the selected slice, covered acceptance criteria, and work intentionally left for later plans.
- Use `Status: implementation-ready` only when implementation can proceed without inventing scope, architecture, interfaces, acceptance criteria, or verification; otherwise use `Status: blocked` and record the blocker.
- Include title and summary, status, basis, coverage, implementation scope, ordered steps, known or candidate paths, risks and mitigations, verification, open questions/defaults/deferrals, and the required task breakdown.
- Treat a governing spec as higher priority than other planning input and record, rather than silently justify, any deviation.

When reporting the completed authoring action, include these fields so the
workflow can continue without reconstructing artifact state:

- `Plan file: <path>`
- `Status: <implementation-ready | blocked>`
- `Basis: <spec-derived | artifact-derived | request-derived>`
- `Coverage: <complete-spec | partial-spec | not-applicable>`
- `Summary: <concise summary>`
- `Verification: <concise verification approach>`
- `Risks/defaults/deferrals: <none | concise list>`

{{DIVIDABLE_TASK_STRUCTURE}}

{{PLAN_FILENAME_POLICY}}
