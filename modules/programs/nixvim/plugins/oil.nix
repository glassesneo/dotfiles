{delib, ...}:
delib.module {
  name = "programs.nixvim.plugins.oil";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins = {
      oil = {
        enable = true;
        settings = {
          columns = ["icon"];
          default_file_explorer = true;
          use_default_keymaps = false;
          skip_confirm_for_simple_edits = true;
          keymaps = {
            "<CR>" = "actions.select";
            "<BS>" = "actions.parent";
            "q" = "actions.close";
          };
          view_options = {
            show_hidden = true;
          };
          float = {
            padding = 0;
            win_options.winblend = 0;
          };
          win_options = {
            winblend = 0;
          };
        };
      };
    };
    keymaps = [
      {
        action = "<Cmd>Oil<CR>";
        key = "<Space>f";
      }
    ];
  };
}
