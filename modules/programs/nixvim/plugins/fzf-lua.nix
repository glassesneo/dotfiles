{delib, ...}:
delib.module {
  name = "programs.nixvim.plugins.fzf-lua";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins = {
      fzf-lua = {
        enable = true;
        settings = {
          files = {
            color_icons = true;
            file_icons = true;
            find_opts = {
              __raw = "[[-type f -not -path '*.git/objects*' -not -path '*.env*']]";
            };
            multiprocess = true;
            prompt = "Files❯ ";
          };
          winopts = {
            col = 0.5;
            height = 0.5;
            row = 0.9;
            width = 0.93;
            backdrop = 100;
            border = "single";
          };
          fzf_colors = {
            __unkeyed-1 = true;
            bg = "-1";
            gutter = "-1";
          };
        };
        luaConfig = {
          post = ''
            require("fzf-lua").register_ui_select()
          '';
        };
        lazyLoad = {
          enable = true;
          settings = {
            cmd = ["FzfLua"];
            keys = [
              {
                __unkeyed-1 = "<Space><Space>";
                __unkeyed-3 = "<Cmd>FzfLua files<CR>";
              }
              {
                __unkeyed-1 = "<Space>g";
                __unkeyed-3 = "<Cmd>FzfLua live_grep<CR>";
              }
              {
                __unkeyed-1 = "<Space>o";
                __unkeyed-3 = "<Cmd>FzfLua oldfiles cwd_only=true stat_file=true<CR>";
              }
            ];
          };
        };
      };
    };
    extraConfigLua = ''
      vim.ui.select = function(items, opts, on_choice)
        require("lz.n").trigger_load("fzf-lua")
        return vim.ui.select(items, opts, on_choice)
      end
    '';
  };
}
