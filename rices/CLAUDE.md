# rices/

## Rice-Aware Options Architecture

Rices **cannot** reference `pkgs` directly — `pkgs` in `delib.rice` resolves to `x86_64-linux` instead of the host platform (`aarch64-darwin`), causing cross-compilation errors.

**Solution**: Modules define string options that rices set as pure data. Modules then resolve packages using their own `pkgs`:

```nix
# Module (e.g., modules/programs/tmux/default.nix)
options.programs.tmux.theme = {
  plugin = strOption "";
  pluginConfig = strOption "";
  extraConfig = strOption "";
};
```

**Key files**: `modules/programs/tmux/default.nix`, `rices/*.nix`

**Validation**: Modules assert plugin names exist in `pkgs.*Plugins` with helpful error messages.

## Theme Selection Responsibilities

Rices now select theme data instead of owning palette definitions:

- Set active scheme with `myconfig.colorscheme = config.myconfig.colorschemes.<scheme>.<variant>` (e.g., `colorschemes.catppuccin.macchiato`).
- Set wallpaper with `myconfig.wallpaper = <path>;`.
- Do not write `home.programs.desktoppr.settings.picture` in rice files; `modules/programs/desktoppr/default.nix` owns that wiring.
