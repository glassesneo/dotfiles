---
name: staged-agent-workflow
description: >-
  Use when a primary agent must coordinate an approval-gated specification,
  planning, or implementation workflow through delegated capabilities. Trigger
  for staged workflows that select spec-only, plan-only, spec-then-plan,
  plan-then-implement, or implement profiles. Do not use for direct specialist
  work that has no staged user dialogue or approval boundary.
---

# Staged Agent Workflow

Coordinate staged work from a non-source-writing primary context. Keep user
dialogue, candidate summaries, approvals, capability selection, and minimal
handoffs in the primary. Delegate artifact creation, source changes,
validation, and review to capabilities that locally own those actions.

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

- **specification author**: creates or revises decision-ready spec artifacts;
- **implementation planner**: creates complete or explicitly bounded-partial
  plan artifacts;
- **source-changing implementer**: changes source or configuration within an
  authorized contract;
- **validation runner**: runs focused checks and triages failures without
  editing repository source;
- **read-only reviewer**: inspects completed work without changing it;
- **report writer**: loads `agent-reports` and creates the required durable
  report using its canonical filename and format contract.

One local agent may provide more than one capability only when its permissions
and role actually satisfy each capability. Testing and review remain delegated
capabilities rather than user-facing workflow stages.

## Governing Context

When artifacts conflict, use `spec > implementation report > plan`. Treat a
recorded implementation-report deviation as reviewer and tester attention, not
permission to diverge from the spec.

Send delegates only confirmed decisions, governing paths, essential evidence,
and their local output contract. Keep rejected alternatives, tentative
reasoning, conversation history, routing mechanics, and parent orchestration
out of handoffs.

## Completion

Return the created artifact paths, implementation outcome when applicable,
validation and review results, blockers, unresolved risks, and the reason any
normally required artifact was skipped.
