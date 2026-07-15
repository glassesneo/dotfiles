{delib, ...}:
delib.module {
  name = "programs.nvf.languages.typescript";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim.languages.typescript = {
    enable = true;
    treesitter.enable = true;
    lsp.enable = false;
    format.enable = false;
    extraDiagnostics.enable = false;
  };
}
