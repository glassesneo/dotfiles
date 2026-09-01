{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.nvf.languages.ocaml";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim = {
    languages.ocaml = {
      enable = true;
      treesitter.enable = true;
      lsp.enable = false;
      format.enable = false;
    };
    lsp.lspconfig.sources.ocaml = builtins.readFile ./lsp.lua;
    formatter.conform-nvim.setupOpts = {
      formatters.ocamlformat.command = "ocamlformat";
      formatters_by_ft = {
        ocaml = ["ocamlformat"];
        ocamlinterface = ["ocamlformat"];
      };
    };
    autocmds = [
      {
        event = ["FileType"];
        pattern = ["ocaml" "ocamlinterface"];
        desc = "Match OCaml buffer indentation to ocamlformat defaults";
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
