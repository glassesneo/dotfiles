{delib, ...}:
delib.module {
  name = "programs.nixvim.plugins.bufferline";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins = {
      bufferline = {
        enable = true;
        settings = {
          highlights.__raw = ''
            require("catppuccin.special.bufferline").get_theme()
          '';
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
}
