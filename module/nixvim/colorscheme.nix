{
  colorschemes = {
    catppuccin = {
      enable = true;
      settings = {
        flavour = "mocha";
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
    };
    # cyberdream = {
    #   enable = true;
    #   settings = {
    #     hide_fillchars = true;
    #     italic_comments = true;
    #     transparent = true;
    #   };
    # };
    monokai-pro = {
      enable = false;
      settings = {
        devicons = true;
        filter = "ristretto";
        terminal_colors = true;
        transparent_background = true;
        background_clear = [
          "notify"
          "bufferline"
        ];
        plugins = {
          bufferline = {
            bold = true;
            underline_fill = false;
            underline_selected = false;
            underline_visible = false;
          };
        };
      };
    };
  };
  highlightOverride = {
    CursorLineNr = {
      fg = "#f5f5f5";
    };
  };
}
