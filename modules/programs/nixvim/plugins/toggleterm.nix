{delib, ...}:
delib.module {
  name = "programs.nixvim.plugins.toggleterm";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins = {
      toggleterm = {
        # enable = true;
        settings = {
          direction = "float";
          float_opts = {
            border = "curved";
            height = 30;
            width = 130;
          };
          open_mapping = "[[<C-\\>]]";
          # insert_mappings = false;
        };
        lazyLoad = {
          enable = true;
          settings = {
            cmd = ["ToggleTerm"];
            keys = [
              {
                __unkeyed-1 = "<C-\\>";
                __unkeyed-3 = "<Cmd>ToggleTerm<CR>";
                mode = ["n" "i"];
              }
              {
                __unkeyed-1 = "<Space>t";
                __unkeyed-3 = "<Cmd>TermSelect<CR>";
                mode = ["n"];
              }
            ];
          };
        };
      };
    };
  };
}
