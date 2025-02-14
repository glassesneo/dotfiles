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
    nixgl = {
      url = "github:nix-community/nixgl";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # ghostty = {
    #   url = "github:ghostty-org/ghostty/v1.1.0";
    # };
  };

  outputs =
    inputs@{
      self,
      nixpkgs,
      home-manager,
      nix-darwin,
      nixgl,
    # ghostty
    }:
    let
      userName = builtins.getEnv "USER";
      # userEmail = "glassesneo@protonmail.com";
      system = builtins.currentSystem;
      pkgs = import nixpkgs {
        inherit system;
        config.allowUnfree = true;
        overlays = [ nixgl.overlays.default ];
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
            ./home/ubuntu-dev-vm-01.nix
          ];
        };
      };
      darwinConfigurations = {
        "macos-personal-laptop-01" = nix-darwin.lib.darwinSystem {
          inherit system inputs;
          modules = [
            (import ./system/darwin { hostName = "macos-personal-laptop-01"; })
            home-manager.darwinModules.home-manager
            {
              home-manager = {
                useGlobalPkgs = true;
                useUserPackages = true;
                extraSpecialArgs = {
                  inherit inputs;
                };
                verbose = true;
                users."${userName}" = import ./home/macos-personal-laptop-01.nix;
              };
            }
          ];
        };
      };
    };
}
