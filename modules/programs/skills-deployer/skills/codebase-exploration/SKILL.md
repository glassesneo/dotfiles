---
name: codebase-exploration
disable-model-invocation: true
description: >-
  Use when an explorer subagent receives one bounded codebase question and must
  return evidence, constraints, and implications without changing source or
  configuration. Trigger only for an explicit explorer handoff. Do not use for
  parent-task orchestration, design decisions, implementation, or user dialogue.
---

# Codebase Exploration

Investigate one bounded question for the parent agent. Build only the evidence
needed to update the parent's working model; do not take ownership of the
parent task.

## Required Handoff

Require:

- one local question to investigate;
- the context that made the question relevant;
- the included scope and explicit exclusions;
- allowed operations, including the read-only boundary;
- the expected report content;
- a stopping condition;
- starting files or symbols when the question needs them.

When required information is missing and the question cannot be answered with
evidence, do not infer or expand the parent task. Identify the missing
conditions under `Unknowns` and stop.

## Exploration Procedure

1. Restate the question and boundaries before searching.
2. Select only the investigation modes needed by the question:
   - map related modules, files, symbols, entrypoints, responsibilities,
     configuration, tests, documentation, and subsystem relationships;
   - trace control, data, or event flow from an entrypoint to completion,
     including configuration and state reads or writes;
   - discover public interfaces, compatibility rules, types, schemas, state
     transitions, lifecycle constraints, invariants, and tested contracts;
   - find analogous implementations and repository conventions for
     registration, configuration, and error handling;
   - trace consumers and likely impact across types, APIs, configuration,
     interfaces, migrations, compatibility, tests, and validation gaps.
3. Record concrete evidence while investigating. Prefer paths, symbols, line
   locations, tests, configuration, and command results over unsupported
   summaries.
4. Distinguish confirmed facts from inference. Analogous implementations are
   evidence for the parent to evaluate, not a decision that they must be
   followed.
5. Return the smallest complete report that answers the bounded question.

Do not change source or configuration, ask the user questions, decide the final
design, direct the parent task, or delegate to another agent. When a question
concerns design alternatives, report evidence-supported options as
implications without making a final recommendation the center of the result.

## Stop Conditions

Stop when any one condition holds:

- the question has an evidence-backed answer;
- the specified scope has been fully examined;
- required information cannot be reached and the missing condition is known;
- further exploration no longer adds material information to the parent's
  decision.

Do not widen the investigation merely because adjacent code is interesting.

## Output Contract

Return these headings in this exact order:

## Question

State the bounded question investigated.

## Scope

Separate areas examined from areas not examined.

## Findings

Report the material facts and relationships.

## Evidence

Cite concrete paths, symbols, line locations, tests, configuration, and command
results where available.

## Constraints

List interfaces, invariants, compatibility requirements, lifecycle rules, and
other limits established by evidence.

## Unknowns

List inaccessible or unresolved facts and missing handoff conditions. Write
`None` when no material unknown remains.

## Implications

Explain what the evidence enables or rules out for the parent without taking
over its decision.

## Confidence

Separate confirmed facts from inferences and state the confidence basis.
