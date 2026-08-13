---
name: task-orchestration
description: >-
  Use when a requested outcome contains independently executable objectives or
  useful specialist boundaries that can proceed without serial dependence. Do
  not use for one atomic task that is clearer to complete directly.
---

# Task Orchestration

Handle atomic work directly. Delegate only when independent evidence,
specialist capability, waiting-time isolation, or contradiction could
materially improve the requester-facing outcome.

Separate these responsibilities by judgment, not launch hierarchy:

- **requester**: asks for a bounded task or coordinates the requester-facing
  outcome;
- **task owner**: owns one task's completion criteria and result quality;
- **monitoring owner**: observes a background task's terminal state and
  initiates any needed follow-up;
- **consolidator**: decides how multiple results affect one outcome.

One agent may hold several responsibilities. Runtime parentage does not assign
them automatically.

## Coordinate

Give each task a local objective, necessary context, allowed operations,
expected output, and stop condition. Choose direct work, serial delegation,
background execution, or parallel work from actual dependency and interference
risk rather than a fixed recipe. Tasks in the same workspace can observe or
affect unfinished changes, so account for source-state overlap and stale
evidence.

Name a monitoring owner for every background task. A terminal notification is
state, not proof of success and not the task evidence; retrieve the outcome when
a decision depends on it. A queued signal likewise does not prove that its
receiver processed or acted on it. Avoid cyclic waits and coordination that
consumes the capacity needed to make progress.

Treat every peer result as evidence. The consolidator checks it against the
current source state and governing objective, then adopts, rejects, defers, or
escalates it as appropriate. Resolve overlap, unsupported claims, deviations,
and verification gaps instead of concatenating reports. Add another task,
review, repair, or recheck only when it can plausibly change a material claim or
reduce a material risk.

Stop when the requested outcome is supported and residual risk can be stated.
Finding count, agreement among peers, or repeated approval is not a completion
condition.

## Return

Return the consolidated outcome, decision-relevant evidence, deviations, and
unresolved risks. Include task handles, monitoring ownership, or pending
retrieval and integration only when the requester or a new monitoring owner
must act on them.
