{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nvf.visuals";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.nvf.settings.vim = {
      lazy.plugins."tiny-glimmer.nvim" = {
        package = pkgs.vimPlugins.tiny-glimmer-nvim;
        event = ["DeferredUIEnter"];
        after = ''
          require("tiny-glimmer").setup({
            overwrite = {
              auto_map = true,
              yank = { enabled = true },
              paste = { enabled = true },
              search = { enabled = false },
              undo = { enabled = true },
              -- r is redo here (swapped with <C-r> in keymaps).
              redo = { enabled = true, redo_mapping = "r" },
            },
          })
        '';
      };

      visuals = {
        fidget-nvim = {
          enable = true;
          setupOpts = {
            progress = {
              display = {
                done_icon = "✓";
                progress_icon.pattern = "dots";
                render_limit = 16;
              };
              suppress_on_insert = false;
            };
            notification = {
              window = {
                border = "none";
                winblend = 100;
              };
            };
          };
        };
        cinnamon-nvim = {
          enable = true;
          setupOpts = {
            keymaps = {
              basic = true;
              extra = false;
            };
            options = {
              mode = "cursor";
              count_only = false;
              wrap = false;
            };
          };
        };
      };
    };
  };
}
