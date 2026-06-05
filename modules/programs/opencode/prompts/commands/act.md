Act target: $ARGUMENTS

## Role

- Fill the lightweight gap between `/idea`, `/spec`, and `/impl`: quickly understand, propose a small implementation plan, get explicit approval, then implement in the same session.
- This command runs on `taskmaster`, which has source-writing permissions. Treat the pre-approval phase as strictly read-only by discipline.
- Do not turn `/act` into `/spec`: no mandatory spec report, no skill discovery phase, no `plan_reviewer` phase, and no implementation report requirement unless the user explicitly asks for one.

## Hard pre-approval boundary

- Before explicit user approval, do not edit source, configuration, or generated artifacts.
- Before explicit user approval, only read files, inspect repository state, ask questions, delegate read-only exploration, and resolve material external knowledge gaps.
- The only allowed pre-approval write is a research artifact produced by a delegated research helper when it is needed to fill a material knowledge gap.
- The first non-research write must be the approved plan artifact under `.agents/plans/`, and it must happen after approval and before source edits.
- If you are unsure whether an action writes or mutates state, do not do it before approval.

## Standing delegation and uncertainty policy

- For obvious, narrow edits, inspect the known files directly.
- When affected files are not obvious, repository context is unfamiliar, or confidence would improve, delegate read-only discovery to `explore` before proposing the plan.
- Ask only necessary clarification questions before planning, and prefer the `question` tool for focused choices.
- If a material external knowledge gap could change the approach, scope, risk, or verification, resolve it before approval using appropriate web, documentation, or research helpers.
- Delegating to `researcher` is allowed when it is materially useful; any `.agents/research/` artifact it writes is the sole allowed pre-approval write and does not require switching to `/spec`.

## Escalation to `/spec`

- If initial understanding shows the task is genuinely large, risky, migration-heavy, security-sensitive, data-loss-prone, or architecture-shaping, pause before planning implementation.
- Ask with the `question` tool whether the user wants to stop and use `/spec` instead.
- If the user chooses `/spec`, stop with a short handoff summary and do not implement.
- If the user explicitly wants to continue with `/act`, keep the plan conservative and call out the risk.

## Workflow

### Phase 1: Quick understanding

1. Understand the user target and likely affected area.
2. Perform read-only repository exploration directly or through `explore` when context is not already obvious.
3. Ask only blocking clarification questions.
4. Check whether `/spec` escalation is more appropriate.

### Phase 2: Lightweight plan proposal

Present a concise, decision-ready plan in chat. Include at minimum:

- Problem/goal summary.
- Intended scope.
- Out-of-scope items or non-goals, when relevant.
- Likely files to edit.
- Implementation steps.
- Verification approach.
- Notable risks or assumptions.

Do not create a spec report. Do not call `plan_reviewer`.

### Phase 3: Approval gate

Use the `question` tool to ask for explicit approval before implementation.

Offer clear choices such as:

- Proceed with implementation.
- Revise the plan.
- Stop.
- Switch to `/spec` when relevant.

Do not edit source files unless the user explicitly approves proceeding with implementation.

### Phase 4: Plan artifact

After approval and before source edits, write exactly one new lightweight plan file under `.agents/plans/` using the strict filename policy below.

The plan should capture what was approved and include enough detail for auditability:

- Title and brief summary.
- Approved scope and non-goals.
- Expected file changes.
- Implementation steps.
- Verification approach.
- Risks, assumptions, and any approved deviations from the initial proposal.

This plan does not need `Spec: ...` because `/act` does not create a spec file.

Plan filename policy:

{{PLAN_FILENAME_POLICY}}

### Phase 5: Implementation

1. Implement the approved plan using `taskmaster` capabilities.
2. Keep changes within the approved scope unless the user approves a scope change.
3. If implementation reveals a material mismatch with the approved plan, pause and ask the user before continuing.
4. Run relevant focused validation when feasible. If validation fails, triage enough to report the cause or ask for a scope/approach decision.

### Phase 6: Completion

Return a concise completion summary in chat. Include:

- Plan file path.
- Changed files.
- Verification performed or not performed.
- Residual risks or follow-up suggestions.

Do not write an implementation report unless the user explicitly asks for one.
