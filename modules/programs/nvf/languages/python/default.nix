{
  delib,
  lib,
  ...
}:
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
    autocmds = [
      {
        event = ["FileType"];
        pattern = ["python"];
        desc = "Match Python buffer indentation to Ruff defaults";
        callback = lib.generators.mkLuaInline ''
          function(args)
            vim.bo[args.buf].expandtab = true
            vim.bo[args.buf].tabstop = 4
            vim.bo[args.buf].shiftwidth = 4
            vim.bo[args.buf].softtabstop = 4
          end
        '';
      }
    ];
  };
}
