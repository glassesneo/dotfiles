{delib, ...}:
delib.rice {
  name = "catppuccin";
  inherits = ["laptop"];

  myconfig.services.sketchybar = {
    colors = {
      rosewater = "0xfff4dbd6";
      flamingo = "0xfff0c6c6";
      pink = "0xfff5bde6";
      mauve = "0xffc6a0f6";
      red = "0xffed8796";
      maroon = "0xffee99a0";
      peach = "0xfff5a97f";
      yellow = "0xffeed49f";
      green = "0xffa6da95";
      teal = "0xff8bd5ca";
      sky = "0xff91d7e3";
      sapphire = "0xff7dc4e4";
      blue = "0xff8aadf4";
      lavender = "0xffb7bdf8";
      text = "0xffcad3f5";
      subtext1 = "0xffb8c0e0";
      subtext0 = "0xffa5adcb";
      overlay2 = "0xff939ab7";
      overlay1 = "0xff8087a2";
      overlay0 = "0xff6e738d";
      surface2 = "0xff5b6078";
      surface1 = "0xff494d64";
      surface0 = "0xff363a4f";
      base = "0xff24273a";
      mantle = "0xff1e2030";
      crust = "0xff181926";
    };
    appColors = {
      arc = "0xfff5bde6"; # pink
      ghostty = "0xff8aadf4"; # blue
      obsidian = "0xffc6a0f6"; # mauve
      kitty = "0xfff0c6c6"; # flamingo
    };
    electricity = "0xffd4a84a"; # darker golden yellow
    cpuColors = {
      low = "0xffa6da95"; # green
      medium = "0xffeed49f"; # yellow
      high = "0xfff5a97f"; # peach
      critical = "0xffed8796"; # red
    };
    # Bar appearance - uses default crust color
    bar.color = "";
    # No right bracket grouping
    rightBracket.enable = false;
  };

  home = {
    programs = {
      ghostty = {
        settings = {
          theme = "Catppuccin Macchiato";
          background-opacity = 0.7;
          background-blur = 5;
        };
      };
      nixvim = {
        colorschemes = {
          catppuccin = {
            enable = true;
            settings = {
              flavour = "macchiato";
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
    };
  };
}
