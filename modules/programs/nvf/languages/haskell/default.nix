{delib, ...}:
delib.module {
  name = "programs.nvf.languages.haskell";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim.languages.haskell = {
    enable = true;
    treesitter.enable = true;
    lsp.enable = false;
    format.enable = false;
    dap.enable = false;
    extensions.haskell-tools.enable = false;
  };
}
