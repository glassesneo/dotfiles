{delib, ...}:
delib.module {
  name = "programs.nvf.visuals";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.nvf.settings.vim = {
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
