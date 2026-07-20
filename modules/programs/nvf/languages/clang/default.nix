{delib, ...}:
delib.module {
  name = "programs.nvf.languages.c";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim = {
    languages.clang = {
      enable = true;
      treesitter.enable = true;
      lsp.enable = false;
      format.enable = false;
      extraDiagnostics.enable = false;
    };
    lsp.lspconfig.sources.clang = builtins.readFile ./lsp.lua;
    formatter.conform-nvim.setupOpts = {
      formatters.clang-format.command = "clang-format";
      formatters_by_ft.c = ["clang-format"];
    };
  };
}
