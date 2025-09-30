{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.visibility";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins = {
      hlchunk = {
        # enable = true;
        lazyLoad = {
          enable = true;
          settings = {
            event = ["BufRead" "BufNewFile"];
          };
        };
        settings = {
          chunk.enable = false;
          line_num = {
            enable = true;
            style = "#f9e2af";
          };
          indent = {
            enable = true;
            style = "#6c7086";
          };
        };
      };
      marks = {
        enable = true;
        defaultMappings = false;
      };
      neoscroll = {
        enable = true;
        settings = {
          easing_function = "quadratic";
          hide_cursor = false;
          stop_eof = false;
          respect_scrolloff = true;
        };
        lazyLoad = {
          enable = true;
          settings = {
            keys = [
              "<C-u>"
              "<C-d>"
              "<C-b>"
              "<C-f>"
              "zt"
              "zz"
              "zb"
            ];
          };
        };
      };
      render-markdown = let
        ft = ["markdown"];
      in {
        enable = true;
        lazyLoad = {
          enable = true;
          settings = {
            inherit ft;
          };
        };
        settings = {
          file_types = ft;
        };
      };
      smear-cursor = {
        # enable = true;
        settings = {
          distance_stop_animating = 40;
          smear_to_cmd = false;
        };
      };
      tiny-inline-diagnostic = {
        # enable = true;
        lazyLoad = {
          enable = true;
          settings = {
            event = ["LspAttach"];
          };
        };
        settings = {
          multilines = {
            enabled = true;
          };
          options = {
            use_icons_from_diagnostic = true;
          };
          preset = "powerline";
          virt_texts = {
            priority = 2048;
          };
        };
      };
      treesitter-context = {
        # enable = true;
        settings = {
          separator = "―";
        };
      };
    };
    extraPlugins = with pkgs.vimPlugins; [
      quick-scope
      # nvim_context_vt
    ];
  };
}
