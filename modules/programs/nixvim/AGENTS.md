# modules/programs/nixvim/

## Ownership

`programs.nixvim` owns the full Neovim configuration via nixvim. Treat it as a
feature module with several internal ownership seams, not as a directory map.

## Architecture

- `wrapRc = false` — nixvim injects init.lua directly via Home Manager, no wrapper script.
- Large Lua blocks live in `.lua` files, inlined via `builtins.readFile`.
- `pkgs.replaceVars` used for path injection (SKK dicts, etc.).
- LSP servers use `package = null` — trusts system PATH for binaries.

## Shared Conventions (helpers.nix)

- `nixvimConventions` is exposed via `myconfig.always.args.shared.nixvimConventions` and available as a function arg in all modules.
- **Capability contracts** (`capabilities.hasIncRename`, `.hasCodeCompanion`): Boolean flags consumed by `ui.nix` and `img-clip.nix` instead of direct cross-plugin option reads.

## Plugin Organization

- **Lazy loading**: Most plugins use `lz.n` with event/cmd/ft triggers.
- **Denops plugins**: `denops.nix` owns the shared `denops-vim` runtime. `skkeleton.nix` owns `skkeleton` + `deno`. `motion.nix` owns `kensaku.vim`, `kensaku-search.vim`, and `fuzzy-motion.vim`.
- **Completion**: blink-cmp with LSP, path, buffer, ripgrep, copilot, snippets, git sources.
- **Copilot** (`plugins/copilot/`): copilot-language-server LSP config, copilot.lua auth plugin, inline completion wiring.
- **AI** (`plugins/ai/`): codecompanion split into four `delib.module` files:
  - `default.nix` — composition root (copilot, strategies, display, lazy keys)
  - `adapters.nix` — all adapter registrations (http + acp)
  - `workflows.nix` — prompt_library entries (TDD, refactor-test, plan, implementation)
  - `extensions.nix` — extensions (history, mcphub), extraPlugins, extraConfigLua
- **Orgmode** (`plugins/orgmode/`): split into base and journal child module:
  - `default.nix` — base plugin owner (`programs.nixvim.plugins.orgmode.entrypoint`, shared settings, `org` shell wrapper)
  - `journal/default.nix` — journal child module (`programs.nixvim.plugins.orgmode.journal.enable`): agenda commands `C`/`D`/`j`, capture templates `m`/`d`/`r`, `:Today` command, shell wrappers `checkin`/`diary`/`today`. Journal paths derive from the parent `entrypoint` option.
- **UI**: snacks.nvim (picker, explorer, notifier), noice, fidget, bufferline, lualine.

## LSP Configuration

- LSP ownership now lives in `modules/programs/nixvim/lsp/AGENTS.md`; read that file before adding or moving a server.
- `modules/programs/nixvim/lsp/default.nix` is the shared contract and Lua assembly root, not the place for every server definition.
- PATH-gated schema-backed servers keep their executable manifest in Nix and runtime activation in `modules/programs/nixvim/lsp/activation.lua`.

## Key Keymaps

- Leader: `<Space>`
- `<Space><Space>` smart picker, `<Space>g` grep, `<Space>f` explorer, `<Space>z` zen mode — provided by snacks.nvim
- `jj` escape in insert mode
- `<C-j>` SKK (Japanese input) enable
- Non-plugin Neovim keymaps such as `<Space>h/j/k/l`, `<S-h>/<S-l>`, `M`, `q`, and `<Space>w` live directly in `extra_config.lua`. Plugin-specific mappings remain in their plugin modules.

## Local Guidance

- Read `modules/programs/nixvim/lsp/AGENTS.md` before changing LSP ownership.
- Keep this guidance focused on stable ownership seams and cross-module contracts. Use direct inspection for file inventories.
