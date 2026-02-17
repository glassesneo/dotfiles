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

## Secrets Management (Agenix)
- All secrets encrypted via agenix, centrally managed in @secrets/
- **Adding new host**: See @secrets/README.md#adding-a-new-host
- **Adding new secret**: See @secrets/README.md#adding-a-new-secret
- **Per-host config**: Each host explicitly declares which secrets to export in `hosts/<hostname>/agenix.nix`
- All hosts can decrypt all secrets; export selection provides granular control
