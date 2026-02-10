# modules/programs/nixvim/

## Overview

Full Neovim configuration via nixvim. Module name: `programs.nixvim`.

## Architecture

- **65+ files** across plugins, LSP, AI workflows, and DPP (Denops plugin manager).
- `wrapRc = false` — nixvim injects init.lua directly via Home Manager, no wrapper script.
- Large Lua blocks live in `.lua` files, inlined via `builtins.readFile`.
- `pkgs.replaceVars` used for path injection (dpp hooks, plugin dirs, SKK dicts).
- LSP servers use `package = null` — trusts system PATH for binaries.

## Shared Conventions (helpers.nix)

- `nixvimConventions` is exposed via `myconfig.always.args.shared.nixvimConventions` and available as a function arg in all modules.
- **Keymap ownership matrix** (`keymapOwnership.smartPicker`, `.grep`, `.explorer`): Resolves contested keys (`<Space><Space>`, `<Space>g`, `<Space>f`) to a single owner based on enabled plugins. Priority: snacks > fzf-lua/oil > null.
- **Capability contracts** (`capabilities.hasIncRename`, `.hasCodeCompanion`): Boolean flags consumed by `ui.nix` and `img-clip.nix` instead of direct cross-plugin option reads.
- **IMPORTANT**: When adding new contested keymaps or cross-plugin dependencies, extend `helpers.nix` rather than reading `homeConfig.programs.nixvim.plugins.*` directly.

## Plugin Organization

- **Lazy loading**: Most plugins use `lz.n` with event/cmd/ft triggers.
- **DPP (Denops plugin manager)**: Manages editing/motion/SKK plugins via TOML configs generated from Nickel.
  - Source of truth: `.ncl` files. TOML is generated from Nickel and loaded from the config plugin dir.
  - Regenerate helper (optional/manual): `nix develop -c bash plugins/dpp/regenerate-toml.sh`
  - Plugin definitions live in Nickel: `plugins/dpp/plugins/{editing,motion,skk}.ncl`
  - Generated TOML artifacts may be local/untracked and are not required git snapshots.
  - Nickel contract validation: `plugins/dpp/plugins/plugins_contract.ncl`
  - State cached in `$XDG_CACHE_HOME/dpp/`. Commands: `:DppInstall`, `:DppUpdate`, `:DppClearState`.
- **Completion**: blink-cmp with LSP, path, buffer, ripgrep, copilot, snippets, git sources.
- **AI** (`plugins/ai/`): codecompanion split into four `delib.module` files:
  - `default.nix` — composition root (copilot, strategies, display, lazy keys)
  - `adapters.nix` — all adapter registrations (http + acp)
  - `workflows.nix` — prompt_library entries (TDD, refactor-test, plan, implementation)
  - `extensions.nix` — extensions (history, mcphub), extraPlugins, extraConfigLua
- **UI**: snacks.nvim (picker, explorer, notifier), noice, fidget, bufferline, lualine.

## LSP Configuration

- **Nix-managed servers** (`lsp/default.nix`): Use `defaultServer` / `mkServer` helpers. Add new servers here if nixvim has schema support.
- **Lua-managed servers** (`lsp/extra.lua`): Servers without nixvim schema (emmylua_ls, sourcekit, denols, ts_ls, efm, moonbit-lsp). Also: settings requiring Lua-only APIs.
- **lsp-format server list**: efm, denols, hls, moonbit-lsp, taplo, zls.

## Key Keymaps

- Leader: `<Space>`
- `<Space><Space>` smart picker, `<Space>g` grep, `<Space>f` explorer — ownership determined by `nixvimConventions.keymapOwnership`
- `jj` escape in insert mode
- `<C-j>` SKK (Japanese input) enable

## Key Files

- Entry: @modules/programs/nixvim/default.nix
- Shared conventions: @modules/programs/nixvim/plugins/helpers.nix
- Editor options: @modules/programs/nixvim/config.nix
- Filetypes: @modules/programs/nixvim/filetype.nix
- Custom keymaps: @modules/programs/nixvim/extra_config.lua
- LSP (Nix): @modules/programs/nixvim/lsp/default.nix
- LSP (Lua): @modules/programs/nixvim/lsp/extra.lua
- AI workflows: @modules/programs/nixvim/plugins/ai/
- DPP regen: @modules/programs/nixvim/plugins/dpp/regenerate-toml.sh
- Orgmode: @modules/programs/nixvim/plugins/orgmode/default.nix
