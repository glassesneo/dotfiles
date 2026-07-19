{delib, ...}:
delib.module {
  name = "programs.nvf.languages.python";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nvf.settings.vim.languages.python = {
    enable = true;
    treesitter.enable = true;
    # PATH-gated ty and Ruff servers are configured in lsp/path-tools.lua.
    lsp.enable = false;
    # Ruff LSP owns formatting, with Conform's bare Ruff command as fallback.
    format.enable = false;
    extraDiagnostics.enable = false;
  };
}
