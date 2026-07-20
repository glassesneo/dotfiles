{delib, ...}:
delib.module {
  name = "programs.nvf.languages.python";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nvf.settings.vim = {
    languages.python = {
      enable = true;
      treesitter.enable = true;
      lsp.enable = false;
      # Ruff LSP owns formatting; no CLI formatter fallback is configured.
      format.enable = false;
      extraDiagnostics.enable = false;
    };
    lsp.lspconfig.sources.python = builtins.readFile ./lsp.lua;
  };
}
