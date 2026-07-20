{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.nvf.languages.typescript";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim = {
    additionalRuntimePaths = [./runtime];
    languages.typescript = {
      enable = true;
      treesitter.enable = true;
      lsp.enable = false;
      format.enable = false;
      extraDiagnostics.enable = false;
    };
    lsp.lspconfig.sources.typescript = builtins.readFile ./lsp.lua;
    formatter.conform-nvim.setupOpts = {
      formatters.biome.command = "biome";
      formatters_by_ft = {
        javascript = lib.generators.mkLuaInline "function(bufnr) return require('nvf.typescript').formatters(bufnr) end";
        javascriptreact = lib.generators.mkLuaInline "function(bufnr) return require('nvf.typescript').formatters(bufnr) end";
        typescript = lib.generators.mkLuaInline "function(bufnr) return require('nvf.typescript').formatters(bufnr) end";
        typescriptreact = lib.generators.mkLuaInline "function(bufnr) return require('nvf.typescript').formatters(bufnr) end";
      };
    };
    autocmds = [
      {
        event = ["FileType"];
        pattern = ["javascript" "javascriptreact" "typescript" "typescriptreact"];
        desc = "Match JS/TS buffer indentation to Biome and Deno defaults";
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
