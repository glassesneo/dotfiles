{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.nvf.languages.zig";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim = {
    languages.zig = {
      enable = true;
      treesitter.enable = true;
      lsp.enable = false;
    };
    lsp.lspconfig.sources.zig = builtins.readFile ./lsp.lua;
    autocmds = [
      {
        event = ["FileType"];
        pattern = ["zig"];
        desc = "Match Zig buffer indentation to zig fmt defaults";
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
