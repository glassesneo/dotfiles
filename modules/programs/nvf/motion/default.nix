{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nvf.motion";
  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nvf.settings.vim = {
    additionalRuntimePaths = [./runtime];

    mini.jump = {
      enable = true;
      setupOpts = {
        delay = {
          # eyeliner owns always-on hints; disable mini.jump's post-jump marks
          highlight = 10000000;
          # former clever-f timeout
          idle_stop = 2000;
        };
      };
    };

    lazy.plugins."eyeliner.nvim" = {
      package = pkgs.vimPlugins.eyeliner-nvim;
      event = ["BufEnter" "CursorMoved"];
      after = ''
        require("eyeliner").setup({
          highlight_on_key = false,
          default_keymaps = false,
          dim = false,
        })
      '';
    };

    keymaps = [
      {
        key = "*";
        mode = ["n"];
        lua = true;
        silent = true;
        action = "require('nvf.motion')";
      }
    ];
  };
}
