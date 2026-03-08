# Repository Guidelines

## Role

This file is the entry point for non-Claude coding agents. Keep it repo-specific and avoid duplicating material owned by `README.org`, `CLAUDE.md`, or `docs/documentation-policy.md`.

## Repo-Critical Rules

- Denix auto-discovers `.nix` files in `hosts/`, `modules/`, and `rices/`; do not depend on cross-module manual imports inside those trees.
- Flakes only read git-tracked files; stage new files before running builds or checks.
- Use `config.sops.secrets.<key>.path` for secrets. Do not hardcode plaintext credentials.
- Use Nix-native workflows for repository changes; avoid ad hoc package-management state outside the flake unless a local module explicitly requires it.

## Pointers

- Canonical documentation policy: `docs/documentation-policy.md`
- Human-facing overview and directory map: `README.org`
- Claude-specific entry guidance: `CLAUDE.md`
- Module-local guidance: `modules/CLAUDE.md`, `modules/config/CLAUDE.md`, `modules/toplevel/CLAUDE.md`
