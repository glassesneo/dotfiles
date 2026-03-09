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
- **Capability contracts** (`capabilities.hasIncRename`, `.hasCodeCompanion`): Boolean flags consumed by `ui.nix` and `img-clip.nix` instead of direct cross-plugin option reads.

## Plugin Organization

- **Lazy loading**: Most plugins use `lz.n` with event/cmd/ft triggers.
- **DPP (Denops plugin manager)**: keeps plugin declaration, compile, and runtime loading concerns intentionally separated.
  - Shared core layer: `modules/config/dpp-shared.nix` provides shared plugin packages (`dppShared.dppPluginPkgs`), generated TOMLs (`dppShared.pluginTomls`), and shared hook sources (`dppShared.sharedHookSources.skkVim`).
  - Neovim bootstrap ownership: `modules/programs/nixvim/plugins/dpp/default.nix` owns Neovim setup (`setup-dpp.lua`), environment wiring, and Neovim cache/state paths.
  - Plugin definitions are Nix attrsets in `modules/config/dpp-shared.nix` (`editingPlugins`, `motionPlugins`, `skkPlugins`, `ddcPlugins`).
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

- LSP ownership now lives in `modules/programs/nixvim/lsp/CLAUDE.md`; read that file before adding or moving a server.
- `modules/programs/nixvim/lsp/default.nix` is the shared contract and Lua assembly root, not the place for every server definition.
- PATH-gated schema-backed servers keep their executable manifest in Nix and runtime activation in `modules/programs/nixvim/lsp/activation.lua`.

## Key Keymaps

- Leader: `<Space>`
- `<Space><Space>` smart picker, `<Space>g` grep, `<Space>f` explorer, `<Space>z` zen mode — provided by snacks.nvim
- `jj` escape in insert mode
- `<C-j>` SKK (Japanese input) enable

## Key Files

- Entry: @modules/programs/nixvim/default.nix
- Shared conventions: @modules/programs/nixvim/plugins/helpers.nix
- Editor options: @modules/programs/nixvim/config.nix
- Filetypes: @modules/programs/nixvim/filetype.nix
- Custom keymaps: @modules/programs/nixvim/extra_config.lua
- LSP guide: @modules/programs/nixvim/lsp/CLAUDE.md
- LSP root: @modules/programs/nixvim/lsp/default.nix
- AI workflows: @modules/programs/nixvim/plugins/ai/
- DPP regen: @modules/programs/nixvim/plugins/dpp/regenerate-toml.sh
- Orgmode: @modules/programs/nixvim/plugins/orgmode/default.nix
