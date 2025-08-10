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
            col = 0.3;
            height = 0.5;
            row = 0.99;
            width = 0.93;
          };
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
            ];
          };
        };
      };
    };
    keymaps = [
      # {
      # action = "<Cmd>FzfLua files<CR>";
      # key = "<Space><Space>";
      # options = {
      # silent = true;
      # };
      # }
      # {
      # action = "<Cmd>FzfLua live_grep<CR>";
      # key = "<Space>g";
      # options = {
      # silent = true;
      # };
      # }
    ];
  };
}
