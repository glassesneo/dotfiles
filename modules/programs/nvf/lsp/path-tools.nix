{delib, ...}:
delib.module {
  name = "programs.nvf.lsp";

  # Every non-Nix server is configured with a bare command. root_dir is also
  # the executable gate: when a project devShell does not provide the command,
  # it deliberately never completes and Neovim does not start that client.
  home.ifEnabled.programs.nvf.settings.vim.lsp.lspconfig.sources.path-tools =
    builtins.readFile ./path-tools.lua;
}
