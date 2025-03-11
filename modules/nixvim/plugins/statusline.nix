{
  plugins = {
    lualine = {
      enable = true;
    };
    navic = {
      enable = true;
    };
    bufferline = {
      enable = true;
      settings = {
        options = {
          themable = true;
          buffer_close_icon = "";
          close_icon = "";
          diagnostics = "nvim_lsp";
        };
      };
    };
  };
}
