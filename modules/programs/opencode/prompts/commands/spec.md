Spec target: $ARGUMENTS

Specification contract:
- Elicit and clarify requirements through structured exploration and user questions.
- Delegate read-only codebase discovery to `explore`.
- Delegate draft plan creation to `draft_planner`.
- Delegate external knowledge gaps to `researcher` when they can affect scope, architecture, migration, risk, or verification.
- Ask the user to choose final plan review strictness: `instant`, `light`, or `full`.
- Delegate final plan review to `plan_reviewer` for `light` and `full` strictness only.
- Write the final plan file to `.agents/plans/`.
- Complete specification elicitation and resolve/default material ambiguities before draft planning.

Planning boundaries:
- This workflow produces planning/report artifacts under `.agents/`, with the final plan under `.agents/plans/`.
- Do not proceed to draft planning while material ambiguities remain unresolved.

Standing delegation policy:
- Use available helpers when they materially improve planning quality, especially for repository exploration or external knowledge gaps.
- Do not finalize planning while unresolved gaps can affect scope, architecture, migration sequencing, risk, or verification strategy.

Spec Planning Workflow:

Phase 1: Initial Understanding
Goal: Build a precise understanding of intent, requirements, constraints, and affected code.

1) Focus on user intent, success criteria, scope boundaries, constraints, and tradeoffs.
2) Gather read-only repository context unless existing context is already sufficient.
3) Synthesize findings and identify ambiguities.
4) Use the `question` tool repeatedly until every non-discoverable, high-impact ambiguity is resolved or explicitly defaulted. You may ask multiple questions at once when they are independent and all are needed before proceeding. Do not proceed to draft planning while any material uncertainty remains.

Phase 2: Specification Elicitation (Hard Gate)
Goal: Elicit and lock a decision-ready specification before any draft planning.

Intent: Ensures ambiguous or underspecified requests are transformed into precise, implementable requirements before any design work begins.

1) Build an explicit specification baseline covering:
   - problem statement and user goal
   - measurable success criteria and acceptance criteria
   - scope boundaries and out-of-scope items
   - constraints (technical, performance, compatibility, timeline)
   - key tradeoffs and non-goals
2) Distinguish unknowns:
   - discoverable facts: resolve via read-only exploration first
   - preferences/tradeoffs: resolve via `question` tool
3) Use `question` for every non-discoverable, high-impact ambiguity. Ask multiple questions at once when they are independent and all are needed before proceeding.
4) Do NOT call `draft_planner` while qualifying ambiguities remain unresolved.
5) If the user cannot answer immediately, choose conservative defaults and record them explicitly with rationale.
6) Decision classification: after resolving ambiguities, classify every remaining unknown or low-confidence decision into one of two categories:
   - Decide now: unknowns that affect architecture, scope boundaries, or interface contracts. These must be resolved before draft planning.
   - Defer to implementation: unknowns that can only be resolved by reading code or that involve implementation-level details (for example: specific API usage, error handling internals, or minor structural choices). Record these explicitly as intentional deferrals, not as unresolved gaps.
   - This classification must be complete before calling `draft_planner`.

Specification Readiness Gate (Mandatory Before Phase 3):
1) Produce readiness status: `spec_ready = true` only when all architecture-, scope-, and interface-level ambiguities are resolved or explicitly defaulted.
2) Record remaining open questions that still require pre-planning resolution: must be empty for `spec_ready = true`; otherwise continue Phase 2.
3) Record chosen defaults and rationale for any unresolved-but-defaulted item.
4) Record intentional deferrals for implementation-owned decisions separately from blocking open questions.
5) If `spec_ready != true`, continue elicitation and DO NOT start draft planning.

Phase 2.5: Knowledge-Gap Escalation (Mandatory)
Goal: Resolve any material knowledge uncertainty that can affect planning decisions.

1) Run a material knowledge-gap check after initial exploration and before finalizing design decisions.
2) If any unresolved gap can change scope, architecture, migration sequencing, risk, or verification strategy, you MUST delegate to `researcher`.
3) Hard-fail policy: do not continue to final plan synthesis while qualifying gaps remain unresearched.
4) Pass concrete research questions and known local findings to the `researcher` agent.
5) Keep delegation concise (normally one focused `researcher` call per planning pass, or per related gap cluster).
6) Treat source-backed facts in the **Conclusion** section of returned research files as verified. Preserve stated caveats, uncertainty, confidence limits, and unresolved gaps when integrating research into planning decisions.

Phase 2.8: Skill Discovery
Goal: Prefer available skills before defaulting to generic workflows.

1) Discover available skills at task start, including project-local skills.
2) Identify which discovered skills are relevant to the current task.
3) For planning context, keep only relevant skills.
4) When at least one relevant skill exists, keep a concise skill brief containing: relevant skills, why each skill is relevant, expected usage focus.
5) If no relevant skill exists, omit the skill brief and proceed with normal tools.

Phase 2.9: Draft Planning
Goal: Delegate draft plan creation to `draft_planner`.

Draft plans cover goals, approach rationale, step overviews, impact scope, risks, and intentional deferrals.
Draft plans do NOT include detailed implementation steps or task breakdown structure — those belong in the final plan after user approval.

Phase 3: Specification Design
Goal: Convert clarified intent into implementable specification drafts.

1) Call `draft_planner` to create a direction-setting draft plan.
2) Pass the deferred decisions list from Phase 2 as explicit context for the draft plan.
3) Require each draft to cover:
   - architecture and data flow
   - touched interfaces, APIs, and types
   - migration and compatibility concerns
   - failure modes and rollback strategy
   - verification strategy
   - deferred implementation-owned decisions
4) Require draft plan path + short summary from the draft planner.

Phase 3.5: Draft Confirmation Gate (Mandatory)
Goal: Confirm draft direction with the user before writing the final plan.

1) Ask the user for explicit confirmation to proceed using `question` tool, including the draft plan path from Phase 3.
2) If the user requests revisions or does not confirm, call `draft_planner` to produce a revised draft plan file under `.agents/plans/draft/`.
3) After each revision, return draft plan path + short summary and ask for confirmation again.
4) Do NOT proceed to Phase 4 until explicit user confirmation is received.

Knowledge-Gap Gate (Mandatory Before Final Plan Write):
1) Before entering Phase 4, run a final material knowledge-gap check.
2) If any qualifying gap remains, you MUST call `researcher` before writing the final plan file.
3) Skipping required delegation is a hard-fail policy violation.
4) In the final plan, state source-backed research conclusion facts as verified while preserving any research-stated caveats, uncertainty, confidence limits, or unresolved gaps that affect implementation scope, risk, or verification. Source links may remain in the research file unless needed for decision traceability.

Phase 4: Final Plan File
Goal: Synthesize clarified requirements + draft plan(s), then write the final plan file.

1) Read the draft plan produced in Phase 3.
2) Write a decision-complete final plan file (`*.md`) under `.agents/plans/`.
3) Required sections:
- title and brief summary
- scope and out of scope
- step-by-step implementation plan
- critical file paths expected to change
- risks and mitigations
- verification section (tests, checks, and acceptance criteria)
- Open Questions (if any)
- Chosen Defaults
- Intentional Deferrals
- task breakdown structure:
{{DIVIDABLE_TASK_STRUCTURE}}

Phase 5: Review Strictness Selection
Goal: Let the user choose how much review pressure to apply after the final plan file exists.

1) After writing the final plan file in Phase 4, ask the user with the `question` tool to choose exactly one review strictness:
   - `instant`: no review pass; fastest handoff after final plan file creation.
   - `light`: focused `plan_reviewer` pass for blocking plan defects only.
   - `full`: normal rigorous `plan_reviewer` pass across plan completeness, correctness, constraints, risk, and verification.
2) Do NOT ask this before the final plan file is written. The draft → final plan file flow must always happen first.
3) Treat the selected value as the review contract for the remainder of the workflow.

Phase 5.5: Review Execution
Goal: Validate the final plan according to the selected strictness and close critical gaps before reporting.

1) If selected strictness is `instant`:
   - Do NOT call `plan_reviewer`.
   - Do NOT do any extra review pass.
   - Proceed directly to completion with the minimal output described in Phase 6.
2) If selected strictness is `light`:
   - Call `plan_reviewer` with explicit context: `Review strictness: light`.
   - Tell `plan_reviewer` to focus on blocking design gaps, scope/interface contradictions, impossible or missing verification, and plan defects that would likely mislead implementation.
   - If `plan_reviewer` reports any high finding, revise the same final plan file and run one additional `plan_reviewer` pass with `Review strictness: light`.
   - Treat medium/low findings as optional unless they point to a concrete implementation blocker; convert accepted findings into explicit revisions/defaults.
3) If selected strictness is `full`:
   - Call `plan_reviewer` with explicit context: `Review strictness: full`.
   - `plan_reviewer` reviews ONLY `.agents/plans/*.md` that are NOT in `.agents/plans/draft/`.
   - If `plan_reviewer` reports any high/medium finding, revise the same final plan file and run one additional `plan_reviewer` pass with `Review strictness: full`.
   - Convert findings into explicit revisions and defaults for the final plan.

Phase 6: Completion and Failure Handling
1) Do NOT request an additional final-plan confirmation after Phase 4 or Phase 5.5.
2) For `instant`, return only:
   - Plan file: <path>
   - Review: skipped (instant)
   - Summary: <1-2 sentences>
3) For `light` or `full`, report completion after final write and review are complete:
   - Plan file: <path>
   - Review strictness: <light|full>
   - Summary: <2-4 sentences>

Failure Handling:
- Draft planner fails: retry once with clearer instructions. If retry fails, return a hard failure with attempted path(s), exact error(s), and note that no valid draft plan was created.
- Final plan write fails: return a hard failure with attempted path and exact error.
- `plan_reviewer` fails: return a hard failure with attempted path and exact error.
- Post-revision re-review fails: return a hard failure with attempted path and exact error.
- Do not fall back to chat-only final plans.

Consumption policy for `test-spec`, `failure-report`, and `bug-report` files:
- Read the `## Summary` block first.
- Read detail sections only when implementation-level context is needed for delegation or execution.
