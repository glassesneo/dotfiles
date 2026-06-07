{
  config,
  delib,
  inputs,
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
            background-opacity = 0.34;
            background-blur = 2;
            background = colors.base00;
            foreground = colors.base05;
            cursor-color = colors.base06;
            selection-background = colors.base02;
            selection-foreground = colors.base05;
            window-padding-x = 8;
            window-padding-y = 6;
            minimum-contrast = 1.8;
            custom-shader-animation = true;
            palette = colorschemeLib.toGhosttyPalette colors;
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
                  (function()
                    local theme = require("catppuccin.special.bufferline").get_theme()()
                    theme.buffer_selected = vim.tbl_extend("force", theme.buffer_selected or {}, {
                      bold = true,
                      italic = false,
                      underline = true,
                      sp = "${colors.base0E}",
                    })
                    theme.indicator_selected = vim.tbl_extend("force", theme.indicator_selected or {}, {
                      fg = "${colors.base0E}",
                      sp = "${colors.base0E}",
                      underline = true,
                    })
                    theme.tab_selected = vim.tbl_extend("force", theme.tab_selected or {}, {
                      fg = "${colors.base07}",
                      bold = true,
                    })
                    return theme
                  end)()
                '';
              };
            };
            gitsigns.settings.preview_config.border = lib.mkForce "rounded";
            snacks.settings.picker.win.list.border = lib.mkForce "rounded";
          };
          opts.winborder = lib.mkForce "rounded";
          highlight = {
            FloatBorder = {
              fg = "${colors.base03}";
              bg = "none";
            };
            FloatTitle = {
              fg = "${colors.base0E}";
              bg = "none";
            };
            FloatShadow.bg = "none";
            FloatShadowThrough.bg = "none";
            NormalFloat.bg = "${colors.base01}";
            Pmenu.bg = "${colors.base01}";
            Pmenu.fg = "${colors.base05}";
            PmenuSel.bg = "${colors.base02}";
            PmenuSel.fg = "${colors.base06}";
            WinSeparator.fg = "${colors.base03}";
          };
          autoCmd = [
            {
              event = ["ColorScheme" "VimEnter"];
              pattern = ["*"];
              once = false;
              callback.__raw = ''
                function()
                  local transparent = {
                    "Normal", "NormalNC", "SignColumn", "EndOfBuffer",
                    "LineNr", "CursorLineNr", "Folded", "FoldColumn",
                    "StatusLine", "StatusLineNC",
                  }
                  for _, group in ipairs(transparent) do
                    vim.api.nvim_set_hl(0, group, { bg = "none" })
                  end
                  vim.api.nvim_set_hl(0, "NormalFloat", { bg = "${colors.base01}" })
                  vim.api.nvim_set_hl(0, "FloatBorder", { fg = "${colors.base03}", bg = "none" })
                  vim.api.nvim_set_hl(0, "FloatTitle", { fg = "${colors.base0E}", bg = "none" })
                  vim.api.nvim_set_hl(0, "FloatShadow", { bg = "none" })
                  vim.api.nvim_set_hl(0, "FloatShadowThrough", { bg = "none" })
                  vim.api.nvim_set_hl(0, "Pmenu", { fg = "${colors.base05}", bg = "${colors.base01}" })
                  vim.api.nvim_set_hl(0, "PmenuSel", { fg = "${colors.base06}", bg = "${colors.base02}" })
                  vim.api.nvim_set_hl(0, "VertSplit", { fg = "${colors.base03}", bg = "none" })
                  vim.api.nvim_set_hl(0, "WinSeparator", { fg = "${colors.base03}", bg = "none" })
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
      programs.ghostty = {
        shader-profile = "sakura_ink_ripple";
        quick-terminal.background = colors.base01;
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
