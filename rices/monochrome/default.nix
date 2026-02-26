{
  config,
  delib,
  inputs,
  ...
}: let
  colors = config.myconfig.colorschemes.monochrome;
  colorschemeLib = config.myconfig.args.shared.colorschemeLib;
  argb = colorschemeLib.toArgb "ff";
in
  delib.rice {
    name = "monochrome";
    inherits = ["laptop"];

    myconfig.colorscheme = config.myconfig.colorschemes.monochrome;
    myconfig.wallpaper = inputs.various-wallpapers + "/onedark/J0FZ3V.jpg";

    myconfig.services.sketchybar = {
      # datetimeFontOverride = "Iosevka:Regular:16";
      colors = {
        # Bar and text colors
        bar_background = argb colors.base00;
        text_primary = argb colors.base05;
        text_muted = argb colors.base04;

        # Workspace colors
        workspace_active = argb colors.base08;

        # Surface and popup colors
        surface_background = argb colors.base01;
        popup_background = argb colors.base02;
        popup_border = argb colors.base05;

        # Accent colors
        accent_datetime = argb colors.base05;

        # Status colors
        status_error = argb colors.base08;
        status_warning = argb colors.base05;
        status_caution = argb colors.base09;
        status_success = argb colors.base05;
        status_charging = argb colors.base0A;

        # App-specific icon colors - these stay colorful even in monochrome
        app_arc = argb colors.base08;
        app_ghostty = argb colors.base0D;
        app_obsidian = argb colors.base0E;
        app_kitty = argb colors.base0F;

        # CPU graph colors - grayscale gradient from dark to light
        cpu_low = argb colors.base03;
        cpu_medium = argb colors.base04;
        cpu_high = argb colors.base09;
        cpu_critical = argb colors.base08;
      };
      # Transparent outer bar background
      bar.color = "0x00000000"; # Fully transparent
    };

    myconfig.services.jankyborders = {
      active_color = colors.base05;
      inactive_color = colors.base03;
      style = "round";
      width = 4.0;
    };

    # Use rice-aware options for vim and tmux
    myconfig.programs.vim.colorscheme = {
      plugin = "base16-vim";
      config = ''
        " Monochrome base16 colorscheme
        let base16colorspace=256
        colorscheme base16-default-dark

        " Override with monochrome palette
        hi Normal guifg=${colors.base05} guibg=NONE
        hi Comment guifg=${colors.base04}
        hi Constant guifg=${colors.base09}
        hi String guifg=${colors.base0B}
        hi Identifier guifg=${colors.base08}
        hi Statement guifg=${colors.base0E}
        hi PreProc guifg=${colors.base0A}
        hi Type guifg=${colors.base0A}
        hi Special guifg=${colors.base0C}
        hi Underlined guifg=${colors.base0D}
        hi Error guifg=${colors.base08} guibg=NONE
        hi Todo guifg=${colors.base0A} guibg=NONE
        hi LineNr guifg=${colors.base03} guibg=NONE
        hi CursorLineNr guifg=${colors.base07} guibg=NONE
        hi Visual guibg=${colors.base02}
        hi StatusLine guifg=${colors.base05} guibg=${colors.base01}
        hi StatusLineNC guifg=${colors.base04} guibg=${colors.base01}
        hi VertSplit guifg=${colors.base02} guibg=NONE
        hi Pmenu guifg=${colors.base05} guibg=${colors.base01}
        hi PmenuSel guifg=${colors.base07} guibg=${colors.base02}
      '';
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
      '';
    };

    home = {
      programs = {
        nixvim = {
          colorschemes.base16 = {
            enable = true;
            colorscheme = {
              inherit
                (colors)
                base00
                base01
                base02
                base03
                base04
                base05
                base06
                base07
                base08
                base09
                base0A
                base0B
                base0C
                base0D
                base0E
                base0F
                ;
            };
            settings.telescope = true;
          };
          plugins.bufferline.settings = {
            options = {
              indicator = {
                style = "underline";
              };
              show_tab_indicators = true;
            };
            highlights = {
              # Selected buffer - bright and underlined
              buffer_selected = {
                fg = "${colors.base07}";
                bold = true;
                italic = false;
                underline = true;
                sp = "${colors.base08}";
              };
              # Visible but not selected
              buffer_visible = {
                fg = "${colors.base05}";
              };
              # Background/inactive buffers
              background = {
                fg = "${colors.base04}";
              };
              # Indicator underline color
              indicator_selected = {
                fg = "${colors.base08}";
                sp = "${colors.base08}";
                underline = true;
              };
              indicator_visible = {
                fg = "${colors.base04}";
              };
              # Separator styling
              separator = {
                fg = "${colors.base02}";
              };
              separator_selected = {
                fg = "${colors.base02}";
              };
              separator_visible = {
                fg = "${colors.base02}";
              };
              # Modified indicators
              modified_selected = {
                fg = "${colors.base08}";
              };
              modified_visible = {
                fg = "${colors.base05}";
              };
              modified = {
                fg = "${colors.base04}";
              };
              # Tab styling
              tab_selected = {
                fg = "${colors.base07}";
                bold = true;
              };
              tab = {
                fg = "${colors.base04}";
              };
            };
          };
          opts.termguicolors = true;
          highlight = {
            # Comment color override - lighter than base03
            Comment.fg = "${colors.base04}";
            # Transparent background
            Normal.bg = "none";
            NormalNC.bg = "none";
            NormalFloat.bg = "none";
            SignColumn.bg = "none";
            EndOfBuffer.bg = "none";
            LineNr.bg = "none";
            CursorLineNr.bg = "none";
            Folded.bg = "none";
            FoldColumn.bg = "none";
            VertSplit.bg = "none";
            StatusLine.bg = "none";
            StatusLineNC.bg = "none";
          };
        };
        ghostty = {
          settings = {
            background-opacity = 0.5;
            # background-blur = 20;
            # Align with base16 colors
            background = colors.base00;
            foreground = colors.base05;
            cursor-color = colors.base05;
            selection-background = colors.base02;
            selection-foreground = colors.base05;
            # Terminal palette (16 colors)
            palette = [
              # Normal colors (0-7)
              "0=${colors.base00}" # Black
              "1=${colors.base08}" # Red (pink accent)
              "2=${colors.base05}" # Green (gray)
              "3=${colors.base05}" # Yellow (gray)
              "4=${colors.base05}" # Blue (gray)
              "5=${colors.base08}" # Magenta (pink accent)
              "6=${colors.base05}" # Cyan (gray)
              "7=${colors.base05}" # White
              # Bright colors (8-15)
              "8=${colors.base03}" # Bright Black
              "9=${colors.base08}" # Bright Red (pink accent)
              "10=${colors.base06}" # Bright Green (light gray)
              "11=${colors.base06}" # Bright Yellow (light gray)
              "12=${colors.base06}" # Bright Blue (light gray)
              "13=${colors.base08}" # Bright Magenta (pink accent)
              "14=${colors.base06}" # Bright Cyan (light gray)
              "15=${colors.base07}" # Bright White
            ];
          };
        };
        opencode = {
          settings = {
            theme = "default";
          };
        };
      };
    };
  }
