# Repository Agent Guidance

## Reading Path

1. Read `docs/architecture.md` before changing directory ownership, flake outputs, or command boundaries.
2. Use `README.org` for the operator-facing workflow.

## Repository Rules

- Denix discovers `abstractions/**/default.nix`; keep abstractions independent instead of adding cross-module import chains.
- Put support for module systems not provided by Denix in `adapters/`.
- Flakes only see Git-tracked files. Stage new files before evaluation.
- `tests/<name>/default.nix` must be a sandboxed flake check. Keep live system mutation in `scripts/` and expose it through a thin `justfile` recipe.
- Test repository-owned behavior that lower validation layers do not already cover; do not retest trusted upstream APIs.
- Keep agent guidance to project-specific facts and decision rules. Put architecture and operator instructions in their canonical documents.

## Validation

Run `nix fmt`, then the narrowest relevant check. Before completion, run `nix flake check`. Report unavailable live or platform validation as unavailable, not passed.
