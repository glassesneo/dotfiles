{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.nvf.languages.typst";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim = {
    languages.typst = {
      enable = true;
      treesitter.enable = true;
      lsp.enable = false;
      format.enable = false;
      extensions.typst-preview-nvim.enable = false;
      extensions.typst-concealer.enable = false;
    };
    lsp.lspconfig.sources.typst = builtins.readFile ./lsp.lua;
    formatter.conform-nvim.setupOpts = {
      formatters.typstyle.command = "typstyle";
      formatters_by_ft.typst = ["typstyle"];
    };
    autocmds = [
      {
        event = ["FileType"];
        pattern = ["typst"];
        desc = "Match Typst buffer indentation to Typstyle defaults";
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
