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

- Config: `dpp.ts` (TypeScript/Denops) + `setup-dpp.vim` (loader)
- Plugin defs: `plugins/skk.toml` (SKKeleton Japanese input)
- Hooks: `hooks/skk.vim` (dict path injected via `replaceVars`)
- State cached in `~/.cache/vim-dpp/`. Commands: `DppInstall`, `DppUpdate`, `DppClearState`.
- Files deployed to `~/.config/vim-dpp/`.

## Key Detail

`home.sessionVariables.EDITOR = lib.mkForce "vim"` — overrides nixvim's default editor setting.
