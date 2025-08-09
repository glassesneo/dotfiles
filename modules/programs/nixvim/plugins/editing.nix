{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.editing";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins = {
      parinfer-rust = {
        # enable = true;
        settings = {
          force_balance = true;
        };
      };
      nvim-surround = {
        enable = true;
        lazyLoad = {
          enable = true;
          settings = {
            event = [
              "VimEnter"
            ];
          };
        };
      };
      autoclose = {
        enable = true;
        settings.options = {
          auto_indent = true;
        };
        lazyLoad = {
          enable = true;
          settings = {
            event = [
              "InsertEnter"
              "CmdlineEnter"
            ];
          };
        };
      };
    };
    extraPlugins = [
      pkgs.vimPlugins.tabout-nvim
    ];
    extraConfigLuaPre = ''
      require("tabout").setup({})
    '';
  };
}
