# modules/config/

## Constants

User metadata is centralized in @modules/config/constants.nix.
Use `constants.username`, `constants.userfullname`, `constants.useremail` instead of literals.

## Colorscheme Registry

Theme palettes are owned by `@modules/config/colorschemes/`.

- Registry option: `myconfig.colorschemes` — nested `attrsOf (attrsOf paletteType)`, keyed by `<scheme>.<variant>`.
- Access a palette: `config.myconfig.colorschemes.<scheme>.<variant>` (e.g., `colorschemes.catppuccin.macchiato`, `colorschemes.everforest."dark-medium"`, `colorschemes.monochrome.default`).
- Active selection: `myconfig.colorscheme` — a resolved `paletteType` object set by the active rice.
- Shared export for consumers: `myconfig.always.args.shared.colorscheme`
- Wallpaper handoff: `myconfig.wallpaper` (consumed by `modules/programs/desktoppr`)

Add/update palette files under `@modules/config/colorschemes/schemes/*.nix`.
Keep values as pure data (`#RRGGBB` + `polarity`), and keep cross-module package logic out of this directory.

## Host Tier Helpers

`modules/config/host-tier.nix` exports the shared arg `tiers` for ordered tier comparisons.
Full semantics and usage: `docs/host-tiers.md`.

## Kiri Wrapper

Kiri MCP uses a wrapper to avoid tree-sitter download issues, implemented in:
- @modules/config/node-packages.nix

Key behavior:
- Wrapper runs `kiri-mcp-server` via `npx` with explicit `PATH`.
- Kiri writes its index to `.kiri/index.duckdb` at repo root.
- Watch mode uses `--watch` and keeps the DuckDB index in `.kiri/`.

## MCP Node Package Management (bun2nix)

MCP server npm packages are managed via bun2nix in `node-packages/`.
To add, update, or remove packages:
```bash
cd node-packages
# Edit package.json
bun install && bun2nix -o bun.nix
git add package.json bun.lock bun.nix
nh home switch
```
