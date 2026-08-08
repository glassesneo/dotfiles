---
name: codebase-exploration
disable-model-invocation: true
description: >-
  Use when one bounded codebase question needs read-only evidence, constraints,
  and implications. Trigger only for an explicit exploration task. Do not use
  for requester-level orchestration, design decisions, implementation, or user
  dialogue.
---

# Codebase Exploration

Investigate one bounded question for its consumer. Own the evidence quality
needed to update the consumer's working model without taking ownership of the
consumer's broader outcome.

## Required Handoff

Require:

- one local question to investigate;
- the context that made the question relevant;
- the included scope and explicit exclusions.

Include starting files or symbols only when the question needs them. This Skill
owns read-only operations, the default report shape, and stop conditions; the
handoff does not restate them.

When required task-specific information is missing and the question cannot be
answered with evidence, do not infer or expand the requesting task. Identify
the missing conditions under `Unknowns` and stop.

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
   evidence for the consumer to evaluate, not a decision that they must be
   followed.
5. Return the smallest complete report that answers the bounded question.

Keep ownership of the bounded question when coordination helps. Use
`task-orchestration` only when an independent contradiction attempt or separate
capability would materially improve the answer. For background peer work, make
the monitoring owner explicit. Pass the needed `agentId`, `taskId`, current
state, and expected follow-up only when the consumer or a new monitoring owner
must act. A terminal notification is not proof of success; use `mesh_get` when
the peer's outcome or evidence matters. External harness agents are not route
endpoints, so a Pi peer must retain their monitoring ownership.

When evidence materially contradicts a known peer task's premise, consider a
bounded signal to the relevant durable Pi consumer instead of expanding this
question. Successful queueing is not acknowledgement that the consumer acted.
Continue to return the requester-facing evidence report.

Do not change source or configuration, ask the user questions, decide the final
design, or direct the consumer's broader task. When a question concerns design
alternatives, report evidence-supported options as implications without making
a final recommendation the center of the result.

## Stop Conditions

Stop when any one condition holds:

- the question has an evidence-backed answer;
- the specified scope has been fully examined;
- required information cannot be reached and the missing condition is known;
- further exploration no longer adds material information to the consumer's
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

Explain what the evidence enables or rules out for the consumer without taking
over its decision.

## Confidence

Separate confirmed facts from inferences and state the confidence basis.
