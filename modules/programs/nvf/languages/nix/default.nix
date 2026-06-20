{delib, ...}:
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
              expr = "(builtins.getFlake (builtins.toString ./.)).darwinConfigurations.<hostname>.options";
            };

            home-manager = {
              expr = "(builtins.getFlake (builtins.toString ./.)).homeConfigurations.\"<name>\".options";
            };
          };
        };
      };
    };
  };
}
