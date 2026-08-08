# Mesh Workflow Patterns

This is an optional catalog, not a mandatory pipeline, role hierarchy, or completion guarantee. Select, combine, adapt, or skip patterns according to the work. Responsibility follows explicit ownership, not who launched whom or the runtime `parent` selector.

When transferring monitoring, pass the necessary `agentId` and `taskId`, the objective and current state, and the follow-up expected after termination. A consolidator may instead keep internal handles and return only the conclusion, evidence, deviations, and risks the requester needs.

## Primitive and workspace semantics

- `mesh_run` blocks for one result; use it when that result is the next serial dependency.
- `mesh_submit` returns a stable `agentId` and `taskId` without waiting for task completion. A new-agent submission may still wait for launch readiness before returning. Choose separately whether anyone should block with `mesh_wait`, register a watch, send a signal, retrieve with `mesh_get`, or stop the task.
- A `mesh_route watch` observes 1–128 same-mesh tasks and routes a `steer` or `followUp` notification to a durable Pi endpoint when at least one task is terminal for `any`, or every task is terminal for `all`. The completion payload snapshots every watched task's state at activation; with `any`, other watched tasks may still be nonterminal. It contains no task output, error, or usage. Retrieve details with `mesh_get` before relying on the outcome.
- A successful `mesh_route signal` means that a durable event was queued. It does not acknowledge that the receiver model processed the event or performed the requested action. Observe an explicit follow-up result when action matters.
- Pi peers can enable mesh tools and act as durable route endpoints. External harness agents such as `fast-worker` and `codex` can be submitted, waited on, watched, or stopped by a Pi peer, but they cannot receive or execute mesh tools. A Pi peer must retain their monitoring ownership.
- Each agent launch uses that caller's current `ctx.cwd`. Tasks whose agents operate in the same current project or workspace context can observe or affect unfinished changes, including formatter, generator, migration, repository-wide replacement, and test effects. Check the agents' cwd and workspace context rather than inferring a shared directory from mesh membership, then choose coordination strength from the actual interference risk.

## 1. Independent evidence swarm

#### Useful when

Several independent explorations can answer distinct parts of a question, and synthesis would be stronger than one sequential investigation.

#### Arrangement

Give each explorer a bounded evidence question. A monitoring owner tracks the submitted tasks, and a consolidator compares their evidence rather than concatenating reports. The requester, monitoring owner, and consolidator may be the same Pi peer.

#### Mesh moves

Use `mesh_submit` for independent questions and retain each returned `agentId` and `taskId`. Wait for selected results or watch `all` tasks when background notification helps. After terminal notification, use `mesh_get` for the reports before synthesis.

#### Adaptation points

Narrow, stop, or add one bounded question when early evidence resolves an uncertainty, exposes a missing capability, or shows that two explorers are duplicating work.

#### Stop condition

Stop coordinating when the material questions have supported answers or remaining uncertainty is explicit and further independent evidence is unlikely to change the outcome.

#### Cautions

More peers do not guarantee independent evidence. Account for shared sources, capacity, stale workspace observations, terminal failure, and watch payloads that omit the actual reports.

## 2. Hypothesis contradiction check

#### Useful when

An implementation or diagnosis depends on a consequential hypothesis that benefits from an independent attempt to disprove it.

#### Arrangement

The primary task owner states the hypothesis and evidence boundary. A separate peer owns the contradiction attempt. A monitoring owner observes it, and the consolidator decides how the result changes the working conclusion.

#### Mesh moves

Use `mesh_run` if the contradiction result gates the next action; otherwise use `mesh_submit` and preserve its handle. Signal the primary owner if a bounded contradiction changes its premise, then retrieve the complete result with `mesh_get` when needed.

#### Adaptation points

Change the implementation plan, request one narrower check, or lower confidence when the peer finds a counterexample, missing premise, or evidence that cannot be reproduced.

#### Stop condition

Stop after the hypothesis survives the agreed material checks, is rejected, or is explicitly retained with bounded uncertainty.

#### Cautions

A queued contradiction signal is not proof that the primary owner reacted. Avoid endless adversarial searching and do not let the checking peer silently take ownership of the primary task.

## 3. Boundary-focused early review

#### Useful when

A risky interface, ownership boundary, migration edge, or security-sensitive assumption can be reviewed before all implementation work finishes.

#### Arrangement

The implementer remains task owner. An independent reviewer examines only the named boundary. A monitoring owner tracks the review, and the implementer or another consolidator incorporates findings into the current plan.

#### Mesh moves

Use `mesh_run` before implementation when the review is a serial gate, or `mesh_submit` during implementation when work can continue independently. Carry the task handle to the monitoring owner and use `mesh_get` after termination for findings.

#### Adaptation points

Revise scope, interface shape, sequencing, or verification when the review identifies a material boundary error. Request a narrower follow-up rather than broadening the review without limit.

#### Stop condition

Stop when the named boundary has a usable verdict and actionable findings, or when missing evidence is reported clearly enough for the consolidator to decide.

#### Cautions

Early review sees an evolving source state. Record the inspected revision or state, recheck stale findings, and do not treat terminal completion as an approving verdict.

## 4. Asynchronous assurance sidecar

#### Useful when

Validation, static analysis, documentation checking, or another read-only assurance activity can run while independent implementation continues.

#### Arrangement

The implementer owns the source objective. A sidecar owns one assurance objective against a concrete state. A Pi monitoring owner tracks it, and the consolidator relates its evidence to the final state.

#### Mesh moves

Submit the sidecar with `mesh_submit`; retain its `agentId` and `taskId`. Use a watch when asynchronous terminal notification is useful, then call `mesh_get` for output, errors, and evidence. Signal the implementer only for a bounded premise-changing result.

#### Adaptation points

Rerun against a newer state, narrow the assurance claim, pause affected implementation, or add a focused check when concurrent edits make the original observation stale.

#### Stop condition

Stop when the assurance result is applicable to the state being consolidated, or when its limitation is explicit and the consolidator accepts or escalates the gap.

#### Cautions

When the sidecar and implementation operate in the same project or workspace context, that state may change during the run, so passing results can describe an intermediate state. External harness sidecars are not route endpoints; a Pi peer must monitor them.

## 5. Validation-aware review

#### Useful when

A review verdict depends on a validator whose failure may invalidate, limit, or redirect the review.

#### Arrangement

The validator owns its automated check. The reviewer owns review judgment and consolidation. A Pi monitoring owner watches the validator and ensures its terminal state reaches the reviewer.

#### Mesh moves

Submit the validator, pass its handle to the monitoring owner, and register a watch to the durable Pi reviewer with the relevant condition. On notification, use `mesh_get` for output and errors before deciding whether to stop, limit, continue, or escalate the review.

#### Adaptation points

On validation failure or unavailable evidence, suspend only affected claims, inspect unaffected areas, request repair, or escalate uncertainty according to the retrieved evidence.

#### Stop condition

Stop when the reviewer can issue a bounded verdict tied to known validation evidence, or clearly reports why no reliable verdict is available.

#### Cautions

A watch reports terminal state, not success or validator details. An `any` watch may fire before other tasks finish; preserve ownership for every task still running.

## 6. Completion baton

#### Useful when

Several predecessor tasks must all terminate before a final implementer can inspect integration and run the appropriate full gate.

#### Arrangement

Each predecessor keeps its bounded task owner. A monitoring owner registers the completion condition. The final implementer receives the baton and becomes integration task owner and, when appropriate, consolidator.

#### Mesh moves

Submit predecessor tasks and retain all handles. Register an `all` watch that sends `steer` or `followUp` to the durable Pi final implementer. The receiver uses `mesh_get` for each outcome before integration inspection and full-gate decisions.

#### Adaptation points

The final implementer may repair overlap, reject a failed predecessor result, rerun a focused task, narrow the integration, or defer the full gate when retrieved evidence requires it.

#### Stop condition

Stop after current-state integration inspection and the applicable full gate, or after a clear blocked result assigns the remaining follow-up.

#### Cautions

`all` means all watched tasks reached terminal states, not that all succeeded. Ensure capacity remains for the final implementer and avoid predecessor cycles that wait for the baton receiver's future action.

## 7. Exception escalation

#### Useful when

A peer discovers a scope conflict, invalid assumption, unavailable verification, overlapping change, or other exception that changes another task's premise.

#### Arrangement

The discovering peer retains its bounded responsibility and identifies the relevant consumer. The consumer or an explicit Pi peer owns monitoring and the consolidator decides whether to replan, limit, or stop affected work.

#### Mesh moves

Use `mesh_route signal` to send the bounded exception, affected premise, evidence pointer, and requested reaction to a durable Pi endpoint. Include task handles when follow-up requires retrieval or monitoring; use `mesh_get` for complete task evidence.

#### Adaptation points

The receiver may acknowledge through a separate result, change scope, coordinate overlapping writers, request a focused check, or leave unaffected work running.

#### Stop condition

Stop escalating when the relevant owner has produced an observable follow-up decision, or when the exception and unacknowledged risk have been surfaced to the requester.

#### Cautions

Signal queueing is not processing acknowledgement. Do not route to an external harness, broadcast irrelevant detail, or assume launch provenance identifies the authority that should decide.

## 8. Bounded repair loop

#### Useful when

Validator or reviewer evidence identifies a localized defect that can be repaired and rechecked without reopening the whole objective.

#### Arrangement

The implementer owns the bounded repair. The validator or reviewer owns independent re-evaluation. A monitoring owner tracks each background pass, and a consolidator decides when evidence is sufficient.

#### Mesh moves

Return evidence to the implementer through the task result or a bounded signal. Submit repair or recheck tasks as useful, preserve each active handle, and use `mesh_get` after terminal notification before starting another iteration.

#### Adaptation points

Tighten the repair boundary, choose a different check, escalate a systemic finding, or stop looping when repeated failures show that the original scope is no longer valid.

#### Stop condition

Stop after the focused defect is repaired and independently rechecked, or after a bounded number of evidence-driven attempts ends in an explicit unresolved risk.

#### Cautions

A successful signal does not acknowledge repair, and terminal recheck does not imply passage. Avoid self-sustaining loops, stale checks against intermediate workspace state, and repairs that silently expand ownership.

## 9. Specialist reuse

#### Useful when

An idle Pi specialist has relevant context or capability for a later bounded task, and reuse avoids unnecessary setup without coupling unrelated outcomes.

#### Arrangement

The new requester defines a fresh local objective and stop condition. The reused specialist becomes that task's owner; monitoring and consolidation are reassigned explicitly rather than inferred from the earlier task.

#### Mesh moves

Use `mesh_run` or `mesh_submit` with the idle specialist's `agentId` and retain the follow-up task's new handle. Pass only relevant prior context, and give the new monitoring owner the handle and expected follow-up.

#### Adaptation points

Choose a fresh specialist instead when prior context biases the work, capability no longer fits, the endpoint is unavailable, or reuse would create a wait or capacity bottleneck.

#### Stop condition

Stop reuse when the follow-up objective is complete or when the specialist reports that its context or capability is insufficient.

#### Cautions

Do not infer current authority, state, or monitoring ownership from earlier launch relationships. External harness agents cannot become durable route receivers or initiate mesh coordination.

## 10. Shared-workspace parallel implementation

#### Useful when

Independent implementation objectives may progress concurrently while their agents operate in the same project or workspace context, and the expected speed or specialist benefit outweighs manageable interference risk.

#### Arrangement

Give each implementer a bounded objective, but choose coordination strength from observed effects rather than imposing universal file ownership. Name a monitoring owner for each background task and a consolidator for current-state integration and full-gate judgment.

#### Mesh moves

Use `mesh_submit` for concurrent objectives and retain their handles. Signal relevant peers when scope or observed state begins to overlap. Wait or watch as useful, then use `mesh_get` and inspect the actual workspace and diff before integration.

#### Adaptation points

Confirm each agent's cwd and project/workspace context, then inspect the current diff, target overlap, formatter or generator reach, migrations, repository-wide replacements, and tests that observe intermediate state. Increase communication, sequence a risky operation, pause affected work, or continue concurrently according to that evidence.

#### Stop condition

Stop parallel coordination after the consolidator has inspected the current integrated state, resolved or reported interference, and decided or completed the applicable full gate.

#### Cautions

Agents launched from the same current project or workspace context can affect the same unfinished diffs; same-mesh membership alone does not establish a shared cwd. Coordination does not prevent conflicts or stale observations. Do not turn worktrees, writer leases, single-writer rules, or fixed file boundaries into universal constraints; use them only if a separate task context specifically justifies them.
