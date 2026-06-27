# Repository Agent Guidance

## Role

This file is the repo-wide entrypoint for coding agents. Keep it short,
repo-specific, and focused on stable contracts that affect safe changes.

Prefer architecture and ownership boundaries over directory inventories. File
names and tree shape are easy to inspect; guidance files should explain the
non-obvious responsibilities, invariants, and decision rules behind them.

## Repo-Critical Rules

- Denix auto-discovers `.nix` files in `hosts/`, `modules/`, and `rices/`; do not depend on cross-module manual imports inside those trees.
- Flakes only read git-tracked files; stage new files before running builds or checks.
- Use `config.sops.secrets.<key>.path` for secrets. Do not hardcode plaintext credentials.
- Use Nix-native workflows for repository changes; avoid ad hoc package-management state outside the flake unless a local module explicitly requires it.

## Architecture Reading Path

For structural changes, read in this order:

1. `README.org` for the human-facing repository overview.
2. `docs/denix-architecture.md` for Denix ownership, splitting rules, and reference patterns.
3. The nearest local `AGENTS.md` for subtree-local invariants.

Before editing, answer these questions:

- Which architectural owner is responsible: host facts, reusable feature module, shared data/registry, aggregation root, theme data, or documentation?
- Is this pure data, feature wiring, runtime behavior, or broad system/user aggregation?
- Would a nested `enable = false` represent a meaningful user choice?
- Is there already a parent module or aggregation interface that should own this?

## Guidance File Policy

- Use `AGENTS.md` for agent-facing guidance at repo root and in subtrees.
- Keep guidance model-facing: state what the receiving agent needs to know to act safely in that scope.
- Do not duplicate long command catalogs, README overviews, or documentation policy text here.
- When adding local guidance, describe stable architecture constraints and local ownership decisions, not an `ls`-style map.

## Pointers

- Denix architecture and module-splitting guide: `docs/denix-architecture.md`
- Canonical documentation policy: `docs/documentation-policy.md`
- Human-facing overview and directory map: `README.org`
- Module-local guidance examples: `modules/AGENTS.md`, `modules/config/AGENTS.md`, `modules/toplevel/AGENTS.md`
