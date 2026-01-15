{delib, ...}:
delib.module {
  name = "programs.nixvim";

  home.ifEnabled.programs.nixvim = {
    colorschemes = {
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
  };
}
