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
        };
      };
    };
    myconfig = {myconfig, ...}: {
      services.sketchybar = {
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

      # Use rice-aware options for vim and tmux
      programs.myvimeditor.colorscheme = {
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
          set -g @catppuccin_window_status_style 'rounded'
          set -g @catppuccin_status_background 'none'
        '';
        # Status line modules must be set AFTER the plugin loads
        extraConfig = ''
          set -g status-right-length 100
          set -g status-left-length 100
          set -g status-left ""
          set -g status-right "#{E:@catppuccin_status_session}"
        '';
      };
    };
  }
