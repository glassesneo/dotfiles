{delib, ...}:
delib.module {
  name = "programs.nvf.languages.bash";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim = {
    languages.bash = {
      enable = true;
      treesitter.enable = true;
      lsp.enable = false;
      format.enable = false;
      extraDiagnostics.enable = false;
    };
    lsp.lspconfig.sources.bash = builtins.readFile ./lsp.lua;
    formatter.conform-nvim.setupOpts = {
      formatters.shfmt.command = "shfmt";
      formatters_by_ft = {
        sh = ["shfmt"];
        bash = ["shfmt"];
      };
    };
  };
}
