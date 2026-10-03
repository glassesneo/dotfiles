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
      programs = {
        alejandra = {
          enable = true;
        };

        just = {
          enable = true;
          indentation = "  ";
        };
      };
    };

    configuration = denix.lib.denixConfiguration {
      extraInputs = inputs;
      specialArgs.mylib = import ./lib {inherit lib;};

      modules =
        [
          denix.denixModules.nixDarwin
          ./adapters/hjem.nix
          ./extensions/hosts.nix
          ./extensions/module-dependencies.nix
          ./extensions/module-metadata.nix
          ./extensions/provenance.nix
        ]
        ++ lib.fileset.toList (
          lib.fileset.fileFilter
          (file: file.name == "default.nix")
          ./abstractions
        );
    };

    hosts = configuration.config.hosts;
    moduleDocs = pkgs.writeText "modules.md" (import ./lib/module-docs.nix {inherit lib;} {
      inherit configuration;
      root = self;
    });
    commitHooks = import ./git-hooks.nix {
      inherit pkgs system;
      inherit (inputs) git-hooks;
      src = self;
    };
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

    packages.${system} = {
      hjem = inputs.hjem.packages.${system}.hjem;
      module-docs = moduleDocs;
    };

    devShells.${system}.default = pkgs.mkShellNoCC {
      packages = [pkgs.just pkgs.nushell self.packages.${system}.hjem];
      inherit (commitHooks) shellHook;
    };

    formatter.${system} = treefmt.config.build.wrapper;
    checks.${system} =
      import ./tests {
        inherit inputs denix pkgs system configuration;
      }
      // {
        formatting = treefmt.config.build.check self;
      };
  };

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
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
