{delib, ...}:
delib.module {
  name = "programs.nvf.languages.html";
  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nvf.settings.vim.languages.html = {
    enable = true;
    treesitter = {
      enable = true;
      autotagHtml = true;
    };
    lsp.enable = false;
    format.enable = false;
    extraDiagnostics.enable = false;
  };
}
