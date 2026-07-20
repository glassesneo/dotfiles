{
  delib,
  lib,
  ...
}:
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
    autocmds = [
      {
        event = ["FileType"];
        pattern = ["sh" "bash"];
        desc = "Match Shell buffer indentation to shfmt defaults (tabs)";
        callback = lib.generators.mkLuaInline ''
          function(args)
            vim.bo[args.buf].expandtab = false
            vim.bo[args.buf].tabstop = 4
            vim.bo[args.buf].shiftwidth = 4
            vim.bo[args.buf].softtabstop = 4
          end
        '';
      }
    ];
  };
}
