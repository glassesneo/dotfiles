# rices/

## Rice-Aware Options Architecture

Rices **cannot** reference `pkgs` directly — `pkgs` in `delib.rice` resolves to `x86_64-linux` instead of the host platform (`aarch64-darwin`), causing cross-compilation errors.

**Solution**: Modules define string options that rices set as pure data. Modules then resolve packages using their own `pkgs`:

```nix
# Module (e.g., modules/programs/vim/default.nix)
options.programs.myvimeditor.colorscheme = {
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
myconfig.programs.myvimeditor.colorscheme = {
  plugin = "catppuccin-vim";  # Pure string, no pkgs reference
  config = "colorscheme catppuccin_macchiato";
};
```

**Key files**: `modules/programs/vim/default.nix`, `modules/programs/tmux/default.nix`, `rices/*.nix`

**Validation**: Modules assert plugin names exist in `pkgs.*Plugins` with helpful error messages.
