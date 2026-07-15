{delib, ...}:
delib.module {
  name = "programs.nvf.languages.python";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim.languages.python = {
    enable = true;
    treesitter.enable = true;
    lsp.enable = false;
    format.enable = false;
    extraDiagnostics.enable = false;
  };
}
