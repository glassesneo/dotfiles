# modules/programs/nixvim/lsp/

## Ownership

- `default.nix`: shared `defaultServer`/`mkServer`, PATH-gated manifest bridge, Lua assembly order.
- `servers-store-pinned.nix`: schema-backed servers with store-pinned binaries or always-available commands.
- `servers-path-gated.nix`: schema-backed servers that stay `activate = false` in Nix and only enable from Lua when their executable is present in `PATH`.
- `servers-exceptions.nix`: efm and its supporting packages (nls, nickel, treefmt wrapper from flake `inputs.treefmt-nix`).
- `lsp-format.nix`: patched `lsp-format` package and its allowlist. `nixd` is excluded so `.nix` formatting has one owner (`efm` -> `treefmt` -> `alejandra`).
- `servers-lua-only.lua`: non-schema servers and Lua-only config blocks; keep `lua_only_executables` here.
- `exceptions.lua`: runtime-only efm config and `exception_executables`. Nix, Lua, and shell formatters delegate to `treefmt --stdin` so treefmt selects the correct backend (alejandra, stylua, shfmt).
- `activation.lua`: the only place that calls `vim.lsp.enable`; it consumes `path_gated_executables`, `lua_only_executables`, and `exception_executables` in that order.

Copilot LSP ownership has moved to `modules/programs/nixvim/plugins/copilot/`.

## Decision Guide

- If nixvim has schema support and the binary is store-pinned or always available, edit `servers-store-pinned.nix`.
- If nixvim has schema support but the binary is expected from the project environment, edit `servers-path-gated.nix` and the manifest in `default.nix` together.
- If nixvim lacks schema support or the config needs Lua-only APIs, edit `servers-lua-only.lua`.
- Treat `efm` as a deliberate exception; update both exception files when its split ownership changes.
