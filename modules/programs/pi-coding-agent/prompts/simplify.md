---
description: Clean up changed code without changing intended behavior
argument-hint: "[target/context]"
---
Use `simplify-workflow` for the supplied target. Pass this argument through as the caller target; when it is empty, use the Skill's worktree-default scope.

Target/context: $ARGUMENTS

This entrypoint requires source-mutation authority and ops mode. Do not change modes. In recon mode, return `Outcome: blocked` and tell the requester to run `/mode ops` before retrying.

For a non-empty scope in ops mode, apply this Pi adapter:

1. Freeze the Skill's shared scope dossier and source-state marker before dispatch.
2. From that same dossier, create four local delegated-task prompts for reuse, simplification, efficiency, and altitude. Each prompt must identify its single caller-supplied lens, require read-only work, include the applicable lens contract and common Markdown result contract from the Skill, return evidence to this caller, and stop after that bounded result without broadening, consolidation, disposition, or source edits.
3. Submit four separate asynchronous `review-lens` tasks with `mesh_submit`, using one deliberate channel key for the run. Record the exact four task IDs. Do not edit source or make overall finding dispositions while any of those four results is missing.
4. After dispatch, continue only independent useful work. If only review results remain, end the current response and await completion. Root must not use `mesh_wait`, poll pending tasks with `mesh_get`, repeatedly inspect a channel as a wait timer, or assume one channel key produces one completion cohort.
5. Across one or more completion events or a justified channel flush, receive the terminal outputs for this run's exact task-ID set once each. Ignore unrelated task results. Begin integration only after all four tracked tasks are terminal and their available outputs have been received.
6. Re-check the current status and diff against the dossier marker. If in-scope source is stale, adopt none of the affected findings and start a new fixed-four run for the affected current scope before editing. Keep unrelated out-of-scope changes separate.
7. Use the Skill's parent disposition, cleanup, verification, stopping, and final-handoff procedure. Use `validator` only when long validation output or independent failure diagnosis would materially improve the decision.

If the resolved scope is empty, submit no tasks and return `Outcome: no-op`.
