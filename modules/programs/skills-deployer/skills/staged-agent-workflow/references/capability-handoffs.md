# Capability Handoffs

Use the smallest handoff that lets the receiver complete its local
responsibility.

## Design author

Provide the user's request, the governing paths, and essential repository
evidence. Do not pre-decide the content of the design: the design author owns
the dialogue with the user and its own artifact and filename contract. When the
active primary provides the capability, use that input directly and do not
create a self-handoff.

## Source-changing implementer

Provide implementation authorization, the approved design path, approved scope
and deviations, the scale contract, validation expectations, report
requirement, and any explicit stop conditions. The implementer owns source
changes, not renewed workflow negotiation. When the active primary is the
implementer, proceed directly with that bounded context rather than delegating
to itself.

## Validation runner

Provide the smallest validation question, changed scope, governing design, and
known implementation-report deviations or risks. Potentially mutating checks
must run in a temporary workspace. Ask for commands, outcomes, and failure
triage; require `agent-artifact` for a durable failure report when its local
contract calls for one.

## Read-only reviewer

Provide the review target, governing design, implementation report when
present, validation evidence, known deviations, and specific risk boundaries.
Require `agent-artifact` for any durable review report.

## Missing capability

Name the unavailable capability, permission, or skill; identify the blocked
stage; and stop before crossing the affected approval or write boundary.
