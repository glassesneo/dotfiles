{
  config,
  delib,
  inputs,
  ...
}: let
  flavor = "frappe";
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

    home = {
      imports = [
        inputs.catppuccin.homeModules.catppuccin
      ];
      catppuccin = {
        enable = true;
        inherit flavor;
        nvim.enable = false;
        tmux.enable = false;
        firefox.enable = false;
      };
      programs = {
        ghostty = {
          settings = {
            background-opacity = 0.2;
            background-blur = 3;
            window-padding-x = 6;
          };
        };
        nixvim = {
          colorschemes = {
            catppuccin = {
              enable = true;
              settings = {
                inherit flavor;
                transparent_background = true;
                term_colors = true;
                integrations = {
                  dashboard = true;
                  fidget = true;
                  gitsigns = true;
                  navic = {
                    enabled = true;
                    custom_bg = "NONE";
                  };
                  notify = true;
                  treesitter = true;
                };
              };
              lazyLoad.enable = true;
            };
          };
          plugins = {
            bufferline = {
              settings = {
                options = {
                  indicator = {
                    style = "underline";
                  };
                  show_tab_indicators = true;
                };
                highlights.__raw = ''
                  require("catppuccin.special.bufferline").get_theme()
                '';
              };
            };
          };
          autoCmd = [
            {
              event = ["ColorScheme" "VimEnter"];
              pattern = ["*"];
              once = false;
              callback.__raw = ''
                function()
                  local groups = {
                    "Normal", "NormalNC", "NormalFloat",
                    "SignColumn", "EndOfBuffer", "LineNr", "CursorLineNr",
                    "Folded", "FoldColumn", "VertSplit", "StatusLine", "StatusLineNC",
                  }
                  for _, g in ipairs(groups) do
                    vim.api.nvim_set_hl(0, g, { bg = "none" })
                  end
                end
              '';
            }
          ];
        };
      };
    };
    myconfig = {
      colorscheme = colors;
      wallpaper = "sakura";
      programs.ghostty.quick-terminal-background = colors.base00;

      services = {
        jankyborders = {
          active_color = argb colors.base0F;
          inactive_color = "0x00000000"; # transparent
          style = "round";
          width = 5.0;
          order = "above";
        };

        sketchybar = {
          colors = {
            # Bar and text colors
            bar_background = argb colors.base00;
            text_primary = argb colors.base05;
            text_muted = argb colors.base04;

            # Workspace colors
            workspace_active = argb colors.base08;

            # Surface and popup colors
            surface_background = argb colors.base02;
            popup_background = argb colors.base01;
            popup_border = argb colors.base04;

            # Accent colors
            accent_datetime = argb colors.base0C;

            # Status colors
            status_error = argb colors.base08;
            status_warning = argb colors.base0A;
            status_caution = argb colors.base09;
            status_success = argb colors.base0B;
            status_charging = argb colors.base09;

            # App-specific icon colors
            app_arc = argb colors.base06;
            app_ghostty = argb colors.base0D;
            app_obsidian = argb colors.base0E;
            app_kitty = argb colors.base0F;

            # Island and indicator colors
            island_surface = argbLow colors.base02;
            island_border = argbBorder colors.base04;
            active_indicator = argbIndicator colors.base08;

            # CPU graph colors by usage level
            cpu_low = argb colors.base0B;
            cpu_medium = argb colors.base0A;
            cpu_high = argb colors.base09;
            cpu_critical = argb colors.base08;
          };
          # Transparent outer bar — visible surface comes from island brackets
          bar.color = "0x00000000";
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
          set -g status-right "#{E:@catppuccin_status_session}"
          set -g popup-style "bg=default,fg=${colors.base05}"
          set -g popup-border-style "fg=${colors.base0E}"
        '';
      };
    };
  }
