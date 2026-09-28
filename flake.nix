{
  description = "Modular configuration of everything I own, with Denix";
  outputs = inputs @ {
    self,
    nixpkgs,
    denix,
    treefmt-nix,
    ...
  }: let
    system = "aarch64-darwin";
    pkgs = nixpkgs.legacyPackages.${system};

    treefmt = treefmt-nix.lib.evalModule pkgs {
      projectRootFile = "flake.nix";
      programs.alejandra.enable = true;
    };

    configuration = denix.lib.denixConfiguration {
      extraInputs = inputs;

      modules = [
        denix.denixModules.nixDarwin
        {
          hosts.seiran.darwin.ifEnabled = {
            nixpkgs.hostPlatform = system;
            system.stateVersion = 4;
            system.primaryUser = "neo";

            users.users.neo = {
              name = "neo";
              home = "/Users/neo";
            };
          };
        }
      ];
    };
  in {
    darwinConfigurations.seiran = configuration.genSystem {
      moduleSystem = "darwin";
      host = "seiran";
    };

    formatter.${system} = treefmt.config.build.wrapper;
    checks.${system}.formatting = treefmt.config.build.check self;
  };

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    denix = {
      url = "github:yunfachi/denix/rewrite";
      inputs = {
        nixpkgs.follows = "nixpkgs";
      };
    };
    nix-darwin = {
      url = "github:nix-darwin/nix-darwin/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    hjem = {
      url = "github:feel-co/hjem";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
}
