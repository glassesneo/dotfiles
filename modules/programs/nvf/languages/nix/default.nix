{delib, ...}:
delib.module {
  name = "programs.nvf.nix";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.nvf = {
      settings.vim.languages.nix = {
        enable = true;
        treesitter.enable = true;
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
