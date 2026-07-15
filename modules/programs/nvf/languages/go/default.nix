{delib, ...}:
delib.module {
  name = "programs.nvf.languages.go";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim.languages.go = {
    enable = true;
    treesitter.enable = true;
    lsp.enable = false;
    format.enable = false;
    extraDiagnostics.enable = false;
  };
}
