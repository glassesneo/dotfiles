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

## Purpose and Authority

Improve an implemented change without changing its intended behavior. The
parent owns the scope, integration of independent evidence, finding disposition,
source edits, verification judgment, stopping decision, and requester-facing
handoff.

Confirm source mutation is authorized before requesting cleanup review or
editing. If it is not, return `Outcome: blocked` and identify the required
authority. Use `refactor-maintainability` when behavior-preservation risk or
fix-now versus defer judgment needs deeper analysis.

## Scope Dossier

Use the caller-supplied target. Otherwise scope the work to staged, unstaged,
and relevant untracked worktree changes. If the scope is empty, do not run the
review passes; return `Outcome: no-op`.

Before review, record one shared scope dossier containing:

- the Git or request boundary and a source-state marker;
- in-scope files or paths and the changed-code boundary;
- implementation intent and non-goals;
- observable behavior, including relevant interfaces, side effects, errors,
  ordering, persistence, permissions, concurrency, and performance;
- available tests, designs, issues, and runtime evidence.

Supporting code may be inspected, but every cleanup candidate must trace to the
implemented change. Keep the in-scope source unchanged until all four review
results are available.

## Four Separate Perspectives

For every non-empty scope, examine all four perspectives as separate review
passes. A `no-op` result is valid. This fixed-four protocol is an explicit,
workflow-scoped exception to adaptive delegation guidance.

When the execution environment provides independent contexts, run each
perspective in a separate context with the same dossier and live source state.
Otherwise perform four clearly separated passes in one context and disclose the
weaker independence in the final handoff. Each pass examines only its assigned
perspective, does not consolidate the overall review, and does not edit source.

- **Reuse**: Find reimplemented helpers, utilities, types, constants,
  abstractions, or repository patterns. Return only candidates where reuse
  materially reduces duplication, semantic drift, or maintenance surface.
- **Simplification**: Find unnecessary branching, nesting, state, indirection,
  parameter plumbing, redundant abstraction, or copy-paste variation. Return
  only candidates that express the same behavior more directly, not style or
  line-count preferences.
- **Efficiency**: Find avoidable computation, I/O, duplicate retrieval,
  serialization, blocking, or serial execution of independent work. Exclude
  micro-optimizations and candidates that change observable timing, ordering,
  or resource contracts.
- **Altitude**: Check whether the change sits with the appropriate existing
  owner and at the appropriate abstraction level. A small correction to the
  nearest owner may qualify; cross-responsibility redesign, migration, or a new
  generalized API must be deferred or escalated.

## Perspective Result Contract

Return each perspective result as Markdown with:

- `Lens`: the assigned perspective;
- `Verdict`: `findings`, `no-op`, or `blocked`;
- `Findings`: for each material candidate, a lens-local ID, changed-code
  location, concrete evidence and supporting-code reference, present
  maintenance or work cost, smallest cleanup direction, behavior-preserving
  invariant and risk, feasible verification, and confidence;
- `Correctness escapes`: suspected defects that are not cleanup candidates, or
  `none`;
- `Gaps and uncertainty`: unexamined areas, unknown contracts, and staleness
  risk.

Do not report unsupported, preference-only, speculative, or untraceable
candidates as findings.

## Integrate and Edit

After all four results arrive, compare the current source state with the dossier
marker. If in-scope source changed during review, do not adopt stale findings;
rerun all four perspectives for the affected scope against the current state.
Keep unrelated out-of-scope changes separate and disclose them.

Merge findings with the same root cause, then assign every material candidate:

- **adopt** when evidence supports a small, behavior-preserving, verifiable
  improvement that belongs to the current change;
- **reject** when unsupported, duplicate, preference-only, stale,
  behavior-changing, or outside the governing goal;
- **defer** when useful but unnecessary for current acceptance or broader than
  cleanup scope;
- **escalate** when it changes the contract or scope or requires a user-owned
  decision.

Only the parent makes these dispositions. Apply only adopted candidates as
small reviewable patches. Keep correctness defects, redesign, migration,
API or schema changes, security-boundary changes, and unrelated broad cleanup
out of the simplify edit.

## Verify and Stop

Run the repository-defined lowest responsible checks that can observe failures
the cleanup could introduce. Use independent validation only when isolating
long output or failure diagnosis would materially improve the decision. Inspect
the final delta and confirm every edit maps to an adopted candidate without
behavior change or scope drift.

Stop when adopted cleanup is supported and residual risk can be stated, or when
a blocker makes further editing unsafe.

## Final Handoff

Return:

- `Outcome`: changed, no-op, blocked, or failed;
- `Scope`: boundary and in-scope files;
- `Review evidence`: receipt status and material results for all four
  perspectives, plus any reduced-independence disclosure;
- `Applied`: adopted cleanup and evidence;
- `Deferred, rejected, escalated`: material candidates and reasons;
- `Correctness escapes`: only when present;
- `Verification`: commands, results, and skipped checks;
- `Residual risk`: weak behavior oracles, unavailable checks, or remaining
  uncertainty.

Do not create a durable artifact unless the requester separately asks for one.
