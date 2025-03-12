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
    nixvim = {
      url = "github:nix-community/nixvim";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    dpp-vim = {
      url = "github:Shougo/dpp.vim";
      flake = false;
    };
    dpp-ext-installer = {
      url = "github:Shougo/dpp-ext-installer";
      flake = false;
    };
    dpp-ext-lazy = {
      url = "github:Shougo/dpp-ext-lazy";
      flake = false;
    };
    dpp-ext-toml = {
      url = "github:Shougo/dpp-ext-toml";
      flake = false;
    };
    dpp-protocol-git = {
      url = "github:Shougo/dpp-protocol-git";
      flake = false;
    };
    # apple-fonts.url = "github:Lyndeno/apple-fonts.nix";
  };

  outputs = inputs @ {
    self,
    nixpkgs,
    ...
  }: let
    allSystems = [
      "aarch64-darwin"
      "aarch64-linux"
    ];
    forAllSystems = func:
      nixpkgs.lib.genAttrs allSystems (system: func nixpkgs.legacyPackages.${system});
  in {
    # for darwin with home-manager
    darwinConfigurations = {
      "neo@macos-personal-laptop-01" = nixpkgs.legacyPackages."aarch64-darwin".callPackage ./host/macos-personal-laptop-01.nix {inherit inputs;};
    };
    # for NixOS with home-manager
    nixosConfigurations = {
      "neo@nixos-dev-vm-01" = nixpkgs.legacyPackages."aarch64-linux".callPackage ./host/nixos-dev-vm-01.nix {inherit inputs;};
    };
    # for non-NixOS with home-manager
    homeConfigurations = {
      "neo@ubuntu-dev-vm-01" = nixpkgs.legacyPackages."aarch64-linux".callPackage ./host/ubuntu-dev-vm-01.nix {inherit inputs;};
    };

    # formatter = forAllSystems (pkgs: pkgs.alejandra);
    devShells = forAllSystems (pkgs: {
      default = pkgs.callPackage ./nix/shell.nix {};
    });
  };
}
