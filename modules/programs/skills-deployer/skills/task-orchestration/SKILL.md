---
name: task-orchestration
description: >-
  Use when a requested outcome contains independently executable objectives or
  useful specialist boundaries that can proceed without serial dependence. Do
  not use for one atomic task that is clearer to complete directly.
---

# Task Orchestration

Handle atomic work directly. Create a peer task only when independent evidence, capability, waiting time, or contradiction would materially improve the outcome.

Separate these responsibilities by decision, not launch hierarchy:

- **requester**: asks for a bounded task or coordinates the user-facing outcome;
- **task owner**: owns one task's completion criteria and result quality;
- **monitoring owner**: observes a background task's terminal state and initiates any needed follow-up;
- **consolidator**: integrates multiple results into one requester-facing outcome.

One agent may hold several responsibilities. They need not match the launcher, creator, or runtime `parent`.

## Coordinate

1. Give each peer a local objective, necessary context, allowed operations, expected output, and stop condition.
2. Use `mesh_run` when the returned result is the next serial dependency. Use `mesh_submit` for background work, then decide separately whether blocking wait, watch, or a bounded signal is useful.
3. For every background task, name a monitoring owner. When another agent assumes monitoring, give it the needed `agentId` and `taskId`, the task's objective and current state, and the expected follow-up.
4. Notify the relevant consumer when peer evidence changes another task's premise. A signal reports a bounded fact or requested reaction; its successful queueing is not acknowledgement that the receiver processed or acted on it.
5. Treat a watch as terminal-state notification, not proof of success. Its payload is a state snapshot without task output, error, or usage; use `mesh_get` when the outcome or evidence matters.
6. Keep monitoring on a Pi peer. External harness agents such as `fast-worker` and `codex` are not durable route endpoints and cannot receive or execute mesh tools.
7. Avoid cyclic waits, asking a peer to wait for your future action, and recursive blocking that consumes the capacity needed to make progress.
8. Before consolidation, inspect results against the current source state and the requester's outcome. Resolve overlap, stale evidence, deviations, and verification gaps before presenting a conclusion.

Read `references/mesh-workflow-patterns.md` only when its coordination options or cautions could change the execution plan.

## Return

Return the consolidated outcome with the evidence, deviations, and unresolved risks the requester needs. Include task handles, monitoring ownership, registered watch or sent signal conditions, and pending retrieval, integration, repair, or full-gate work only when the requester or a new monitoring owner must act on them; do not expose all internal task detail by default.
