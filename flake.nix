{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nix-darwin = {
      url = "github:LnL7/nix-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{
      self,
      nixpkgs,
      home-manager,
      nix-darwin,
    }:
    let
      userName = builtins.getEnv "USER";
      # userEmail = "glassesneo@protonmail.com";
      system = builtins.currentSystem;
      pkgs = import nixpkgs {
        inherit system;
        config.allowUnfree = true;
      };
    in
    {
      # for non-NixOS
      homeConfigurations = {
        "${userName}@ubuntu-dev-vm-01" = home-manager.lib.homeManagerConfiguration {
          inherit pkgs;
          extraSpecialArgs = {
            inherit inputs;
          };
          modules = [
            ./home/hosts/ubuntu-dev-vm-01.nix
          ];
        };
      };
      darwinConfigurations = {
        "macos-personal-laptop-01" = nix-darwin.lib.darwinSystem {
          system = system;
          modules = [
            (import ./system/darwin/configuration.nix { hostName = "macos-personal-laptop-01"; })
            home-manager.darwinModules.home-manager
            {
              home-manager = {
                useGlobalPkgs = true;
                useUserPackages = true;
                # extraSpecialArgs = specialArgs;
                verbose = true;
                users."${userName}" = import ./home/hosts/macos-personal-laptop-01.nix;
              };
            }
          ];

        };
      };
    };
}
