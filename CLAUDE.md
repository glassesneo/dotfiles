# CLAUDE.md

This file is the Claude Code entry point for this repository. Keep it short and pointer-oriented.

## Critical Rules

- **CRITICAL**: Denix auto-discovers `.nix` files under `hosts/`, `modules/`, and `rices/`. Do not wire modules together with manual imports between those trees.
- **CRITICAL**: Flakes only see git-tracked files. `git add` new files before builds or evaluation.
- Prefer local guidance over root guidance when a nearer `CLAUDE.md` exists.

## Fast Path

A `justfile` provides short aliases for all common commands. Run `just` to list recipes.

```bash
just home          # nh home switch
just switch        # nh darwin switch . -H <host> -Lt
just check         # nix flake check
just develop       # nix develop
just apply         # fmt → check → switch (safe full deploy)
```

## Canonical Docs

- Documentation policy: @docs/documentation-policy.md
- Human overview: @README.org
- Module tree guidance: @modules/CLAUDE.md
- Config-specific guidance: @modules/config/CLAUDE.md
- Secrets guidance: @modules/toplevel/CLAUDE.md
