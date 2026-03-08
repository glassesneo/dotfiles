# Documentation Policy

## Purpose

This repository keeps documentation minimal by default. Document stable constraints, safety-critical workflows, and non-obvious local invariants once. Leave volatile details undocumented unless they are required to use or modify the repository safely.

## Audiences And Owners

| Document | Primary audience | Owns |
| --- | --- | --- |
| `README.org` | Humans | Repository overview, major directory map, durable onboarding context |
| `CLAUDE.md` | Claude Code | Short runtime reminders, critical repository rules, pointers to deeper docs |
| `AGENTS.md` | Other coding agents | Repo-specific agent entry guidance that is not already owned elsewhere |
| `docs/documentation-policy.md` | Maintainers and agents editing docs | Canonical rules for what to document, what to omit, and where documentation belongs |
| Local `CLAUDE.md` / `README.md` | People and agents working in a subtree | Module-local invariants, workflows, and examples that do not belong at repo root |
| Source comments / doc comments | Maintainers editing a file | Non-obvious behavior, invariants, and constraints that are easiest to keep correct next to code |

Every statement should have one clear owner. If the same guidance appears in multiple files, keep the canonical copy and replace the rest with a short pointer.

## Allowed Documentation Locations

- Use `README.org` at repo root for the human landing page.
- Use root `CLAUDE.md` and `AGENTS.md` only as concise entry points for their respective tools.
- Use `docs/` for stable cross-cutting policy or runbooks that are too detailed for root entry-point files.
- Use local `CLAUDE.md` or `README.md` files for subtree-specific guidance.
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

### `CLAUDE.md`

Keep:
- Highly stable runtime reminders Claude Code needs immediately
- Pointers to this policy and to local `CLAUDE.md` files

Avoid:
- Full repository overview duplicated from `README.org`
- Detailed secrets workflows and long command lists
- Generic methodology that already exists in global Claude instructions

### `AGENTS.md`

Keep:
- Repo-specific guidance needed by non-Claude agents on entry
- Pointers to canonical docs instead of restating them

Avoid:
- Repeating the same repository manual found in `README.org`
- Repeating shared methodology maintained outside this repository
- Detailed policy text copied from this file

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

Create a local `CLAUDE.md` or `README.md` only when a subtree has stable rules that would distract from root docs.

Local docs should:
- Focus on that subtree's responsibilities and constraints
- Link to the root policy instead of re-explaining it
- Avoid repeating root-wide build or secrets guidance unless the subtree changes the rule

## Maintenance Expectations

- When editing docs, remove duplication instead of copying updated text into multiple places.
- When a rule changes, update the canonical owner first and trim stale copies in the same change.
- When deleting a doc, first check for references in code and docs.
- When adding a new doc, state its audience and why an existing owner was insufficient.

## Current Canonical Pointers

- Secrets rotation runbook: `docs/secrets-key-rotation.md`
- Module-specific guidance examples: `modules/CLAUDE.md`, `modules/config/CLAUDE.md`, `modules/toplevel/CLAUDE.md`
