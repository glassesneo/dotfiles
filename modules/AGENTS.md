# modules/

## Denix Architecture

- Module discovery: `paths = [./hosts ./modules ./rices]` auto-imports everything.
- **CRITICAL**: Denix auto-loads ALL .nix files in `paths` — NO imports/exports allowed between modules.
- **CRITICAL**: Nix flakes only read git-tracked files — ALWAYS `git add` new files before building.
- Canonical architecture guide: `docs/denix-architecture.md`
- Extension system: `extensions = [args base.withConfig]` wires shared args + base config.
- Rices are theme variants via `delib.rice`; they set data-shaped values that feature modules interpret.
- Platform blocks: `home.ifEnabled` targets `config` for `moduleSystem = "home"` and `config.home-manager.users.neo` for `"darwin"` when HM is enabled.
- Shared arguments: `myconfig.always.args.shared.<key>` pattern for global args.
- Host routing: `delib.host` + conditional config when `config.${myconfigName}.host` matches.

## Reference Patterns

- Minimal: @modules/programs/fd.nix
- With options: @modules/programs/git/default.nix
- Parent + child feature: @modules/programs/ghostty/default.nix and @modules/programs/ghostty/quick-terminal/default.nix
- Parent + cascade child feature: @modules/programs/nixvim/plugins/orgmode/
- Aggregation root: @modules/toplevel/nix-darwin/system/ime.nix
- Contributor to aggregation root: @modules/programs/aquaskk/default.nix
- Pure data boundary: @modules/config/colorschemes/ and @rices/
- Service: @modules/services/aerospace.nix
- Nixvim: @modules/programs/nixvim/

## Boundary Cheat Sheet

- `modules/config/` owns shared data, registries, and helper exports.
- `modules/programs/` owns user-facing tool wiring.
- `modules/services/` owns desktop/background services.
- `modules/toplevel/` owns broad system/user wiring and aggregation interfaces.
- Child modules are worth creating when `enable = false` on the child is a meaningful user choice.
- If multiple features feed one shared OS/user surface, prefer a centralized aggregation interface over direct writes from feature modules.

## Local Guidance

- Keep module guidance about ownership, invariants, and split decisions rather than command catalogs or file inventories.
- Use `README.org` and `just` for human-facing command discovery.
- Use `docs/denix-architecture.md` when changing module boundaries or adding new aggregation surfaces.
