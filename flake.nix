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
    inherit (pkgs) lib;

    treefmt = treefmt-nix.lib.evalModule pkgs {
      projectRootFile = "flake.nix";
      programs.alejandra.enable = true;
    };

    configuration = denix.lib.denixConfiguration {
      extraInputs = inputs;

      modules =
        [
          denix.denixModules.nixDarwin
          ./adapters/hjem.nix
          ./extensions/hosts.nix
        ]
        ++ lib.fileset.toList (
          lib.fileset.fileFilter
          (file: file.name == "default.nix")
          ./abstractions
        );
    };

    hosts = configuration.config.hosts;
  in {
    darwinConfigurations =
      builtins.mapAttrs
      (hostName: _:
        configuration.genSystem {
          moduleSystem = "darwin";
          host = hostName;
        })
      (lib.filterAttrs
        (_: host: (lib.systems.elaborate host.system).isDarwin)
        hosts);

    hjemConfigurations =
      lib.concatMapAttrs
      (hostName: host:
        lib.mapAttrs'
        (userName: user:
          lib.nameValuePair "${userName}@${hostName}" (configuration.genSystem {
            moduleSystem = "hjem";
            host = hostName;

            extraArgs = {
              inherit (host) system;
              inherit (user) homeDirectory;
              username = userName;
            };
          }))
        host.users)
      hosts;

    packages.${system}.hjem = inputs.hjem.packages.${system}.hjem;

    devShells.${system}.default = pkgs.mkShellNoCC {
      packages = [pkgs.just pkgs.nushell self.packages.${system}.hjem];
    };

    formatter.${system} = treefmt.config.build.wrapper;
    checks.${system} =
      import ./tests {
        inherit inputs denix pkgs system;
      }
      // {
        formatting = treefmt.config.build.check self;
      };
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
