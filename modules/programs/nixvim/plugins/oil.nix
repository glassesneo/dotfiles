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
            "<C-p>" = "actions.preview";
            "q" = "actions.close";
          };
          view_options = {
            show_hidden = true;
            is_always_hidden.__raw = ''
              function(name, bufnr)
                return name == ".."
              end
            '';
          };
          float = {
            padding = 0;
            win_options.winblend = 0;
          };
          preview_win = {
            update_on_cursor_moved = true;
          };
          win_options = {
            winblend = 0;
          };
        };
      };
    };
    keymaps = [
      {
        # action = "<Cmd>Oil<CR>";
        action.__raw = ''
          function()
            local oil = require("oil")
            local util = require("oil.util")
            oil.open()
            util.run_after_load(0, function()
              oil.open_preview({
                split = "botright",
              })
            end)
          end
        '';
        key = "<Space>f";
      }
    ];
  };
}
