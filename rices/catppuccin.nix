{delib, ...}:
delib.rice {
  name = "catppuccin";
  inherits = ["laptop"];

  home = {
    programs = {
      ghostty = {
        settings = {
          theme = "Catppuccin Mocha";
          background-opacity = 0.7;
          background-blur = 5;
        };
      };
      nixvim = {
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
            lazyLoad.enable = true;
          };
        };
        plugins = {
          bufferline = {
            settings = {
              highlights.__raw = ''
                require("catppuccin.special.bufferline").get_theme()
              '';
            };
          };
        };
      };
      opencode = {
        settings = {
          theme = "catppuccin";
        };
      };
      zellij = {
        settings = {
          theme = "catppuccin-macchiato";
        };
      };
    };
  };
}
