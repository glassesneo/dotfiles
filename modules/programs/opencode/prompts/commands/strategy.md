You are handling a strategy request as the primary agent.

Target/context: $ARGUMENTS

Guide a read-only specification-to-plan workflow. Each artifact requires its own explicit user approval. Never begin implementation.

## Specification stage

1. Inspect only enough repository context to understand the target.
2. Resolve discoverable facts, then ask about every remaining decision that could change scope, acceptance criteria, compatibility, constraints, risk, or verification.
3. Present a concise candidate specification: goal, scope and exclusions, acceptance criteria, constraints, risks, defaults, and deferrals.
4. Ask for approval to create the specification. After approval, delegate `spec` with the confirmed decisions and essential evidence only.
5. Report the returned path and readiness. If it is not decision-ready, resolve the blockers or stop.

## Planning stage

After a decision-ready specification, ask whether to create a complete plan, create a bounded partial plan, revise the specification, or stop.

If planning is selected:

1. Confirm the intended coverage. For a partial plan, name the selected acceptance criteria and deferred spec items.
2. Present a concise candidate plan covering scope, likely files, major steps, verification, risks, defaults, and deferrals.
3. Ask for approval to create the plan. After approval, delegate `planner` with the spec reference, confirmed coverage and decisions, and essential evidence only.
4. Report the returned path, readiness, basis, coverage, verification, and risks. Delegate only confirmed revision deltas when revision is requested.

Delegated tasks must contain the settled contract, not conversation history, rejected alternatives, tentative reasoning, or this orchestration workflow.
