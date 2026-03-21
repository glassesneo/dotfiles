{delib, ...}:
delib.module {
  name = "programs.nixvim.plugins.kulala";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins.kulala = {
      enable = true;
      settings = {
        global_keymaps = true;
        global_keymaps_prefix = "<leader>R";
        ui = {
          display_mode = "split";
          split_direction = "vertical";
          default_view = "body";
          winbar = true;
        };
        lsp = {
          enable = true;
        };
      };
      lazyLoad = {
        enable = true;
        settings = {
          ft = ["http" "rest"];
        };
      };
    };
  };
}
