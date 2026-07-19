{
  config,
  delib,
  lib,
  ...
}: let
  flavor = "macchiato";
  colors = config.myconfig.colorschemes.catppuccin.${flavor};
  colorschemeLib = config.myconfig.args.shared.colorschemeLib;
  argb = colorschemeLib.toArgb "ff";
  argbLow = colorschemeLib.toArgb "26";
  argbBorder = colorschemeLib.toArgb "40";
  argbIndicator = colorschemeLib.toArgb "50";
in
  delib.rice {
    name = "catppuccin";
    inherits = ["laptop"];

    myconfig = {
      darwin.window-manager.backend = lib.mkDefault "aerospace";
      theme.catppuccin = {
        enable = true;
        inherit flavor;
      };
      colorscheme = colors;
      wallpaper.title = "sakura";
      programs.ghostty = {
        appearance = {
          background-opacity = 0.34;
          background-blur = 2;
          background = colors.base00;
          foreground = colors.base05;
          cursor = colors.base06;
          selection-background = colors.base02;
          selection-foreground = colors.base05;
          padding-x = 8;
          padding-y = 6;
          minimum-contrast = 1.8;
          animate-shaders = true;
          palette = colorschemeLib.toTerminalPalette colors;
        };
        shader-profile = "sakura_ink_ripple";
        quick-terminal.background = colors.base01;
      };
      programs.nixvim.appearance = {
        theme = "catppuccin";
        catppuccin-flavor = flavor;
        transparent = true;
        rounded-borders = true;
      };
      programs.nvf.theme = {
        enable = true;
        name = "catppuccin";
        style = "mocha";
        transparent = true;
      };

      services = {
        jankyborders = {
          active_color = argb colors.base0F;
          inactive_color = "0x00000000"; # transparent
          style = "round";
          width = 2.0;
          order = "above";
        };

        sketchybar = {
          colors = {
            text_primary = argb colors.base05;
            text_muted = argb colors.base04;
            workspace_active = argb colors.base08;
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
            active_indicator = argbIndicator colors.base08;
          };
        };
      };

      programs.tmux.theme = {
        plugin = "catppuccin";
        pluginConfig = ''
          set -g @catppuccin_flavor '${flavor}'
          set -g @catppuccin_window_status_style 'basic'
          set -g @catppuccin_status_background 'none'
        '';
        # Status line modules must be set AFTER the plugin loads
        extraConfig = ''
          set -g status-right-length 100
          set -g status-left-length 100
          set -g status-left ""
          set -g status-right ""
          set -g pane-border-style "fg=${colors.base03}"
          set -g pane-active-border-style "fg=${colors.base07}"
          set -g message-style "fg=${colors.base05},bg=default"
          set -g message-command-style "fg=${colors.base07},bg=default"
          set -g display-panes-colour "${colors.base04}"
          set -g display-panes-active-colour "${colors.base07}"
          set -g popup-style "bg=default,fg=${colors.base05}"
          set -g popup-border-style "fg=${colors.base07}"
        '';
      };
    };
  }
