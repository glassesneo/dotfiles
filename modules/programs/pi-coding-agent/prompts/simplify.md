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
3. Submit four separate asynchronous `review-lens` tasks with `mesh_submit` concurrently. Record the four returned task IDs, paired with their lenses, as the exact retrieval set for this run. Do not edit source or make overall finding dispositions while any tracked result is missing.
4. Treat each completion bundle as the current delivery frontier. For every newly terminal task in the bundle that belongs to the exact retrieval set, call `mesh_get` once with that task ID and record its evidence. Ignore unrelated task IDs and leave listed pending tasks unretrieved. Never use `mesh_get` to poll.
5. After each bundle, continue only useful work that is independent of the missing reviews. If only review results remain, end the current response and await another completion bundle. Across any number of bundles, retrieve each tracked task exactly once.
6. Once all four tracked outputs have been received, re-check the current status and diff against the dossier marker, then make one joint disposition across all evidence. If in-scope source is stale, adopt none of the affected findings and start a new fixed-four run for the affected current scope before editing. Keep unrelated out-of-scope changes separate.
7. Use the Skill's parent disposition, cleanup, verification, stopping, and final-handoff procedure. Use `validator` only when long validation output or independent failure diagnosis would materially improve the decision.

If the resolved scope is empty, submit no tasks and return `Outcome: no-op`.
