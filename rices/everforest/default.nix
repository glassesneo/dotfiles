{
  config,
  delib,
  lib,
  ...
}: let
  colors = config.myconfig.colorschemes.everforest."dark-medium";
  colorschemeLib = config.myconfig.args.shared.colorschemeLib;
  argb = colorschemeLib.toArgb "ff";
  argbLow = colorschemeLib.toArgb "26";
  argbBorder = colorschemeLib.toArgb "40";
  argbIndicator = colorschemeLib.toArgb "50";
in
  delib.rice {
    name = "everforest";
    inherits = ["laptop"];

    myconfig = {
      darwin.window-manager.backend = lib.mkDefault "aerospace";
      colorscheme = colors;
      wallpaper.title = "forest";
      programs.ghostty = {
        appearance = {
          background-opacity = 0.4;
          background-blur = 5;
          background = colors.base00;
          foreground = colors.base05;
          cursor = colors.base05;
          selection-background = colors.base02;
          selection-foreground = colors.base05;
          palette = colorschemeLib.toTerminalPalette colors;
        };
        quick-terminal.background = colors.base00;
      };
      programs.nixvim.appearance = {
        theme = "everforest";
        everforest-background = "medium";
        transparent = true;
        transparent-floats = true;
      };

      services = {
        jankyborders = {
          active_color = argb colors.base0B;
          inactive_color = "0x00000000";
          style = "round";
          width = 5.0;
          order = "above";
        };

        sketchybar = {
          colors = {
            text_primary = argb colors.base05;
            text_muted = argb colors.base04;
            workspace_active = argb colors.base0B;
            accent_datetime = argb colors.base0C;
            status_error = argb colors.base08;
            status_warning = argb colors.base0A;
            status_caution = argb colors.base09;
            status_success = argb colors.base0B;
            status_charging = argb colors.base09;
            app_arc = argb colors.base06;
            app_ghostty = argb colors.base0D;
            app_obsidian = argb colors.base0E;
            app_kitty = argb colors.base0F;
            island_surface = argbLow colors.base02;
            island_border = argbBorder colors.base04;
            active_indicator = argbIndicator colors.base0B;
          };
        };
      };

      programs.tmux.theme = {
        plugin = "";
        pluginConfig = "";
        extraConfig = ''
          # Everforest tmux status bar
          set -g status-style 'bg=default,fg=${colors.base05}'
          set -g status-left '#[fg=${colors.base0B},bold][#S] '
          set -g status-left-length 20
          set -g status-right ""
          set -g window-status-format '#[fg=${colors.base04}] #I:#W '
          set -g window-status-current-format '#[fg=${colors.base05},bold,underscore] #I:#W '
          set -g window-status-separator ""
          set -g pane-border-style 'fg=${colors.base02}'
          set -g pane-active-border-style 'fg=${colors.base0B}'
          set -g message-style 'fg=${colors.base05},bg=default'
          set -g popup-style 'bg=default,fg=${colors.base05}'
          set -g popup-border-style 'fg=${colors.base0B}'
        '';
      };
    };
  }
