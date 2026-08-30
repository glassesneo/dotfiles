{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.nvf.languages.nix";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {myconfig, ...}: {
    programs.nvf = {
      settings.vim = {
        languages.nix = {
          enable = true;
          treesitter.enable = myconfig.programs.nvf.treesitter.enable;
          lsp = {
            servers = ["nil"];
          };
          format = {
            enable = true;
            type = ["alejandra"];
          };
          extraDiagnostics.enable = true;
        };
        lsp.servers.nil.settings.nil = {
          formatting.command = ["alejandra"];
        };
        autocmds = [
          {
            event = ["FileType"];
            pattern = ["nix"];
            desc = "Match Nix buffer indentation to Alejandra defaults";
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
    };
  };
}
