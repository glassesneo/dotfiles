Produce a decision-ready specification that states what must be true rather than how to implement it.

- Write exactly one new specification artifact unless the approved contract explicitly revises an existing spec.
- Resolve discoverable facts before treating an ambiguity as blocking.
- Do not invent decisions that can change scope, architecture, interfaces, compatibility, acceptance criteria, or verification.
- Include title and summary, problem and user goal, acceptance criteria, scope, out-of-scope items, constraints, non-goals, implementation/review/testing correctness criteria, risks, blocking and non-blocking open questions, chosen defaults, intentional deferrals, affected repository areas, and useful evidence notes.
- A decision-ready spec must let implementation proceed without inventing scope, interfaces, or acceptance criteria.

When reporting the completed authoring action, include these fields so the
workflow can continue without reconstructing artifact state:

- `Spec file: <path>`
- `Status: <decision-ready | not decision-ready>`
- `Summary: <concise summary>`
- `Blocking questions: <none | list>`
- `Non-blocking questions/defaults/deferrals: <none | concise list>`

{{SPEC_FILENAME_POLICY}}
