---
name: architecture-planning-perspective
description: Apply architecture-first planning lens for module boundaries, dependency direction, and staged refactor/migration safety. Use only when the user explicitly asks for architecture-focused planning.
---

# Architecture Planning Perspective

Use this skill only when the user explicitly asks for architecture-focused planning.

## Focus

Prioritize decisions that improve structure and long-term maintainability:

- module boundaries and ownership
- dependency direction and coupling reduction
- contract compatibility between components
- staged migration sequencing and rollback safety

## Required Planning Checks

1. Architecture intent and constraints
- clarify architectural target and non-negotiable constraints
- identify boundaries that must remain stable

2. Dependency map and risk
- identify dependency direction problems and cycles
- call out blast radius for each planned change

3. Staged refactor path
- split work into phases that preserve system operability
- define compatibility expectations per phase

4. Rollback and recovery
- define rollback trigger conditions
- define what state must be restorable per stage

5. Verification
- include repository-level checks for each stage
- include acceptance criteria tied to architecture outcomes

## Output Adaptation

When contributing to a plan, emphasize:

- architectural rationale per step
- phase-by-phase migration ordering
- explicit compatibility notes
- risks and mitigations tied to boundaries and dependencies
