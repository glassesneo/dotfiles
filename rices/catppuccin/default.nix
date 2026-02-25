{
  delib,
  inputs,
  ...
}: let
  flavor = "macchiato";
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
      };
      programs = {
        desktoppr = {
          settings = {
            picture = ./catppuccin.png;
          };
        };
        ghostty = {
          settings = {
            background-opacity = 0.4;
            background-blur = 5;
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
          highlight = {
            # Transparent background guards - override catppuccin plugin post-load
            # Normal.bg = "none";
            # NormalNC.bg = "none";
            # NormalFloat.bg = "none";
            # SignColumn.bg = "none";
            # EndOfBuffer.bg = "none";
            # LineNr.bg = "none";
            # CursorLineNr.bg = "none";
            # Folded.bg = "none";
            # FoldColumn.bg = "none";
            # VertSplit.bg = "none";
            # StatusLine.bg = "none";
            # StatusLineNC.bg = "none";
          };
        };
      };
    };
    myconfig = {
      services = {
        jankyborders = {
          active_color = "0xffc6a0f6"; # mauve
          inactive_color = "0x00000000"; # transparent
          style = "square";
          width = 10.0;
        };

        sketchybar = {
          colors = {
            # Bar and text colors
            bar_background = "0xff181926"; # crust
            text_primary = "0xffcad3f5"; # text
            text_muted = "0xff939ab7"; # overlay2

            # Workspace colors
            workspace_active = "0xffed8796"; # red

            # Surface and popup colors
            surface_background = "0xff363a4f"; # surface0
            popup_background = "0xff1e2030"; # mantle
            popup_border = "0xff939ab7"; # overlay2

            # Accent colors
            accent_datetime = "0xff91d7e3"; # sky

            # Status colors
            status_error = "0xffed8796"; # red
            status_warning = "0xffeed49f"; # yellow
            status_caution = "0xfff5a97f"; # peach
            status_success = "0xffa6da95"; # green
            status_charging = "0xffd4a84a"; # darker golden yellow

            # App-specific icon colors
            app_arc = "0xfff5bde6"; # pink
            app_ghostty = "0xff8aadf4"; # blue
            app_obsidian = "0xffc6a0f6"; # mauve
            app_kitty = "0xfff0c6c6"; # flamingo

            # CPU graph colors by usage level
            cpu_low = "0xffa6da95"; # green
            cpu_medium = "0xffeed49f"; # yellow
            cpu_high = "0xfff5a97f"; # peach
            cpu_critical = "0xffed8796"; # red
          };
          # Bar appearance - uses default bar_background color
          bar.color = "";
        };
      };

      # Use rice-aware options for vim and tmux
      programs.vim.colorscheme = {
        plugin = "catppuccin-vim";
        config = ''
          " Catppuccin colorscheme configuration
          let g:catppuccin_flavour = "macchiato"
          silent! colorscheme catppuccin_macchiato
        '';
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
          set -g popup-style "bg=default,fg=#cad3f5"
          set -g popup-border-style "fg=#c6a0f6"
        '';
      };
    };
  }
