{
  config,
  delib,
  inputs,
  ...
}: let
  colors = config.myconfig.colorschemes.everforest."dark-medium";
  colorschemeLib = config.myconfig.args.shared.colorschemeLib;
  argb = colorschemeLib.toArgb "ff";
in
  delib.rice {
    name = "everforest";
    inherits = ["laptop"];

    myconfig = {
      colorscheme = colors;
      wallpaper = "${inputs.wallpapers}/os/arch-btw-moon.png";

      services = {
        jankyborders = {
          active_color = argb colors.base0B;
          inactive_color = "0x00000000";
          style = "square";
          width = 10.0;
          order = "above";
        };

        sketchybar = {
          colors = {
            bar_background = argb colors.base00;
            text_primary = argb colors.base05;
            text_muted = argb colors.base04;

            workspace_active = argb colors.base0B;

            surface_background = argb colors.base02;
            popup_background = argb colors.base01;
            popup_border = argb colors.base04;

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

            cpu_low = argb colors.base0B;
            cpu_medium = argb colors.base0A;
            cpu_high = argb colors.base09;
            cpu_critical = argb colors.base08;
          };
          bar.color = "";
        };
      };

      programs.vim.colorscheme = {
        plugin = "everforest";
        config = ''
          " Everforest colorscheme configuration
          set background=dark
          let g:everforest_background = 'medium'
          let g:everforest_transparent_background = 1
          silent! colorscheme everforest
        '';
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

    home = {
      programs = {
        nixvim = {
          colorschemes.everforest = {
            enable = true;
            settings = {
              background = "medium";
              transparent_background = 2;
            };
            lazyLoad.enable = true;
          };
          plugins.bufferline.settings = {
            options = {
              indicator = {
                style = "underline";
              };
              show_tab_indicators = true;
            };
            highlights = {
              buffer_selected = {
                fg = "${colors.base07}";
                bold = true;
                italic = false;
                underline = true;
                sp = "${colors.base0B}";
              };
              buffer_visible = {
                fg = "${colors.base05}";
              };
              background = {
                fg = "${colors.base04}";
              };
              indicator_selected = {
                fg = "${colors.base0B}";
                sp = "${colors.base0B}";
                underline = true;
              };
              indicator_visible = {
                fg = "${colors.base04}";
              };
              separator = {
                fg = "${colors.base02}";
              };
              separator_selected = {
                fg = "${colors.base02}";
              };
              separator_visible = {
                fg = "${colors.base02}";
              };
              modified_selected = {
                fg = "${colors.base0B}";
              };
              modified_visible = {
                fg = "${colors.base05}";
              };
              modified = {
                fg = "${colors.base04}";
              };
              tab_selected = {
                fg = "${colors.base07}";
                bold = true;
              };
              tab = {
                fg = "${colors.base04}";
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
        ghostty = {
          settings = {
            background-opacity = 0.4;
            background-blur = 5;
            background = colors.base00;
            foreground = colors.base05;
            cursor-color = colors.base05;
            selection-background = colors.base02;
            selection-foreground = colors.base05;
            palette = [
              "0=${colors.base00}"
              "1=${colors.base08}"
              "2=${colors.base0B}"
              "3=${colors.base0A}"
              "4=${colors.base0D}"
              "5=${colors.base0E}"
              "6=${colors.base0C}"
              "7=${colors.base05}"
              "8=${colors.base03}"
              "9=${colors.base08}"
              "10=${colors.base0B}"
              "11=${colors.base0A}"
              "12=${colors.base0D}"
              "13=${colors.base0E}"
              "14=${colors.base0C}"
              "15=${colors.base07}"
            ];
          };
        };
      };
    };
  }
