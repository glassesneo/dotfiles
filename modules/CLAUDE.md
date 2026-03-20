# modules/

## Denix Architecture

- Module discovery: `paths = [./hosts ./modules ./rices]` auto-imports everything.
- **CRITICAL**: Denix auto-loads ALL .nix files in `paths` — NO imports/exports allowed between modules.
- **CRITICAL**: Nix flakes only read git-tracked files — ALWAYS `git add` new files before building.
- Extension system: `extensions = [args base.withConfig]` wires shared args + base config.
- Rices: Theme variants via `delib.rice`. Each rice sets `myconfig.*`, `home`, `darwin`, or `nixos` attrs.
  - Rices can inherit from others (e.g., `inherits = ["laptop"]`).
  - Switch rice per-host in `hosts/<name>/default.nix` with `rice = "<name>"`.
  - Switch rices: `nh home switch -c seiran-everforest` or `nh darwin switch . -H seiran-everforest -Lt`.
- Platform blocks: `home.ifEnabled` targets `config` for `moduleSystem = "home"` and `config.home-manager.users.neo` for `"darwin"` when HM is enabled.
- Shared arguments: `myconfig.always.args.shared.<key>` pattern for global args.
- Host routing: `delib.host` + conditional config when `config.${myconfigName}.host` matches.

## Module Examples (References Only)

- Minimal: @modules/programs/fd.nix
- With options: @modules/programs/git/default.nix
- Service: @modules/services/aerospace.nix
- Nixvim: @modules/programs/nixvim/

## Build Commands

All common commands have `just` aliases (run `just` to list). The underlying commands:

```bash
# Full system (darwin + home-manager)
just switch                                              # nh darwin switch . -H <host> -Lt
just switch-dry                                          # + --dry
just switch-ask                                          # + --ask
just rice catppuccin                                     # switch to a different rice
just apply                                               # fmt → check → switch

# Home Manager only (fastest for userland changes)
just home                                                # nh home switch
just home-dry                                            # + --dry
just apply-home                                          # fmt → check → home

# Build without activation
just build                                               # nh darwin build . -H <host>
just build-home                                          # nh home build

# Override the default `seiran` target: just host=kurogane switch
```

## Development and Testing

```bash
just develop                              # nix develop (dev shell with deno, emmylua-ls, stylua, just)
just fmt                                  # nix fmt (treefmt)
just check                                # nix flake check
just lint                                 # fmt → check
just show                                 # nix flake show
just update                               # nix flake update
just update-input nixpkgs                 # nix flake lock --update-input <name>
just repl                                 # nh darwin repl
just repl-home                            # nh home repl
```

## Cleanup

```bash
just clean                                # nh clean all --keep 5
just clean-user                           # nh clean user --keep 3
just keep=3 clean                         # override keep count
```
