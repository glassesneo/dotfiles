# Workflow Profiles

## `spec-only`

1. Resolve discoverable facts and decisions that affect scope, acceptance
   criteria, compatibility, constraints, risk, or verification.
2. Present a concise candidate specification.
3. Obtain explicit approval before delegating specification artifact creation.
4. Report the artifact and readiness, then offer confirm, bounded revision, or
   stop. Do not plan or implement.

## `plan-only`

1. Resolve the governing basis and decisions that materially affect the plan.
2. Present a concise candidate plan with coverage, likely files, steps,
   verification, risks, defaults, and deferrals.
3. Obtain explicit approval before delegating plan artifact creation.
4. Report the artifact and readiness, then offer confirm, bounded revision, or
   stop. Do not implement.

## `spec-then-plan`

1. Follow `spec-only` through a decision-ready specification, including its
   separate approval before artifact creation.
2. Ask the user to choose: complete plan, bounded-partial plan, revise the spec,
   or stop.
3. If planning is selected, identify exact coverage and present a candidate
   plan.
4. Obtain a separate explicit approval before delegating complete or
   bounded-partial plan creation.
5. Report the plan and readiness. Never implement under this profile.

## `plan-then-implement`

1. Perform the smallest useful read-only discovery and present a lightweight
   candidate plan, including scope, non-goals, likely files, steps,
   verification, risks, assumptions, and deferrals.
2. One explicit approval authorizes creation of that agreed plan artifact and
   implementation within it.
3. Delegate plan creation. If the resulting plan materially differs from the
   approved candidate, stop before implementation and reconfirm with the user.
4. Delegate implementation with the approved plan and governing context.
5. After changes, delegate focused validation when feasible and read-only
   review for non-trivial work.
6. If source or configuration changed, create exactly one implementation report
   through the `agent-reports` skill. For a read-only or no-op result, skip the
   report and state why.

## `implement`

Invocation authorizes implementation start. Resolve governing context and
delegate to the source-changing implementer without another approval. Ask the
user only when scope, compatibility, or destructive impact is materially
ambiguous.

After changes, delegate focused validation when feasible and read-only review
for non-trivial work. If source or configuration changed, create exactly one
implementation report through `agent-reports`; otherwise skip it and state why.
