{
  delib,
  lib,
  pkgs,
  ...
}:
# Do not set vim.languages.nim.enable: upstream nvf asserts Nim support is
# Linux-only (packaged nimlsp). Treesitter and PATH-gated nimlangserver are
# wired here instead, matching the project-tool contract.
delib.module {
  name = "programs.nvf.languages.nim";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim = {
    treesitter.grammars = [pkgs.vimPlugins.nvim-treesitter.grammarPlugins.nim];
    lsp.lspconfig.sources.nim = builtins.readFile ./lsp.lua;
    autocmds = [
      {
        event = ["FileType"];
        pattern = ["nim"];
        desc = "Match Nim buffer indentation to nph defaults";
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
