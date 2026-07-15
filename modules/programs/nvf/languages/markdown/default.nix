{delib, ...}:
delib.module {
  name = "programs.nvf.languages.markdown";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim.languages.markdown = {
    enable = true;
    treesitter.enable = true;
    lsp.enable = false;
    format.enable = false;
    extraDiagnostics.enable = false;
    extensions.render-markdown-nvim.enable = false;
    extensions.markview-nvim.enable = false;
  };
}
