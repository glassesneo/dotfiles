{
  description = "Modular configuration of Home Manager and Nix-Darwin with Denix";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    home-manager = {
      url = "github:nix-community/home-manager/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nix-darwin = {
      url = "github:nix-darwin/nix-darwin/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    denix = {
      url = "github:yunfachi/denix";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.home-manager.follows = "home-manager";
      inputs.nix-darwin.follows = "nix-darwin";
    };
  };

  outputs = {denix, ...} @ inputs: let
    mkConfigurations = moduleSystem:
      denix.lib.configurations {
        inherit moduleSystem;
        homeManagerUser = "neo";

        paths = [
          ./hosts
          ./modules
        ];

        extensions = with denix.lib.extensions; [
          args
          (base.withConfig {
            args.enable = true;
            rices.enable = false;
          })
        ];

        specialArgs = {
          inherit inputs;
        };
      };
  in {
    # nixosConfigurations = mkConfigurations "nixos";
    homeConfigurations = mkConfigurations "home";
    darwinConfigurations = mkConfigurations "darwin";
  };
}
