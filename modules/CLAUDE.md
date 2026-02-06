# modules/

## Denix Architecture

- Module discovery: `paths = [./hosts ./modules ./rices]` auto-imports everything.
- **CRITICAL**: Denix auto-loads ALL .nix files in `paths` — NO imports/exports allowed between modules.
- **CRITICAL**: Nix flakes only read git-tracked files — ALWAYS `git add` new files before building.
- Extension system: `extensions = [args base.withConfig]` wires shared args + base config.
- Rices: Theme variants via `delib.rice`. Each rice sets `myconfig.*`, `home`, `darwin`, or `nixos` attrs.
  - Rices can inherit from others (e.g., `inherits = ["laptop"]`).
  - Switch rice per-host in `hosts/<name>/default.nix` with `rice = "<name>"`.
  - Switch rices: `nh home switch -c kurogane-catppuccin` or `nh darwin switch . -H kurogane-catppuccin -Lt`.
- Platform blocks: `home.ifEnabled` targets `config` for `moduleSystem = "home"` and `config.home-manager.users.neo` for `"darwin"` when HM is enabled.
- Shared arguments: `myconfig.always.args.shared.<key>` pattern for global args.
- Host routing: `delib.host` + conditional config when `config.${myconfigName}.host` matches.

## Module Examples (References Only)

- Minimal: @modules/programs/fd.nix
- With options: @modules/programs/git/default.nix
- Service: @modules/services/aerospace.nix
- Nixvim: @modules/programs/nixvim/

## Build Commands

```bash
# Full system (darwin + home-manager)
nh darwin switch . --hostname kurogane -Lt    # Long form
nh darwin switch . -H kurogane -Lt            # Short form
nh darwin switch . -H kurogane -Lt --dry      # Dry run
nh darwin switch . -H kurogane -Lt --ask      # Confirm before applying
nh darwin switch . -H kurogane -Lt --update   # Update all flake inputs first
nh darwin switch . -H kurogane -Lt --update-input nixpkgs  # Update specific input

# Home Manager only (fastest for userland changes)
nh home switch                  # Default configuration
nh home switch .#neo            # Explicit configuration
nh home switch --dry            # Dry run

# Build without activation
nh darwin build
nh home build
```

## Development and Testing

```bash
nix develop                               # Enter dev shell (deno, emmylua-ls, stylua)
nix flake check                           # Validate flake structure
nix flake show                            # Show available outputs
nix flake update                          # Update all flake inputs
nix flake lock --update-input nixpkgs     # Update specific input
nh darwin repl                            # REPL with darwin config loaded
nh home repl                              # REPL with home-manager config loaded
```

## Cleanup

```bash
nh clean all --keep 5                     # Clean all generations, keep last 5
nh clean user --keep 3                    # Clean current user's profiles only
nh clean profile <profile-path> --keep 5  # Clean specific profile
```
