Specification workflow contract:

* Produce planning artifacts under `.agents/`.
* Write specs under `.agents/specs/`.
* Write final plans under `.agents/plans/`.
* Confirm the spec with the user before writing the final plan.
* After the final plan exists, ask whether to skip or run final plan review.
* Delegate final plan review to `plan_reviewer` only when review is not skipped.
* After the review gate, stop with planning-complete output; do not delegate implementation.
* Do not fall back to chat-only specs or plans.

Artifact priority:

```text
spec > implementation report > plan
```

* `spec`: contract and judgment criteria.
* `plan`: implementation strategy derived from the spec.
* `implementation report`: post-work record and deviation log.

Known spec deviations are not automatically justified. Reviewers must decide whether each deviation is approvable, requires a spec update, requires follow-up, or blocks completion.

Definitions:

* `blocking ambiguity`: an unresolved decision that can change scope, architecture, public interfaces, compatibility, acceptance criteria, or verification.
* `planning-critical knowledge gap`: an unresolved repository or external fact that can change scope, architecture, migration, risk, or verification.
* `decision-ready spec`: a spec that lets implementation proceed without inventing scope, interfaces, or acceptance criteria.
* `intentional deferral`: an implementation-level decision that can safely be resolved later without changing the spec contract.

Question and delegation policy:

* Use `question` whenever user input is needed before finalizing an artifact.
* Questions may happen at any point before the relevant file is complete.
* Prefer batching related questions. When practical, ask three or more at once.
* Ask immediately when one blocking question prevents useful progress.
* Resolve discoverable facts through read-only exploration before asking.
* Use conservative defaults only when safe, reversible, and explicitly recorded.
* Delegate repository discovery to `explore` when coverage or confidence improves.
* Delegate external knowledge gaps to `researcher` whenever they are planning-critical.
* Research may happen any time and more than once.
* Group related research questions into one focused delegation when practical.
* Delegate to `challenger` when assumptions, framing, constraints, or solution direction need calibrated critique.
* Preserve conclusions, caveats, confidence limits, and unresolved gaps from helper outputs.

Spec Planning Workflow:

Phase 1: Understand the target
Identify:

* user intent
* problem statement
* success criteria
* scope boundaries
* constraints
* tradeoffs
* affected repository areas
* blocking ambiguities
* planning-critical knowledge gaps

Use `question`, `explore`, `researcher`, or `challenger` as needed before artifact writing.

Phase 2: Build the spec baseline
Create a contract-level baseline covering:

* problem and user goal
* acceptance criteria
* scope and out-of-scope items
* constraints
* non-goals
* correctness criteria for implementation, review, and testing
* risks
* blocking open questions
* non-blocking open questions
* chosen defaults
* intentional deferrals

Rules:

* Do not write the spec while blocking ambiguities remain.
* Do not treat safe implementation details as blocking.
* The spec states what must be true, not how to implement it.

Phase 3: Write the spec

1. Create a new spec report under `.agents/specs/` using the filename policy.
2. Include the baseline from Phase 2.
3. Separate blocking questions, non-blocking questions, defaults, and deferrals.
4. Return the spec path and a short summary.

{{SPEC_FILENAME_POLICY}}

Phase 3.5: Confirm the spec

1. Ask the user to confirm the spec with `question`.
2. Include the spec path.
3. If revisions are needed, create a revised timestamped spec unless the user requests in-place correction.
4. Do not write the final plan until the user explicitly confirms the spec.

Phase 4: Write the final plan

1. Read the confirmed spec.
2. Create a final plan under `.agents/plans/` using the filename policy.
3. Include `Spec: <path-to-confirmed-spec>` near the top.
4. Reference the spec instead of duplicating it.
5. Mark uncertain file paths as candidates.

Required content:

* title and summary
* `Spec: <path>`
* implementation scope
* step-by-step plan
* known or candidate file paths
* risks and mitigations
* verification plan
* open questions, defaults, and deferrals relevant to implementation
* task breakdown:
  {{DIVIDABLE_TASK_STRUCTURE}}

Final plan filename policy:

{{PLAN_FILENAME_POLICY}}

Phase 5: Review gate
After writing the final plan, ask the user to choose one:

* Skip final plan review.
* Run final plan review.

If skipped, do not call `plan_reviewer`.

If review is requested:

1. Call `plan_reviewer` once.
2. Provide the final plan path and confirmed spec path/content.
3. Ask it to review feasibility, ordering, prerequisites, spec contradictions, and verification viability.
4. `plan_reviewer` reviews only final `.agents/plans/*.md` targets.
5. If high or medium findings appear, revise the same plan and run one additional review pass.
6. Apply accepted findings as explicit plan revisions or defaults.

Phase 6: Planning complete
After the review gate, respond with planning-complete output only.

Include:

* Spec file: <path>
* Plan file: <path>
* Review gate: <skipped | completed with no high/medium findings | completed with revisions applied>
* Implementation: not started

Do not ask whether to proceed to implementation. Do not delegate implementation from `/spec`.

Failure handling:

* Retry artifact writing once only when the failure appears recoverable.
* If spec, plan, review, or re-review fails, report the attempted path or target and exact error.
* Do not replace failed artifact creation with chat-only artifacts.

Input report consumption:
Use only when `test-spec`, `failure-report`, or `bug-report` files are provided.

* Read `## Summary` first.
* Read details only when needed for planning or delegation.
* Do not let input reports override the confirmed spec without user approval.

Spec target: $ARGUMENTS
