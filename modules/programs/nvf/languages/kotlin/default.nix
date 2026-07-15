{delib, ...}:
delib.module {
  name = "programs.nvf.languages.kotlin";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim.languages.kotlin = {
    enable = true;
    treesitter.enable = true;
    lsp.enable = false;
    extraDiagnostics.enable = false;
  };
}
