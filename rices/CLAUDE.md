# rices/

## Rice-Aware Options Architecture

Rices **cannot** reference `pkgs` directly — `pkgs` in `delib.rice` resolves to `x86_64-linux` instead of the host platform (`aarch64-darwin`), causing cross-compilation errors.

**Solution**: Modules define string options that rices set as pure data. Modules then resolve packages using their own `pkgs`:

```nix
# Module (e.g., modules/programs/vim/default.nix)
options.programs.vim.colorscheme = {
  plugin = strOption "";  # Rice sets: "catppuccin-vim"
  config = strOption "";  # Rice sets: vimscript string
};

home.ifEnabled = {cfg, ...}: let
  # Module resolves package from string (correct platform)
  colorschemePlugin =
    if cfg.colorscheme.plugin != ""
    then [pkgs.vimPlugins.${cfg.colorscheme.plugin}]
    else [];
in { ... };

# Rice (e.g., rices/catppuccin.nix)
myconfig.programs.vim.colorscheme = {
  plugin = "catppuccin-vim";  # Pure string, no pkgs reference
  config = "colorscheme catppuccin_macchiato";
};
```

**Key files**: `modules/programs/vim/default.nix`, `modules/programs/tmux/default.nix`, `rices/*.nix`

**Validation**: Modules assert plugin names exist in `pkgs.*Plugins` with helpful error messages.

## Theme Selection Responsibilities

Rices now select theme data instead of owning palette definitions:

- Set active scheme with `myconfig.colorscheme = config.myconfig.colorschemes.<name>`.
- Set wallpaper with `myconfig.wallpaper = <path>;`.
- Do not write `home.programs.desktoppr.settings.picture` in rice files; `modules/programs/desktoppr/default.nix` owns that wiring.
