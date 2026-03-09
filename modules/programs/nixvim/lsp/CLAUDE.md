# modules/programs/nixvim/lsp/

## Ownership

- `default.nix`: shared `defaultServer`/`mkServer`, PATH-gated manifest bridge, Lua assembly order.
- `servers-store-pinned.nix`: schema-backed servers with store-pinned binaries or always-available commands.
- `servers-path-gated.nix`: schema-backed servers that stay `activate = false` in Nix and only enable from Lua when their executable is present in `PATH`.
- `servers-exceptions.nix`: explicit Nix-side exceptions like `copilot` plus related package provisioning that should not hide in the root module.
- `lsp-format.nix`: patched `lsp-format` package and its allowlist.
- `servers-lua-only.lua`: non-schema servers and Lua-only config blocks; keep `lua_only_executables` here.
- `exceptions.lua`: runtime-only exception behavior; keep `efm` config, `copilot` root policy, and `exception_executables` here.
- `activation.lua`: the only place that calls `vim.lsp.enable`; it consumes `path_gated_executables`, `lua_only_executables`, and `exception_executables` in that order.

## Decision Guide

- If nixvim has schema support and the binary is store-pinned or always available, edit `servers-store-pinned.nix`.
- If nixvim has schema support but the binary is expected from the project environment, edit `servers-path-gated.nix` and the manifest in `default.nix` together.
- If nixvim lacks schema support or the config needs Lua-only APIs, edit `servers-lua-only.lua`.
- Treat `copilot` and `efm` as deliberate exceptions; update both exception files when their split ownership changes.
