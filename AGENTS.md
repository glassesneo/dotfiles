# Repository Agent Guidance

## Repo-Critical Rules

- Denix auto-discovers `.nix` files in `hosts/`, `modules/`, and `rices/`; do not depend on cross-module manual imports inside those trees.
- Flakes only read git-tracked files; stage new files before running builds or checks.
- Use `config.sops.secrets.<key>.path` for secrets. Do not hardcode plaintext credentials.
- Use Nix-native workflows for repository changes; avoid ad hoc package-management state outside the flake unless a local module explicitly requires it.

## Reading Path

1. `docs/denix-architecture.md` for the canonical ownership and architecture contract.
2. The nearest local `AGENTS.md` for subtree-local deltas.
3. `README.org` for human-facing orientation when needed.

## Guidance Policy

- Keep local guidance to durable ownership, invariants, and decision rules not already owned by an ancestor or canonical document.
- Do not use guidance files as directory inventories or duplicate human-facing documentation.
- Follow `docs/documentation-policy.md` when deciding where durable documentation belongs.
