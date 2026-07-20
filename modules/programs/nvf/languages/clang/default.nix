{
  delib,
  lib,
  ...
}:
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
    autocmds = [
      {
        event = ["FileType"];
        pattern = ["c"];
        desc = "Match C buffer indentation to clang-format defaults";
        callback = lib.generators.mkLuaInline ''
          function(args)
            vim.bo[args.buf].expandtab = true
            vim.bo[args.buf].tabstop = 2
            vim.bo[args.buf].shiftwidth = 2
            vim.bo[args.buf].softtabstop = 2
          end
        '';
      }
    ];
  };
}
