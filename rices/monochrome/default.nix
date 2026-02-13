{
  delib,
  inputs,
  ...
}: let
  # Monochrome palette with pink accent (based on image)
  colors = {
    # Base backgrounds
    base00 = "#1a1a1a"; # Background
    base01 = "#252525"; # Lighter background (status bars)
    base02 = "#303030"; # Selection background
    base03 = "#505050"; # Comments, invisibles
    base04 = "#6c7891"; # Dark foreground (status bars)
    base05 = "#abb2bf"; # Default foreground
    base06 = "#c0c0c0"; # Light foreground
    base07 = "#e0e0e0"; # Lightest foreground

    # Accent colors - pink/magenta for keywords, rest monochrome
    base08 = "#e06c75"; # Pink - Variables, XML Tags, Markup Link Text
    base09 = "#a0a0a0"; # Gray - Integers, Boolean, Constants
    base0A = "#a0a0a0"; # Gray - Classes, Markup Bold
    base0B = "#a0a0a0"; # Gray - Strings, Inherited Class
    base0C = "#a0a0a0"; # Gray - Support, Regular Expressions
    base0D = "#a0a0a0"; # Gray - Functions, Methods
    base0E = "#e06c75"; # Pink - Keywords, Storage, Selector
    base0F = "#a0a0a0"; # Gray - Deprecated, Embedded
  };

  # Convert hex to sketchybar format (0xffRRGGBB)
  toSketchybar = hex: "0xff${builtins.substring 1 6 hex}";
in
  delib.rice {
    name = "monochrome";
    inherits = ["laptop"];

    myconfig.services.sketchybar = {
      colors = {
        # Monochrome palette - only app icons, battery, CPU use actual colors
        # All "accent" colors are gray for monochrome look
        rosewater = toSketchybar colors.base05;
        flamingo = toSketchybar colors.base05;
        pink = toSketchybar colors.base08; # Keep pink for special accents
        mauve = toSketchybar colors.base05;
        red = toSketchybar colors.base08; # Keep for battery/CPU warnings
        maroon = toSketchybar colors.base05;
        peach = toSketchybar colors.base05;
        yellow = toSketchybar colors.base05; # Keep for battery/CPU warnings
        green = toSketchybar colors.base05; # Keep for battery/CPU good status
        teal = toSketchybar colors.base05;
        sky = toSketchybar colors.base05;
        sapphire = toSketchybar colors.base05;
        blue = toSketchybar colors.base05;
        lavender = toSketchybar colors.base05;
        # Text hierarchy - muted for monochrome aesthetic
        text = toSketchybar colors.base05; # Reduced from base07 for less vividness
        subtext1 = toSketchybar colors.base04;
        subtext0 = toSketchybar colors.base03;
        # Overlay/muted elements
        overlay2 = toSketchybar colors.base04;
        overlay1 = toSketchybar colors.base03;
        overlay0 = toSketchybar colors.base02;
        # Surface hierarchy (backgrounds)
        surface2 = toSketchybar colors.base02;
        surface1 = toSketchybar colors.base01;
        surface0 = toSketchybar colors.base01;
        # Base backgrounds
        base = toSketchybar colors.base00;
        mantle = toSketchybar colors.base00;
        crust = toSketchybar colors.base00;
      };
      # App-specific icon colors - these stay colorful even in monochrome
      appColors = {
        arc = "0xfff5bde6"; # Pink
        ghostty = "0xff8aadf4"; # Blue
        obsidian = "0xffc6a0f6"; # Purple/Mauve
        kitty = "0xfff0c6c6"; # Flamingo/Coral
      };
      electricity = "0xffd4a020"; # Darker gold - electricity
      # Monochrome CPU colors - grayscale gradient from light to dark
      cpuColors = {
        low = "0xff606060"; # Dark gray
        medium = "0xff808080"; # Medium gray
        high = "0xffa0a0a0"; # Light gray
        critical = "0xffe06c75"; # Pink accent for critical
      };
      # Transparent outer bar background
      bar.color = "0x00000000"; # Fully transparent
      # Red-bordered right bracket grouping (solid border with good spacing)
      rightBracket = {
        enable = true;
        backgroundColor = "0x33000000";
        blurRadius = "16";
        borderWidth = "1.5";
        borderColor = toSketchybar colors.base05; # Light gray
        cornerRadius = "4";
        height = "36";
        paddingLeft = "16";
        paddingRight = "16";
      };
      leftBracket = {
        enable = true;
        backgroundColor = "0x00000000";
        borderWidth = "1.5";
        borderColor = toSketchybar colors.base05; # Light gray
        cornerRadius = "4";
        height = "32";
        paddingLeft = "12";
        paddingRight = "12";
      };
    };

    # myconfig.services.jankyborders = {
    # enable = true;
    # active_color = colors.base05;
    # inactive_color = colors.base03;
    # style = "round";
    # width = 4.0;
    # hidpi = true;
    # };

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
        set -g status-style 'bg=${colors.base01},fg=${colors.base05}'
        set -g status-left '#[fg=${colors.base08},bold][#S] '
        set -g status-left-length 20
        set -g status-right ""
        set -g window-status-format '#[fg=${colors.base04}] #I:#W '
        set -g window-status-current-format '#[fg=${colors.base07},bold,underscore] #I:#W '
        set -g window-status-separator ""
        set -g pane-border-style 'fg=${colors.base02}'
        set -g pane-active-border-style 'fg=${colors.base08}'
        set -g message-style 'fg=${colors.base05},bg=${colors.base01}'
      '';
    };

    home = {
      programs = {
        desktoppr = {
          settings = {
            picture = "${inputs.various-wallpapers}/onedark/J0FZ3V.jpg";
          };
        };
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
            # Bufferline transparency
            BufferLineFill.bg = "none";
            BufferLineBackground.bg = "none";
            BufferLineBuffer.bg = "none";
            BufferLineBufferVisible.bg = "none";
            BufferLineBufferSelected.bg = "none";
            BufferLineTab.bg = "none";
            BufferLineTabSelected.bg = "none";
            BufferLineTabClose.bg = "none";
            BufferLineSeparator.bg = "none";
            BufferLineSeparatorVisible.bg = "none";
            BufferLineSeparatorSelected.bg = "none";
            BufferLineIndicatorSelected.bg = "none";
            BufferLineIndicatorVisible.bg = "none";
            BufferLineCloseButton.bg = "none";
            BufferLineCloseButtonVisible.bg = "none";
            BufferLineCloseButtonSelected.bg = "none";
            BufferLineModified.bg = "none";
            BufferLineModifiedVisible.bg = "none";
            BufferLineModifiedSelected.bg = "none";
            BufferLineDuplicate.bg = "none";
            BufferLineDuplicateVisible.bg = "none";
            BufferLineDuplicateSelected.bg = "none";
            BufferLineNumbers.bg = "none";
            BufferLineNumbersVisible.bg = "none";
            BufferLineNumbersSelected.bg = "none";
            BufferLinePick.bg = "none";
            BufferLinePickVisible.bg = "none";
            BufferLinePickSelected.bg = "none";
            BufferLineOffsetSeparator.bg = "none";
            BufferLineTabSeparator.bg = "none";
            BufferLineTabSeparatorSelected.bg = "none";
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
