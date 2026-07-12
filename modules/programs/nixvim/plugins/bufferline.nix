{delib, ...}:
delib.module {
  name = "programs.nixvim.plugins.bufferline";

  options = delib.singleEnableOption true;

  home.ifEnabled = {myconfig, ...}: let
    appearance = myconfig.programs.nixvim.appearance;
    colors = myconfig.colorscheme;
    standardHighlights = {
      buffer_selected = {
        fg = colors.base07;
        bold = true;
        italic = false;
        underline = true;
        sp =
          if appearance.theme == "everforest"
          then colors.base0B
          else colors.base08;
      };
      buffer_visible.fg = colors.base05;
      background.fg = colors.base04;
      indicator_selected = {
        fg =
          if appearance.theme == "everforest"
          then colors.base0B
          else colors.base08;
        sp =
          if appearance.theme == "everforest"
          then colors.base0B
          else colors.base08;
        underline = true;
      };
      indicator_visible.fg = colors.base04;
      separator.fg = colors.base02;
      separator_selected.fg = colors.base02;
      separator_visible.fg = colors.base02;
      modified_selected.fg =
        if appearance.theme == "everforest"
        then colors.base0B
        else colors.base08;
      modified_visible.fg = colors.base05;
      modified.fg = colors.base04;
      tab_selected = {
        fg = colors.base07;
        bold = true;
      };
      tab.fg = colors.base04;
    };
  in {
    programs.nixvim.plugins = {
      bufferline = {
        enable = true;
        settings = {
          options = {
            themable = true;
            buffer_close_icon = "";
            close_icon = "";
            separator_style = "thick";
            diagnostics = "nvim_lsp";
            indicator.style = "underline";
            show_tab_indicators = true;
          };
          highlights =
            if appearance.theme == "catppuccin"
            then {
              __raw = ''
                (function()
                  local theme = require("catppuccin.special.bufferline").get_theme()()
                  theme.buffer_selected = vim.tbl_extend("force", theme.buffer_selected or {}, {
                    bold = true, italic = false, underline = true, sp = "${colors.base0E}",
                  })
                  theme.indicator_selected = vim.tbl_extend("force", theme.indicator_selected or {}, {
                    fg = "${colors.base0E}", sp = "${colors.base0E}", underline = true,
                  })
                  theme.tab_selected = vim.tbl_extend("force", theme.tab_selected or {}, {
                    fg = "${colors.base07}", bold = true,
                  })
                  return theme
                end)()
              '';
            }
            else standardHighlights;
        };
      };
    };
  };
}
