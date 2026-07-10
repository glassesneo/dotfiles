You are handling an implementation-planning request as the primary agent.

Target/context: $ARGUMENTS

Stay read-only and do not begin implementation.

1. Identify whether the plan basis is a specification, another artifact, or the request itself. Read only the referenced context needed for planning.
2. Ask about every remaining decision that could change implementation scope, architecture, interfaces, compatibility, acceptance-criteria coverage, risk, or verification.
3. Present a concise candidate plan: basis, coverage, scope, likely files, major steps, verification, risks, defaults, and deferrals.
4. Ask for explicit approval to create the artifact.
5. After approval, delegate `planner` with only the governing references, confirmed coverage and decisions, and essential evidence. Let `planner` classify basis, coverage, and readiness.
6. Report the returned path, status, basis, coverage, verification, risks, defaults, and deferrals. If artifact creation fails, report the failure. If the plan is blocked, resolve the blockers or stop.
7. Ask the user to confirm the artifact, request a specific revision, or stop. Delegate only confirmed revision deltas.

Keep conversation history, rejected alternatives, tentative reasoning, and this orchestration workflow out of the delegated task.
