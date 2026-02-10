# modules/programs/vim/

## Overview

Vim configuration with DPP (Dark Powered Plugin manager) via Denops. Module name: `programs.myvimeditor` (avoids collision with nixvim's `programs.vim`).

## Rice-Aware Colorscheme Pattern

This module is the primary example of the rice-aware options architecture:

```nix
options.programs.myvimeditor.colorscheme = {
  plugin = strOption "";   # Rice sets pure string, e.g., "catppuccin-vim"
  config = strOption "";   # Rice sets vimscript string
};
```

- Module resolves `pkgs.vimPlugins.${cfg.colorscheme.plugin}` at build time (correct platform).
- Validates plugin exists in `pkgs.vimPlugins` with `assert lib.assertMsg`.
- Colorscheme config injected last in `extraConfig` to override base settings.

## DPP Plugin Manager

- DPP ownership follows the shared core + editor bootstrap split used in `modules/programs/nixvim/plugins/dpp/README.md`.
- **Shared core layer**: `modules/config/dpp-shared.nix`
  - Builds shared plugin packages (`dppShared.dppPluginPkgs`)
  - Compiles generated TOMLs (`dppShared.pluginTomls`)
  - Exposes shared hook sources (`dppShared.sharedHookSources.skkVim`)
- Plugin definitions come from shared Nickel specs in `modules/programs/nixvim/plugins/dpp/plugins/`, with editor/host guards (for example `if = "has('nvim')"`) so one spec set can serve Vim and Neovim.
- **Vim-specific bootstrap**: `modules/programs/vim/default.nix`
  - Owns Vim loader setup (`setup-dpp.vim`)
  - Owns Vim environment wiring (`$DPP_HOOK_DIR`) and runtimepath wiring
  - Deploys Vim-facing config under `~/.config/vim-dpp/`
- SKK hook source is shared from `dppShared.sharedHookSources.skkVim` and dictionary path is injected in Vim module wiring.
- Cache/state path remains `~/.cache/vim-dpp` (separate from Neovim `~/.cache/dpp`).

## Key Detail

`programs.myvimeditor` remains a dedicated module name to avoid collision with nixvim's `programs.vim`.
