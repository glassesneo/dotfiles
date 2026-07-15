{delib, ...}:
delib.module {
  name = "programs.nvf.languages.lua";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim.languages.lua = {
    enable = true;
    treesitter.enable = true;
    lsp.enable = false;
    format.enable = false;
    extraDiagnostics.enable = false;
  };
}
