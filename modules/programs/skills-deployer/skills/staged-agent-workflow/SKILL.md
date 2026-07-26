---
name: staged-agent-workflow
disable-model-invocation: true
description: >-
  Use when a primary agent must coordinate an approval-gated design or
  implementation workflow through delegated capabilities. Trigger for staged
  workflows that select design-only, design-then-implement, or implement
  profiles. Do not use for direct specialist work that has no staged user
  dialogue or approval boundary.
---

# Staged Agent Workflow

Coordinate staged work from the active primary context. Keep user dialogue,
candidate summaries, approvals, capability selection, and minimal handoffs in
the primary. Run each action through the locally mapped capability. When the
active primary provides a mapped artifact-authoring or implementation
capability, it performs that action directly instead of delegating to itself.

## Required Input

The invoking prompt must provide:

- one profile from `references/profiles.md`;
- the target or governing artifact references;
- a local mapping for every capability required by that profile.

Read `references/profiles.md` before executing the selected profile and
`references/capability-handoffs.md` before delegating.

If a required capability, permission, governing artifact, or required skill is
unavailable, report the blocker. Do not silently substitute a capability with
different write, approval, validation, review, or report behavior.

## Capability Contract

Profiles may require these capabilities:

- **design author**: runs the design dialogue and creates or revises the
  implementation-ready `design` artifact and its companion decision record,
  through `specification-design` or `ideation-design`;
- **source-changing implementer**: changes source or configuration within an
  authorized contract;
- **validation runner**: runs focused checks and triages failures without
  editing repository source;
- **read-only reviewer**: inspects completed work without changing it;
- **report writer**: loads `agent-artifact` and creates the required durable
  report using its canonical filename and format contract.

The active primary may provide one or more capabilities when its permissions
and role satisfy each capability. Do not create a self-handoff: apply the
confirmed contract directly. Testing and review remain delegated capabilities
rather than user-facing workflow stages.

## Governing Context

When artifacts conflict, use `design > implementation report`. A decision
record explains history only and never overrides the design. Treat a recorded
implementation-report deviation as reviewer and tester attention, not
permission to diverge from the design.

Send delegates only confirmed decisions, governing paths, essential evidence,
and their local output contract. Apply the same minimal-input rule when the
active primary owns the capability. Keep rejected alternatives, tentative
reasoning, conversation history, routing mechanics, and parent orchestration
out of handoffs.

## Completion

Return the created artifact paths, implementation outcome when applicable,
validation and review results, blockers, unresolved risks, and the reason any
normally required artifact was skipped.
