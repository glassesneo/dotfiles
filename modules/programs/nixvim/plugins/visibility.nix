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
        enable = true;
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
          preset = "classic";
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
      hlchunk-nvim
      quick-scope
      # nvim_context_vt
    ];
    extraConfigLua = ''
      require('hlchunk').setup({
        chunk = {
          -- enable = true,
          style = {
            "#f9e2af",
            "#f38ba8",
          },
          chars = {
            horizontal_line = "─",
            vertical_line = "│",
            left_top = "╭",
            left_bottom = "╰",
            right_arrow = ">",
          },
          style = "#806d9c",
        },
        line_num = {
          enable = true,
          style = "#f9e2af",
        },
        indent = {
          enable = true,
          style = "#6c7086",
        },
      })
      -- require('nvim_context_vt').setup({
        -- prefix = "",
      -- })
    '';
  };
}
