# modules/programs/nixvim/

## Overview

Full Neovim configuration via nixvim. Module name: `programs.nixvim`.

## Architecture

- **62 files** across plugins, LSP, AI workflows, and DPP (Denops plugin manager).
- `wrapRc = false` — nixvim injects init.lua directly via Home Manager, no wrapper script.
- Large Lua blocks live in `.lua` files, inlined via `builtins.readFile`.
- `pkgs.replaceVars` used for path injection (dpp hooks, plugin dirs, SKK dicts).
- LSP servers use `package = null` — trusts system PATH for binaries.

## Plugin Organization

- **Lazy loading**: Most plugins use `lz.n` with event/cmd/ft triggers.
- **DPP (Denops plugin manager)**: Manages editing/motion/SKK plugins via TOML configs generated from Nickel.
  - Plugin definitions: `plugins/dpp/plugins/{editing,motion,skk}.{ncl,toml}`
  - Nickel contract validation: `plugins/dpp/plugins/plugins_contract.ncl`
  - State cached in `$XDG_CACHE_HOME/dpp/`. Commands: `:DppInstall`, `:DppUpdate`, `:DppClearState`.
- **Completion**: blink-cmp with LSP, path, buffer, ripgrep, copilot, snippets, git sources.
- **AI**: codecompanion with multiple LLM adapters (copilot, gemini, ollama, claude-code, etc.) and workflow modes (TDD, refactor-test, plan, implementation).
- **UI**: snacks.nvim (picker, explorer, notifier), noice, fidget, bufferline, lualine.

## Key Keymaps

- Leader: `<Space>`
- `<Space><Space>` smart picker, `<Space>g` grep, `<Space>f` explorer
- `jj` escape in insert mode
- `<C-j>` SKK (Japanese input) enable

## Key Files

- Entry: @modules/programs/nixvim/default.nix
- Editor options: @modules/programs/nixvim/config.nix
- Filetypes: @modules/programs/nixvim/filetype.nix
- Custom keymaps: @modules/programs/nixvim/extra_config.lua
- LSP: @modules/programs/nixvim/lsp/default.nix
- AI workflows: @modules/programs/nixvim/plugins/ai/
