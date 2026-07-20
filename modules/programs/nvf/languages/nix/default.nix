{
  delib,
  host,
  lib,
  ...
}:
delib.module {
  name = "programs.nvf.languages.nix";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {myconfig, ...}: {
    programs.nvf = {
      settings.vim.languages.nix = {
        enable = true;
        treesitter.enable = myconfig.programs.nvf.treesitter.enable;
        lsp = {
          servers = ["nixd"];
        };
        format = {
          enable = true;
          type = ["alejandra"];
        };
        extraDiagnostics.enable = true;
      };
      settings.vim.lsp.servers.nixd = {
        # cmd = lib.mkForce ["nixd"];
        settings.nixd = {
          nixpkgs = {
            expr = "import <nixpkgs> { }";
          };

          formatting = {
            command = ["alejandra"];
          };

          options = {
            nix-darwin = {
              expr = "(builtins.getFlake (builtins.toString ./.)).darwinConfigurations.${host.name}.options";
            };

            home-manager = {
              expr = "(builtins.getFlake (builtins.toString ./.)).homeConfigurations.${host.name}.options";
            };
          };
        };
      };
      settings.vim.autocmds = [
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
}
