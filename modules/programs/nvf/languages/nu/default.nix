{delib, ...}:
delib.module {
  name = "programs.nvf.languages.nu";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim = {
    languages.nu = {
      enable = true;
      treesitter.enable = true;
      lsp.enable = false;
    };
    lsp.lspconfig.sources.nu = builtins.readFile ./lsp.lua;
  };
}
