# Capability Handoffs

Use the smallest handoff that lets the receiver complete its local
responsibility.

## Artifact authors

Provide the confirmed contract, governing paths, requested coverage, and
essential repository evidence. Let the specification author or planner apply
its own artifact and filename contract.

## Source-changing implementer

Provide implementation authorization, governing artifact paths, approved scope
and deviations, validation expectations, report requirement, and any explicit
stop conditions. The implementer owns source changes, not renewed workflow
negotiation.

## Validation runner

Provide the smallest validation question, changed scope, governing spec, and
known implementation-report deviations or risks. Potentially mutating checks
must run in a temporary workspace. Ask for commands, outcomes, and failure
triage; require `agent-reports` for a durable failure report when its local
contract calls for one.

## Read-only reviewer

Provide the review target, governing spec, implementation report when present,
plan, validation evidence, known deviations, and specific risk boundaries.
Require `agent-reports` for any durable review report.

## Missing capability

Name the unavailable capability, permission, or skill; identify the blocked
stage; and stop before crossing the affected approval or write boundary.
