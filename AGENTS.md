# Repository Guidelines

## Role

This file is the entry point for non-Claude coding agents. Keep it repo-specific and avoid duplicating material owned by `README.org`, `CLAUDE.md`, or `docs/documentation-policy.md`.

## Repo-Critical Rules

- Denix auto-discovers `.nix` files in `hosts/`, `modules/`, and `rices/`; do not depend on cross-module manual imports inside those trees.
- Flakes only read git-tracked files; stage new files before running builds or checks.
- Use `config.sops.secrets.<key>.path` for secrets. Do not hardcode plaintext credentials.
- Use Nix-native workflows for repository changes; avoid ad hoc package-management state outside the flake unless a local module explicitly requires it.

## Architecture Reading Path

For structural changes, read in this order:

1. `README.org` for the repository overview and directory map.
2. `docs/denix-architecture.md` for Denix-specific ownership, splitting rules, and examples.
3. The nearest local `CLAUDE.md` for subtree-local invariants.

Before editing, answer these questions:

- Which tree owns this change: `hosts/`, `modules/`, `rices/`, or `docs/`?
- Is this pure data, feature wiring, or an aggregation root?
- Would a nested `enable = false` be a meaningful user choice?
- Is there already a parent module or aggregation interface that should own this?

## Pointers

- Denix architecture and module-splitting guide: `docs/denix-architecture.md`
- Canonical documentation policy: `docs/documentation-policy.md`
- Human-facing overview and directory map: `README.org`
- Claude-specific entry guidance: `CLAUDE.md`
- Module-local guidance: `modules/CLAUDE.md`, `modules/config/CLAUDE.md`, `modules/toplevel/CLAUDE.md`
