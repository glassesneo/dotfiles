{delib, ...}:
delib.module {
  name = "programs.nixvim.plugins.toggleterm";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins = {
      toggleterm = {
        enable = true;
        settings = {
          direction = "float";
          float_opts = {
            border = "curved";
            height = 30;
            width = 130;
          };
          open_mapping = "[[<Space>\\]]";
          insert_mappings = false;
        };
      };
    };
  };
}
