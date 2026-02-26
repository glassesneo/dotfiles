# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview
Denix-based Nix dotfiles for macOS + Home Manager, declarative and modular.
Host: `kurogane` (desktop), user: `neo`.
Key paths: `hosts/`, `modules/`, and `rices/` drive configuration discovery.

## Quick Commands
```bash
nh home switch                        # Home Manager only (FASTEST for userland)
nh darwin switch . -H kurogane -Lt    # Full system (darwin + home-manager)
nix flake check                       # Validate flake structure
nix develop                           # Enter development shell
```

## Critical Denix Rules
- **CRITICAL**: Denix auto-loads ALL .nix files in `paths` — NO imports/exports allowed between modules.
- **CRITICAL**: Nix flakes only read git-tracked files — ALWAYS `git add` new files before building.

## Codebase Organization
- Programs: @modules/programs/
- Services: @modules/services/
- System: @modules/toplevel/
- Hosts: @hosts/
- Config core: @modules/config/
- MCP Node packages: @node-packages/
- Secrets: @secrets/
- Rices: @rices/
- Var artifacts: @var/

## Essential Commands
```bash
nh darwin switch . -H kurogane -Lt --update           # Build with flake update
nh darwin switch . -H kurogane -Lt --update-input nixpkgs
nix flake check
nix flake update
nh clean all --keep 5
```

## Secrets Management (sops-nix)
- All secrets are encrypted via `sops` and stored in host files (currently `@secrets/kurogane.yaml`)
- Shared declarations live in `@modules/toplevel/secrets.nix`
- Host binding lives in `@hosts/kurogane/secrets.nix`
- Dedicated single-owner secrets are declared in their owning module
- Consume secrets via `config.sops.secrets.<key>.path`; use per-tool wrappers for env-var-only tools
