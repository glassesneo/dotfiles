{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nix-darwin = {
      url = "github:LnL7/nix-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # apple-fonts.url = "github:Lyndeno/apple-fonts.nix";
  };

  outputs = inputs @ {
    self,
    nixpkgs,
    home-manager,
    nix-darwin,
    ...
  }: let
    systems = [
      "aarch64-darwin"
      "aarch64-linux"
    ];
    forAllSystems = func:
      nixpkgs.lib.genAttrs systems (system: func nixpkgs.legacyPackages.${system});
  in {
    # for NixOS with home-manager
    nixosConfigurations = {
      "neo@nixos-dev-vm-01" = inputs.nixpkgs.lib.nixosSystem {
        system = "aarch64-linux";
        specialArgs = {
          inherit inputs;
          hostName = "nixos-dev-vm-01";
        };
        modules = [
          ./system/nixos/configuration.nix
          home-manager.nixosModules.home-manager
          {
            home-manager = {
              useGlobalPkgs = true;
              useUserPackages = true;
              extraSpecialArgs = {
                inherit inputs;
              };
              verbose = true;
              sharedModules = [];
              users.neo = import ./home/nixos-dev-vm-01.nix;
            };
          }
        ];
      };
    };
    # for non-NixOS with home-manager
    homeConfigurations = {
      "neo@ubuntu-dev-vm-01" = home-manager.lib.homeManagerConfiguration {
        pkgs = nixpkgs.legacyPackages."aarch64-linux";
        extraSpecialArgs = {
          inherit inputs;
        };
        modules = [
          ./home/ubuntu-dev-vm-01.nix
        ];
      };
    };
    # for darwin with home-manager
    darwinConfigurations = {
      "neo@macos-personal-laptop-01" = nix-darwin.lib.darwinSystem {
        system = "aarch64-darwin";
        inherit inputs;
        specialArgs = {
          inherit inputs;
          hostName = "macos-personal-laptop-01";
        };
        modules = [
          ./system/darwin
          home-manager.darwinModules.home-manager
          {
            home-manager = {
              useGlobalPkgs = true;
              useUserPackages = true;
              extraSpecialArgs = {
                inherit inputs;
              };
              verbose = true;
              sharedModules = [];
              users.neo = import ./home/macos-personal-laptop-01.nix;
            };
          }
        ];
      };
    };

    # formatter = forAllSystems (pkgs: pkgs.alejandra);
    devShells = forAllSystems (pkgs: {
      default = pkgs.callPackage ./nix/shell.nix {};
    });
  };
}
