{
  config,
  delib,
  lib,
  ...
}: let
  colors = config.myconfig.colorschemes.monochrome.default;
  colorschemeLib = config.myconfig.args.shared.colorschemeLib;
  argb = colorschemeLib.toArgb "ff";
  argbLow = colorschemeLib.toArgb "26";
  argbBorder = colorschemeLib.toArgb "40";
  argbIndicator = colorschemeLib.toArgb "50";
in
  delib.rice {
    name = "monochrome";
    inherits = ["laptop"];

    myconfig.colorscheme = config.myconfig.colorschemes.monochrome.default;
    myconfig.darwin.window-manager.backend = lib.mkDefault "aerospace";
    myconfig.wallpaper.title = "roses";
    myconfig.programs.ghostty = {
      appearance = {
        background-opacity = 0.5;
        background = colors.base00;
        foreground = colors.base05;
        cursor = colors.base05;
        selection-background = colors.base02;
        selection-foreground = colors.base05;
        palette = [
          colors.base00
          colors.base08
          colors.base05
          colors.base05
          colors.base05
          colors.base08
          colors.base05
          colors.base05
          colors.base03
          colors.base08
          colors.base06
          colors.base06
          colors.base06
          colors.base08
          colors.base06
          colors.base07
        ];
      };
      quick-terminal.background = colors.base00;
    };
    myconfig.programs.nixvim.appearance = {
      theme = "base16";
      transparent = true;
      transparent-floats = true;
      comment-color = colors.base04;
    };

    myconfig.services = {
      sketchybar = {
        colors = {
          text_primary = argb colors.base05;
          text_muted = argb colors.base04;
          workspace_active = argb colors.base08;
          accent_datetime = argb colors.base05;
          status_error = argb colors.base08;
          status_warning = argb colors.base05;
          status_caution = argb colors.base09;
          status_success = argb colors.base05;
          status_charging = argb colors.base0A;
          app_arc = argb colors.base08;
          app_ghostty = argb colors.base0D;
          app_obsidian = argb colors.base0E;
          app_kitty = argb colors.base0F;
          island_surface = argbLow colors.base01;
          island_border = argbBorder colors.base04;
          active_indicator = argbIndicator colors.base08;
        };
      };

      jankyborders = {
        active_color = colors.base05;
        inactive_color = colors.base03;
        style = "round";
        width = 4.0;
      };
    };

    myconfig.programs.tmux.theme = {
      plugin = ""; # No plugin, use extraConfig for monochrome styling
      pluginConfig = "";
      extraConfig = ''
        # Monochrome tmux status bar
        set -g status-style 'bg=default,fg=${colors.base05}'
        set -g status-left '#[fg=${colors.base08},bold][#S] '
        set -g status-left-length 20
        set -g status-right ""
        set -g window-status-format '#[fg=${colors.base04}] #I:#W '
        set -g window-status-current-format '#[fg=${colors.base07},bold,underscore] #I:#W '
        set -g window-status-separator ""
        set -g pane-border-style 'fg=${colors.base02}'
        set -g pane-active-border-style 'fg=${colors.base08}'
        set -g message-style 'fg=${colors.base05},bg=default'
        set -g popup-style 'bg=default,fg=${colors.base05}'
        set -g popup-border-style 'fg=${colors.base08}'
      '';
    };
  }
