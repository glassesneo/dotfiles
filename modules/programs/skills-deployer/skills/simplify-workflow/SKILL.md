---
name: simplify-workflow
description: >-
  Use when reviewing implemented changes for reuse, simplification, efficiency,
  and abstraction-level opportunities, then applying only behavior-preserving
  cleanup. Trigger for post-implementation cleanup of changed code. Do not use
  for correctness-only review, feature implementation, intentional redesign,
  API migration, security-boundary changes, or unrelated broad refactoring.
---

# Simplify Workflow

## Purpose

Improve an implemented change without changing its intended behavior. The
parent owns the requester-facing outcome, finding disposition, source edits,
verification judgment, and stopping decision.

Use `refactor-maintainability` to assess behavior preservation and whether a
candidate belongs now. Use the single `reviewer` entrypoint for independent
review evidence when it can materially improve the cleanup judgment. The
reviewer decides whether reuse, simplification, efficiency, altitude, or another
bounded lens warrants separate attention and returns one consolidated verdict.
The parent does not require a predetermined lens count or execution sequence.

## Preconditions and Scope

Confirm source mutation is authorized before requesting cleanup review or
editing. If it is not, return `Outcome: blocked` with the required authority.

Use the caller-supplied target. Otherwise scope the work to current worktree
changes, including staged, unstaged, and relevant untracked content. If the
scope is empty, return `Outcome: no-op`.

Record the Git or request boundary, in-scope files, implementation intent,
relevant interfaces and observable behavior, and available verification. Keep
enough source-state evidence to recognize whether review findings have become
stale. Review may inspect supporting code, but every cleanup candidate must
trace back to the implemented change.

## Review and Decide

Seek concrete opportunities that reduce present maintenance cost while
preserving behavior, including:

- reuse of an existing helper, type, constant, abstraction, or repository
  pattern that prevents duplication or semantic drift;
- removal of unnecessary branching, state, indirection, plumbing, or copy-paste
  variation;
- removal of avoidable computation, I/O, retrieval, serialization, or blocking
  work without changing observable timing or ordering;
- a small correction to ownership, dependency direction, or abstraction level
  justified by the current change.

Require evidence, a changed-code location, the smallest cleanup direction,
behavior risk, and feasible verification for each material finding. Keep
suspected correctness defects separate from cleanup candidates.

Before editing, verify findings against the current source state and merge those
with the same root cause. The parent then disposes each candidate:

- **adopt** when evidence supports a small behavior-preserving improvement to
  the current outcome;
- **reject** when unsupported, duplicate, preference-only, stale, behavior
  changing, or outside the governing goal;
- **defer** when valuable but unnecessary for current acceptance or too broad
  for this change;
- **escalate** when it changes the contract, scope, or requires user-owned
  input.

Apply only adopted candidates as small reviewable patches. A cleanup may reach
the nearest owner and necessary callers, but defer redesign, migration,
speculative abstraction, or changes spanning responsibilities without a
bounded justification.

## Verify and Stop

Run proportionate repository-defined checks and inspect the cleanup delta
against the pre-application state. Confirm each edit maps to an adopted
candidate and look for behavior change, accidental edits, stale evidence, and
scope drift. If a cleanup causes a failure, decide whether a bounded correction
or revert is justified; add another review or check only when it can change a
material claim.

Stop when the adopted cleanup is supported by the available evidence and
residual risk can be stated, or when a blocker makes further editing unsafe.
Finding count, complete lens coverage, and repeated approval are not completion
conditions.

## Final Handoff

Return:

- `Outcome`: changed, no-op, blocked, or failed;
- `Scope`: reviewed boundary and files;
- `Applied`: adopted cleanups and their evidence;
- `Deferred, rejected, or escalated`: material candidates and reasons;
- `Correctness escapes`: only when present;
- `Verification`: commands, results, and material skipped checks;
- `Residual risk`: unresolved failures, weak behavior evidence, stale scope, or
  incomplete review evidence.

Do not create a durable artifact unless the user separately requests one.
