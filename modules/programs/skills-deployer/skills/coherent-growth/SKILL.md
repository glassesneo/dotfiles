---
name: coherent-growth
description: >-
  Use when planning or implementing a large request with multiple
  responsibilities, building an entire software or configuration system from
  scratch, or rebuilding one step by step. Trigger when the user asks for a
  complete feature set or environment whose parts must be introduced and
  verified incrementally without losing the final scope. Do not use for a small
  local change that clearly follows existing structure, or by itself for
  ordinary architecture, refactoring, testing, prompt-design, or
  approval-workflow tasks.
---

# Coherent Growth

## Purpose

Grow the complete requested system through coherent responsibility increments.
Limit the responsibility width and conceptual load of each iteration without
reducing the settled final scope.

Each increment must be a correct, non-throwaway implementation of its selected
responsibility, verified before the work advances under the outer task
contract.

## Routing Boundary

Use this skill for:

- large requests containing multiple distinguishable responsibilities;
- new software systems or configuration environments built from the ground up;
- incremental restructuring where responsibility or ownership boundaries may
  change;
- work that must keep implementation progress and user understanding aligned;
- requests likely to attract unrequested adjacent features or several new
  concepts at once.

Do not select it for a small local change that has an obvious owner and follows
an existing interface. This skill does not independently provide general
requirements discovery, architecture design, approval gates, testing strategy,
prompt design, or behavior-preserving refactoring technique.

Combine it with more specific skills when those concerns are part of the task.
Keep responsibility-increment selection and conceptual-load control here; leave
the adjacent skill's workflow and artifact formats with that skill.

## Receiver and Inputs

The receiver is a coding or configuration-changing agent that can inspect:

- the current task contract, including settled final scope, constraints, and
  completion conditions;
- the repository's actual architecture, ownership boundaries, and vocabulary;
- available verification surfaces appropriate to the change.

Preserve settled scope and constraints. Use available repository evidence
before requesting more information. Surface a missing decision only when the
next safe responsibility boundary cannot be selected without it, and handle the
decision according to the outer task contract.

## Responsibility Increments

A responsibility increment is the smallest coherent change boundary that has
one purpose and a result distinguishable enough to verify independently from
other increments.

- Define the boundary by purpose, cohesion, and verifiability, not by file
  count, line count, dependency count, or architectural layer.
- Include every file, layer, and related concept needed to make the selected
  responsibility correct.
- Keep a cross-layer change together when splitting it would damage correctness,
  cohesion, or independent verification.
- Exclude unrelated responsibilities, unrequested modes of use, and future
  features from the current increment.
- Produce the smallest correct implementation that satisfies the selected
  responsibility's completion conditions, not a disposable prototype.

## Planning Workflow

When contributing to planning, augment the applicable plan contract rather than
replacing its schema:

1. Preserve the complete final request, constraints, and completion conditions.
2. Map the final scope into coherent responsibility increments.
3. Order the increments by real dependencies and identify prerequisites.
4. Define completion conditions and proportionate verification for each
   increment.
5. Mark boundaries expected to be `structure-changing` or `mixed`.
6. Record work intentionally left for later increments so incremental planning
   cannot silently truncate the final scope.

## Implementation Workflow

For each implementation iteration:

1. Reconfirm the complete requested scope and the responsibilities that remain.
2. Select one dependency-ready responsibility under the outer task contract.
3. Introduce only the concepts required to implement that responsibility
   correctly and durably.
4. Classify the change as `structure-following`, `structure-changing`, or
   `mixed`.
5. Verify the result with checks proportionate to its size and risk, using the
   repository's available verification surfaces.
6. Place each introduced major concept in the repository's real ownership
   model and vocabulary. Do not impose a universal layer model that the
   repository does not use. If no ownership model exists yet, make the
   boundaries established by this increment explicit and state the role each
   major concept plays within them.
7. Apply the readiness conditions for the change classification.
8. Report the completed responsibility, evidence, remaining responsibilities,
   and next dependency-ready candidate.

The outer task contract decides whether to continue autonomously, request user
approval, or stop. This skill neither adds nor bypasses a continuation gate.

## Change Classification and Readiness

### `structure-following`

The increment follows existing responsibility boundaries, dependency direction,
and public contracts. It is ready for the next increment after its completion
conditions, verification, and required iteration report are satisfied.

### `structure-changing`

The increment changes responsibility ownership, dependency direction, a public
interface, a module boundary, a persistent format, or a hard-to-change external
boundary. Before it is ready for the next increment:

- identify the resulting responsibility and ownership boundaries;
- make the resulting dependency direction explicit;
- account for affected public contracts and hard-to-change external boundaries;
- verify the changed structure and the responsibility's behavior.

### `mixed`

The increment contains both structure-following work and a boundary-changing
part that belong to one coherent responsibility. Apply all
`structure-changing` readiness conditions to the boundary-changing part before
advancing.

When later evidence changes the understanding behind an earlier increment,
restructuring that increment is not itself a failure. Treat the revision as a
new `structure-changing` or `mixed` increment, keep unrelated responsibilities
out of it, and apply the corresponding verification and readiness conditions.

## Extensibility

Preserve existing extension seams and avoid unnecessary irreversible coupling.
Treat extensibility as keeping the current increment from needlessly closing
future options, not as implementing future features now.

Introduce a new abstraction or extension point only when justified by at least
one of:

- the current requirements;
- multiple implementations that already exist;
- a public API, persistent format, or external-system boundary that will be
  difficult to change later.

Loading this skill is not evidence for adding a plugin system, registry, loader,
factory, fallback path, configuration option, helper API, or other speculative
machinery.

## Iteration Output Contract

Use the output shape required by the current task or another owning skill. In
that output, include at least:

- the completed responsibility and exact change scope;
- introduced major concepts and their established or newly declared owners;
- the change classification and, for `structure-changing` or `mixed`, the
  resulting boundary and dependency-direction account;
- verification actually run and its actual result;
- incomplete responsibilities, the next candidate, and whether the work is
  ready to advance under the outer task contract.

Do not create a new durable artifact schema. When a durable plan, report, or
other artifact is required, use the skill that owns that artifact format.

## Quality Gates

Before completing an increment, confirm that:

- the responsibility map still covers the settled final scope;
- the current increment has one coherent purpose and an independently
  verifiable result;
- related cross-file or cross-layer work was not split merely to make the diff
  look smaller;
- verification evidence supports the claimed result;
- introduced major concepts have identifiable established or newly declared
  owners;
- unrelated responsibilities and unrequested adjacent features remain outside
  the increment;
- no abstraction or plugin-style architecture was introduced merely for
  hypothetical future use;
- classification-specific readiness conditions are satisfied before advancing.
