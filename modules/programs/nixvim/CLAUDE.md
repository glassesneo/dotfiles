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
- **DPP (Denops plugin manager)**: keeps plugin declaration, compile, and runtime loading concerns intentionally separated.
  - Shared core layer: `modules/config/dpp-shared.nix` provides shared plugin packages (`dppShared.dppPluginPkgs`), generated TOMLs (`dppShared.pluginTomls`), and shared hook sources (`dppShared.sharedHookSources.skkVim`).
  - Neovim bootstrap ownership: `modules/programs/nixvim/plugins/dpp/default.nix` owns Neovim setup (`setup-dpp.lua`), environment wiring, and Neovim cache/state paths.
  - Plugin definitions come from shared Nickel specs in `modules/programs/nixvim/plugins/dpp/plugins/` (`{editing,motion,skk}.ncl`) with contract validation in `plugins_contract.ncl`.
  - Regenerate helper (optional/manual): `nix develop -c bash plugins/dpp/regenerate-toml.sh`
  - SKK hook source is shared from `dppShared.sharedHookSources.skkVim`; Neovim-specific Lua behavior stays in Neovim-owned hooks or inline Lua blocks.
  - Cache/state path remains `~/.cache/dpp` (separate from Vim `~/.cache/vim-dpp`). Commands: `:DppInstall`, `:DppUpdate`, `:DppClearState`.
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
- **Executable gating**: PATH-based servers are only enabled when their executables are present at Neovim startup (via `guarded_enable` in extra.lua). This prevents health check warnings for missing project-local servers. Store-pinned servers (bashls, nixd, nickel_ls) have `activate = true` and are always available.
- **Workflow**: Open Neovim from an activated project environment (direnv/nix-direnv) when project-local LSP servers are required. Servers will attach automatically when executables are in PATH.
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
