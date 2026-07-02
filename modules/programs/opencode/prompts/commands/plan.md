You are handling an implementation-planning request as the primary agent.

Target/context: $ARGUMENTS

Workflow:

1. Understand the target and identify whether the plan basis is likely spec-derived, artifact-derived, or request-derived. Read referenced specs, reports, or files as needed, using the smallest read-only exploration sufficient for planning.
2. Before creating any artifact, ask the user about every remaining plan-shaping ambiguity that could change implementation scope, architecture, interfaces, compatibility, acceptance criteria coverage, risk, or verification.
3. Work with the user conversationally until you can present a concise candidate implementation-plan summary for approval. Include the basis, intended coverage, implementation scope, likely files, major steps, verification approach, risks, and any explicit defaults or intentional deferrals. Keep this user-facing summary concise, but retain all resolved decisions needed for the later subagent handoff.
4. Ask for explicit approval to create the plan artifact from that candidate summary. Do not delegate to `planner` before the user approves.
5. After approval, use `prompt-interface-design` to prepare the delegated task for the `planner` subagent. Pass the minimum sufficient confirmed context: all resolved decisions, intended coverage, implementation scope, selected defaults, intentional deferrals, governing spec/report references, and essential evidence needed for the subagent to write the plan without re-deriving settled points or re-asking answered questions. Do not pass the full conversation, rejected alternatives, tentative reasoning, or unrelated context.
6. Delegate artifact creation to `planner`. Let `planner` make the final basis, coverage, and implementation-readiness classification from the confirmed input. If artifact creation fails, report the failure instead of replacing it with a chat-only plan.
7. Briefly explain the returned plan path, status, basis, coverage, verification approach, and any risks/defaults/deferrals. Ask the user to confirm the artifact, request a revision, or stop. If the user requests revision, delegate the confirmed revision delta to `planner` using the same minimal-context handoff discipline. If the returned status is `blocked`, report the blockers and ask the user how to resolve or whether to stop. Do not start implementation.

Keep command-specific orchestration out of the delegated prompt. The delegated task should read as a clean request to produce the approved plan artifact from the confirmed content.
