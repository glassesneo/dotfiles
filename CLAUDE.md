# CLAUDE.md

This file is the Claude Code entry point for this repository. Keep it short and pointer-oriented.

## Critical Rules

- **CRITICAL**: Denix auto-discovers `.nix` files under `hosts/`, `modules/`, and `rices/`. Do not wire modules together with manual imports between those trees.
- **CRITICAL**: Flakes only see git-tracked files. `git add` new files before builds or evaluation.
- Prefer local guidance over root guidance when a nearer `CLAUDE.md` exists.

## Fast Path

```bash
nh home switch
nh darwin switch . -H kurogane -Lt
nix flake check
nix develop
```

## Canonical Docs

- Documentation policy: @docs/documentation-policy.md
- Human overview: @README.org
- Module tree guidance: @modules/CLAUDE.md
- Config-specific guidance: @modules/config/CLAUDE.md
- Secrets guidance: @modules/toplevel/CLAUDE.md
