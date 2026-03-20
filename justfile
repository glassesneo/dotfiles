set quiet

host := "seiran"
keep := "5"

# List available recipes
default:
    @just --list --unsorted

# ── build ──────────────────────────────────────────────

# Full system apply (darwin + home-manager)
switch:
    nh darwin switch . -H {{host}} -Lt

# Full system apply (dry run)
switch-dry:
    nh darwin switch . -H {{host}} -Lt --dry

# Full system apply (confirm before activating)
switch-ask:
    nh darwin switch . -H {{host}} -Lt --ask

# Home-manager only (fastest)
home:
    nh home switch

# Home-manager only (dry run)
home-dry:
    nh home switch --dry

# Build without activation
build:
    nh darwin build . -H {{host}}

# Build home-manager without activation
build-home:
    nh home build

# Switch rice
rice name:
    nh darwin switch . -H {{host}}-{{name}} -Lt

# Safe full deploy: fmt → check → switch
apply: fmt check switch

# Safe home-manager deploy: fmt → check → home
apply-home: fmt check home

# ── check ──────────────────────────────────────────────

# Validate flake
check:
    nix flake check

# Format via treefmt
fmt:
    nix fmt

# Pre-commit combo: fmt → check
lint: fmt check

# ── dev ────────────────────────────────────────────────

# Enter dev shell
develop:
    nix develop

# REPL with darwin config
repl:
    nh darwin repl

# REPL with home-manager config
repl-home:
    nh home repl

# Show flake outputs
show:
    nix flake show

# ── flake ──────────────────────────────────────────────

# Update all flake inputs
update:
    nix flake update

# Update a single flake input
update-input name:
    nix flake lock --update-input {{name}}

# Update all inputs then apply
upgrade: update switch

# ── maintenance ────────────────────────────────────────

# Clean all generations (default keep 5)
clean:
    nh clean all --keep {{keep}}

# Clean user profiles
clean-user:
    nh clean user --keep 3

# Regenerate node lockfile for MCP packages
bun2nix:
    cd node-packages && bun install && bun2nix -o bun.nix
