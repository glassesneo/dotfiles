# modules/programs/nixvim/

## Ownership

- `programs.nixvim` owns Neovim configuration and translates its semantic appearance policy into nixvim/plugin settings. Rices may select that policy but must not own plugin settings, Lua, highlights, or autocmd implementation.
- Keep plugin-specific settings and keymaps with their plugin owner; non-plugin keymaps belong in `extra_config.lua`.
- Keep large Lua blocks in `.lua` files and inline them from Nix. Use `pkgs.replaceVars` when Lua needs Nix-provided paths.

## Cross-Module Contracts

- `nixvimConventions` is the shared helper contract. Use narrow capability flags instead of directly reading another plugin module's options.
- `wrapRc = false` is intentional: nixvim/Home Manager injects `init.lua` directly.
- LSP servers use `package = null` and rely on the intended runtime environment for binaries.
- LSP ownership is refined by `lsp/AGENTS.md`; read it before adding or moving a server.
