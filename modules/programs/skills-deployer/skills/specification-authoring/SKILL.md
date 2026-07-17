---
name: specification-authoring
description: >-
  Use when creating or revising a decision-ready specification from a request.
  Covers specification discovery, candidate approval, persistence, and readiness;
  do not use for implementation planning, source changes, or reports.
---

# Specification Authoring

Create or revise one decision-ready specification. This Skill owns the
specification's authoring and approval contract, not planning, implementation,
delegation, reports, or physical storage behavior.

## Required Input

Start from the user's request and any governing artifacts they identify. Use
available repository and external evidence to resolve discoverable facts before
treating an ambiguity as a user decision.

Ask only about missing decisions that can materially change scope,
architecture, interfaces, compatibility, acceptance criteria, constraints, or
verification. Do not invent those decisions. If they remain unresolved, report
that the specification is not decision-ready.

## Authoring Workflow

1. Establish the problem, user goal, governing evidence, and material decision
   boundaries.
2. Resolve discoverable facts and surface costly unresolved choices as bounded
   questions.
3. Present a concise candidate specification, including material defaults and
   deferrals.
4. Obtain explicit user approval of the candidate before persistence. Do not
   create or revise an artifact before that approval.
5. After approval, persist exactly one specification unless the approved
   request explicitly revises an existing one. Use an available runtime
   artifact writer with logical kind `spec`.
6. If no runtime artifact writer contract is available, stop and report the
   blocker instead of inventing storage behavior.

If approved content must materially change before persistence, present the
revised candidate and obtain approval again.

## Decision-Ready Content

The specification must include:

- title and summary;
- problem and user goal;
- acceptance criteria;
- in-scope and out-of-scope work;
- constraints and non-goals;
- implementation, review, and testing correctness criteria;
- risks and mitigations;
- blocking and non-blocking open questions;
- chosen defaults and intentional deferrals;
- affected repository areas;
- useful evidence notes.

Use `Status: decision-ready` only when implementation can proceed without
inventing scope, interfaces, or acceptance criteria. Otherwise identify the
blocking decisions and do not represent the artifact as ready.

## Completion Output

Return:

- `Spec file: <artifact path | none>`
- `Status: <decision-ready | not decision-ready>`
- `Summary: <concise summary>`
- `Blocking questions: <none | concise list>`
- `Non-blocking questions/defaults/deferrals: <none | concise list>`

Use `Spec file: none` when no artifact was persisted because approval,
readiness, or the writer contract is missing. Never fabricate an artifact path.
