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

Improve an implemented change without changing its intended behavior. Review one stable scope through four independent cleanup lenses, consolidate the evidence, apply only the smallest justified cleanups, and verify the final source state.

Use `refactor-maintainability` for behavior-preservation analysis and candidate classification. Use `task-orchestration` for peer coordination and result integration; do not replace either skill's general procedure here.

## Preconditions

Before running Git commands or enabling or using mesh tools, confirm that both `write` and `edit` are available and that the active mode permits source mutation. If either condition fails:

- stop before launching critics or changing source;
- do not degrade to a review-only result;
- return `Outcome: blocked` and direct the user to `/mode ops`.

The parent executing this skill is the sole consolidator and source editor. Critics remain read-only, and no implementation worker receives a cleanup task.

## Establish the Scope

When no target is supplied, define the scope as all current worktree changes. Inspect:

- `git status --short`;
- the staged diff;
- the unstaged diff;
- untracked files from `git ls-files --others --exclude-standard`, including their relevant contents.

If this scope is empty, return `Outcome: no-op` without launching critics.

When a target is supplied, prefer it over the default. Interpret it as a path, commit range, or request context, and identify the corresponding files and diff boundary. Ask the user only when ambiguity would materially change the scope.

Before review, record a scope descriptor containing:

- target kind and Git boundary;
- every in-scope file, including untracked files;
- implementation intent inferred from the conversation, approved material, issue, or diff;
- known public interfaces, side effects, ordering, error behavior, and available tests or comparison oracles;
- the tracked and untracked source snapshot the critics must review.

Retain enough status, diff, and untracked-content evidence to detect a material change to that snapshot after review. Neither the parent nor another known writer may edit the scope until all four reviews have been collected.

## Run Four Independent Reviews

After preflight, enable mesh tools if they are not active. Submit four separate `critic` tasks against the same scope descriptor, one per lens below. Submit all four consecutively with `mesh_submit`, retain their task handles, and use `mesh_wait` with the `all` condition because every result is a consolidation dependency. The parent remains monitoring owner and retrieves each terminal result as needed.

Each critic prompt must identify the critic as the receiver and provide:

- the complete shared scope descriptor as its visible input;
- read-only repository access, with permission to inspect relevant callers, callees, owners, existing helpers, and tests;
- exactly one lens and the responsibility to report only cleanup opportunities caused by the changed code;
- the finding contract below;
- a stop condition of returning the review report without editing source or coordinating other work.

Use these lenses:

1. **Reuse (`R`)**: Find changed code that reimplements an existing helper, utility, type, constant, abstraction, or repository pattern. Report only reuse that concretely reduces duplication, semantic drift, or maintenance surface, not superficial similarity.
2. **Simplification (`S`)**: Find unnecessary branching, nesting, state, indirection, parameter plumbing, redundant abstraction, or copy-paste variation. Report only a more direct expression of the same behavior, not line-count reduction as an end in itself.
3. **Efficiency (`E`)**: Find avoidable computation, I/O, repeated retrieval, needless serialization of independent work, or blocking work on a hot path. Exclude micro-optimization, and identify any possible effect on observable side effects, ordering, error timing, or concurrency.
4. **Altitude (`A`)**: Check whether the change sits at the appropriate repository owner and abstraction level. Look for a small, presently justified generalization of an underlying mechanism or a correction to dependency direction or responsibility placement. Exclude broad redesign and abstractions for hypothetical future requirements.

Critics may inspect supporting code outside the diff, but every cleanup finding must point back to changed code in the defined scope. They do not perform general correctness review.

## Finding Contract

Each finding must contain these Markdown fields:

- `ID`: lens prefix plus sequence number, such as `R1`, `S1`, `E1`, or `A1`;
- `Location`: changed-hunk `path:line`, plus an existing mechanism location when relevant;
- `Evidence`: concrete duplication, control flow, work, or ownership facts;
- `Opportunity`: the maintenance cost the cleanup would reduce;
- `Smallest cleanup`: the minimum behavior-preserving direction;
- `Behavior risk`: relevant inputs, outputs, errors, side effects, ordering, persistence, public API, permissions, concurrency, or performance;
- `Verification`: an existing test, check, or comparison for the cleaned result;
- `Disposition hint`: one of `fix now`, `separate change`, `defer`, `reject`, or `verify first`.

When there is no finding, the critic returns `No findings` and states what it inspected. When evidence is insufficient, it names the missing evidence rather than inventing a finding. A suspected correctness defect goes under `Correctness escape`, separate from cleanup findings.

If a lens fails or is blocked, use its evidence and the remaining context to choose whether to rerun it, continue with explicitly limited coverage, or stop. Never present fewer than four completed lenses as full simplify coverage.

## Recheck and Consolidate

After collecting review results and before applying any finding, capture the status, staged and unstaged diffs, and all untracked paths and contents again, then compare that representation with the recorded snapshot. If the scope changed materially, do not apply stale findings. Either repeat all four lenses against a fresh descriptor or stop and report the stale result. Otherwise, retain this complete representation as the pre-application baseline.

Then consolidate once:

1. Verify every finding's location and evidence directly in the repository.
2. Merge findings with the same root cause into one candidate while retaining all source finding IDs.
3. Classify each candidate as `adopt`, `defer`, `reject`, or `correctness escape`, applying `refactor-maintainability` to behavior risk and fix-now versus separate-change decisions.
4. Exclude intended behavior changes, feature work, speculative abstractions, unrelated cleanup, migrations, and redesign.
5. Apply only `adopt` candidates as small reviewable patches, directly by the parent.

An altitude cleanup may extend from a changed file to its nearest owner or underlying mechanism and the callers necessary for that cleanup. Defer a candidate that would redesign a public boundary, span many owners, or require migration.

Missing characterization evidence is not an automatic stop. Decide from repository contracts, critic evidence, the diff, and available checks. If an adopted cleanup remains weakly supported, record that uncertainty as residual risk.

Keep correctness escapes separate and do not repair them as cleanup work.

## Verify the Final State

Run proportionate repository-defined verification after cleanup. Either execute focused checks directly or, when independent execution is useful and the active mode exposes `validator`, delegate a concrete objective and the final source state through `implementation-validation`. Validator use is optional.

For every check, retain the command and pass, fail, or blocked result. Record material checks not run and why. If a failure was caused by a cleanup, repair or revert that cleanup and verify again. Classify unrelated failures explicitly; do not report them as success.

Finally, capture the same complete worktree representation as the pre-application baseline: status, staged and unstaged diffs, and all untracked paths and contents. Compare the final representation with that baseline to isolate the cleanup delta, including created, edited, or deleted untracked files. Inspect that delta for accidental edits, behavior changes, and scope drift, and confirm that every change in it maps to an adopted candidate.

## Final Handoff

Return these sections in order:

- `Outcome`: `changed`, `no-op`, `blocked`, or `failed`;
- `Scope`: reviewed Git boundary and files;
- `Applied`: each cleanup and its originating finding IDs;
- `Deferred or rejected`: material candidates not applied and the reason;
- `Correctness escapes`: only when present;
- `Verification`: commands, pass/fail/blocked results, and material skipped checks;
- `Residual risk`: incomplete lens coverage, weak behavior evidence, stale-scope termination, or unresolved failures.

Do not create a durable artifact for a normal run. If the user separately requests one, use the existing artifact workflow rather than defining a report format here.

## Completion Contract

Stop only when one of these conditions holds:

- the preflight is blocked and no review or edit occurred;
- the default scope is empty;
- a stable scope received four independent lens results, adopted cleanups were applied only by the parent, verification and final-diff inspection completed, and all material gaps were disclosed;
- a failure or stale scope prevents safe completion and is reported without applying unsupported findings.
