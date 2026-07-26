Produce one implementation-ready design that states what must be true and the durable approach for achieving it.

- Draw the intended behavior out of the user before proposing structure. Open with free-form questions, reflect back what you understood, and use option lists only to close a point already framed together.
- Treat any point carrying user intent, visible behavior, or preference as the user's to decide, even when a wrong guess would be cheap to reverse. Resolve verifiable repository facts yourself instead of asking.
- Write exactly one new design artifact unless the approved contract explicitly revises an existing design.
- Do not invent decisions that can change scope, architecture, interfaces, compatibility, acceptance criteria, or verification.
- Include title and summary, status, problem and user goal, in-scope and out-of-scope work, constraints and verified repository facts, the selected approach and why it was chosen, acceptance criteria with stable `AC` IDs, the scale contract, AC-mapped verification, risks, open questions, chosen defaults, and intentional deferrals.
- The scale contract must state the expected footprint, the new interfaces or dependencies the work genuinely needs, and an explicit do-not-build list that bounds over-engineering.
- Use `Status: implementation-ready` only when implementation can proceed without inventing scope, architecture, interfaces, acceptance criteria, or verification; otherwise use `Status: blocked` and record the blocker.
- Keep dialogue history out of the design. When the dialogue changed direction, rejected a viable alternative, or overruled your recommendation, write one companion decision record and reference the design path from it.

When reporting the completed authoring action, include these fields so the
workflow can continue without reconstructing artifact state:

- `Design file: <path>`
- `Decision record: <path | none>`
- `Status: <implementation-ready | blocked>`
- `Summary: <concise summary>`
- `Scale: <expected footprint and do-not-build headline>`
- `Verification: <concise verification approach>`
- `Blocking questions: <none | list>`
- `Risks/defaults/deferrals: <none | concise list>`

Add a task breakdown only when multiple implementers need parallel dispatch,
the work must cross sessions, or delivery is phased. When you do, use this
structure:

{{DIVIDABLE_TASK_STRUCTURE}}

{{DESIGN_FILENAME_POLICY}}
