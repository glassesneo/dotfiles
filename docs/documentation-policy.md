# Documentation Policy

## Purpose

This repository keeps documentation minimal by default. Document stable constraints, safety-critical workflows, and non-obvious local invariants once. Leave volatile details undocumented unless they are required to use or modify the repository safely.

## Audiences And Owners

| Document | Primary audience | Owns |
| --- | --- | --- |
| `README.org` | Humans | Repository overview, major directory map, durable onboarding context |
| `AGENTS.md` | Coding agents | Repo-specific agent entry guidance that is not already owned elsewhere |
| `docs/documentation-policy.md` | Maintainers and agents editing docs | Canonical rules for what to document, what to omit, and where documentation belongs |
| Local `AGENTS.md` / `README.md` | People and agents working in a subtree | Module-local invariants, workflows, and examples that do not belong at repo root |
| Source comments / doc comments | Maintainers editing a file | Non-obvious behavior, invariants, and constraints that are easiest to keep correct next to code |

Every statement should have one clear owner. If the same guidance appears in multiple files, keep the canonical copy and replace the rest with a short pointer.

## Allowed Documentation Locations

- Use `README.org` at repo root for the human landing page.
- Use root `AGENTS.md` only as the concise agent entry point.
- Use `docs/` for stable cross-cutting policy or runbooks that are too detailed for root entry-point files.
- Use local `AGENTS.md` or `README.md` files for subtree-specific guidance.
- Use comments in `.nix` and support files for local invariants that are hard to infer from structure alone.

Do not create a new root-level guidance file unless an existing owner cannot reasonably hold the content.

## Root File Boundaries

### `README.org`

Keep:
- What the repository is
- Major directories and durable architecture orientation
- High-level workflows a human needs to get started

Avoid:
- Agent-specific prompting guidance
- Full copies of operational runbooks
- Long command catalogs that are better kept near the relevant tool or subtree

### `AGENTS.md`

Keep:
- Repo-specific guidance needed by coding agents on entry
- Pointers to canonical docs instead of restating them
- Stable architecture and ownership boundaries that are not obvious from file listings

Avoid:
- Repeating the same repository manual found in `README.org`
- Repeating shared methodology maintained outside this repository
- Detailed policy text copied from this file
- Directory inventories that are easier to inspect directly

## What To Document

Document when at least one of these is true:

- The rule is stable and likely to remain true across routine config churn.
- Missing the rule would cause broken builds, invalid evaluation, or unsafe changes.
- The behavior is non-obvious from file names, option names, or surrounding code.
- A human or agent must know where to find the authoritative owner for a workflow.
- The knowledge is local to a subtree and would be expensive to rediscover repeatedly.

Good examples in this repository:

- Denix auto-discovery constraints
- The git-tracked-file requirement for flakes
- Secrets ownership and the canonical runbook location
- Module-local constraints such as palette data rules or wrapper behavior

## What To Leave Undocumented

Normally do not document:

- Facts obvious from directory names or simple code reading
- Volatile inventories of modules, packages, or host tweaks that change frequently
- Step-by-step instructions that merely restate a command's help output
- Temporary migration notes after the migration is complete
- Generic agent methodology already maintained in upstream or global instructions

If a detail changes often but still matters, prefer a short pointer to the owning file instead of copying the detail into another doc.

## Colocated Comment Rules

Prefer source comments or doc comments over external docs when the information is tightly bound to one file or expression.

Add comments for:
- Non-obvious invariants
- Safety constraints
- Workarounds for external tool behavior
- Data-shape assumptions that are easy to break during refactors

Skip comments for:
- Trivial assignments
- Repetition of option names
- Broad repository policy that belongs in this file or a local guide

## Local Documentation Rules

Create a local `AGENTS.md` or `README.md` only when a subtree has stable rules that would distract from root docs.

Local docs should:
- Focus on that subtree's responsibilities and constraints
- Prefer architecture ownership and stable invariants over physical file inventories
- Link to the root policy instead of re-explaining it
- Avoid repeating root-wide build or secrets guidance unless the subtree changes the rule

## Maintenance Expectations

- When editing docs, remove duplication instead of copying updated text into multiple places.
- When a rule changes, update the canonical owner first and trim stale copies in the same change.
- When deleting a doc, first check for references in code and docs.
- When adding a new doc, state its audience and why an existing owner was insufficient.

## Current Canonical Pointers

- Secrets rotation runbook: `docs/secrets-key-rotation.md`
- Module-specific guidance examples: `modules/AGENTS.md`, `modules/config/AGENTS.md`, `modules/toplevel/AGENTS.md`
