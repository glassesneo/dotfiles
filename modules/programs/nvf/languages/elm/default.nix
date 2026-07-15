{delib, ...}:
delib.module {
  name = "programs.nvf.languages.elm";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim.languages.elm = {
    enable = true;
    treesitter.enable = true;
    lsp.enable = false;
  };
}
