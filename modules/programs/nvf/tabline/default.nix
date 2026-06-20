{delib, ...}:
delib.module {
  name = "programs.nvf.tabline";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.nvf.settings.vim = {
      tabline = {
        nvimBufferline = {
          enable = true;
          setupOpts = {
            options = {
              themable = true;
              buffer_close_icon = "";
              close_icon = "";
              separator_style = "thick";
              diagnostics = "nvim_lsp";
            };
          };
        };
      };
    };
  };
}
