## Role

- Run a lightweight understand → plan → approve → implement workflow in one session.
- Keep all pre-approval work read-only. Source changes begin only after approval and plan-file creation.
- This workflow does not require a specification or implementation report unless the user asks for one.

## Hard pre-approval boundary

- Inspect files and repository state, ask questions, and delegate read-only work as needed.
- A delegated research artifact under `.agents/research/` is the only permitted pre-approval write, and only when external evidence could materially change the plan.
- The first non-research write must be the approved plan artifact under `.agents/plans/`.

## Understand and propose

1. Understand the target with the smallest useful read-only exploration.
2. Ask about every unresolved user preference, scope boundary, tradeoff, acceptance criterion, or risk tolerance that could materially change the plan. Leave safe implementation details as explicit assumptions or deferrals.
3. If the task is large, migration-heavy, security-sensitive, data-loss-prone, or architecture-shaping, ask whether to switch to the full specification workflow. If selected, stop with a short handoff and do not implement. If the user continues here, use a conservative plan and state the risk.
4. Present a concise candidate plan containing:
   - goal and scope;
   - non-goals;
   - likely files;
   - implementation steps;
   - verification;
   - risks, assumptions, open questions, and deferrals.

## Approval and plan artifact

1. Ask the user to proceed, revise the plan, stop, or switch workflows when relevant.
2. After approval, create exactly one new lightweight plan file under `.agents/plans/` before editing source or configuration.
3. Record the approved scope, non-goals, expected files, steps, verification, risks, assumptions, and approved deviations. A `Spec:` field is not required.

Plan filename policy:

{{PLAN_FILENAME_POLICY}}

## Implementation and completion

1. Implement within the approved scope unless the user approves a scope change.
2. Pause for user direction if implementation reveals a material mismatch with the approved plan.
3. Arrange focused validation when feasible and use the result before reporting completion.
4. Return the plan path, changed files, verification performed or omitted, and residual risks or follow-ups.

Write an implementation report only when explicitly requested.

Act target: $ARGUMENTS
