# Workflow Profiles

## `design-only`

1. Select the design style: `specification-design` when the user already holds
   the intended behavior, `ideation-design` when the direction is open and the
   user wants to choose the elements. Let the user correct the selection.
2. Run the design dialogue through the mapped design author. That skill owns
   the dialogue contract; do not replace it with a requirements interview.
3. Settle the scale contract with the user before the artifact is assembled.
4. Obtain one explicit approval when the design artifact is created. The
   companion decision record needs no separate approval.
5. Report the artifact and readiness, then offer confirm, bounded revision, or
   stop. Do not implement.

## `design-then-implement`

1. Follow `design-only` through the approved design artifact.
2. That same approval authorizes implementation within the approved design and
   its scale contract. Do not ask for a second approval of the same content.
3. Run implementation through the mapped source-changing implementer with the
   approved design and governing context.
4. After changes, delegate focused validation when feasible and read-only
   review for non-trivial work.
5. Create exactly one implementation report through the `agent-artifact` skill
   if source or configuration changed. For a read-only or no-op result, skip
   the report and state why.

## `implement`

Invocation authorizes implementation start. Resolve governing context and run
the source-changing implementer capability without another approval. Ask the
user only when scope, compatibility, or destructive impact is materially
ambiguous.

After changes, delegate focused validation when feasible and read-only review
for non-trivial work. If source or configuration changed, create exactly one
implementation report through `agent-artifact`; otherwise skip it and state why.

## Scale Check Before Implementation

Whenever a profile reaches implementation, the implementer estimates the work
independently before changing anything and compares that estimate with the
design's scale contract.

Proceed when they agree. When the estimate materially exceeds the contract,
stop and report instead of building the larger version: the divergence means
either the task was misread or the design's scope is incomplete. A revised
estimate that the user accepts is a direction change, so record it in the
decision record.
