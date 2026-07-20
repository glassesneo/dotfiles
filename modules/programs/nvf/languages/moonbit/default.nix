{
  delib,
  inputs,
  pkgs,
  ...
}: let
  # The parser is repository-owned; MoonBit's toolchain and LSP remain bare
  # commands supplied by the active project environment.
  moonbitGrammar = pkgs.tree-sitter.buildGrammar {
    language = "moonbit";
    version = "0.0.0+rev=a5a7e0b";
    src = inputs.tree-sitter-moonbit;
    meta.homepage = "https://github.com/moonbitlang/tree-sitter-moonbit";
  };
in
  delib.module {
    name = "programs.nvf.languages.moonbit";
    options = delib.singleCascadeEnableOption;
    home.ifEnabled.programs.nvf.settings.vim = {
      lsp.lspconfig.sources.moonbit = builtins.readFile ./lsp.lua;
      treesitter.grammars = [moonbitGrammar];
      filetype.extension = {
        mbt = "moonbit";
        mbti = "moonbit";
        mbi = "moonbit";
      };
      luaConfigRC.moonbit-treesitter = ''
        vim.api.nvim_create_autocmd("FileType", {
          pattern = "moonbit",
          callback = function(args)
            pcall(vim.treesitter.start, args.buf)
          end,
        })
      '';
    };
  }
