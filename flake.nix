{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nixpkgs-master.url = "github:NixOS/nixpkgs/master";
    home-manager = {
      url = "github:nix-community/home-manager/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nix-darwin = {
      url = "github:LnL7/nix-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    brew-nix = {
      url = "github:BatteredBunny/brew-nix";
      inputs.nix-darwin.follows = "nix-darwin";
      inputs.brew-api.follows = "brew-api";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    brew-api = {
      url = "github:BatteredBunny/brew-api";
      flake = false;
    };
    agenix = {
      url = "github:ryantm/agenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    mcp-servers-nix = {
      url = "github:natsukium/mcp-servers-nix";
      # inputs.nixpkgs.follows = "nixpkgs";
    };
    nixvim = {
      url = "github:nix-community/nixvim";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    mcp-hub = {
      url = "github:ravitemer/mcp-hub";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    mcphub-nvim = {
      url = "github:ravitemer/mcphub.nvim";
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
  };

  outputs = inputs @ {
    nixpkgs,
    nixpkgs-master,
    ...
  }: let
    allSystems = [
      "aarch64-darwin"
      "aarch64-linux"
    ];
    forAllSystems = fn: nixpkgs.lib.genAttrs allSystems fn;
  in {
    # for darwin with home-manager
    darwinConfigurations = {
      "neo@macos-personal-laptop-01" = nixpkgs.legacyPackages."aarch64-darwin".callPackage ./host/macos-personal-laptop-01.nix {
        inherit inputs;
        pkgsMaster = nixpkgs-master.legacyPackages."aarch64-darwin";
      };
    };
    # for NixOS with home-manager
    nixosConfigurations = {
      "neo@nixos-dev-vm-01" = nixpkgs.legacyPackages."aarch64-linux".callPackage ./host/nixos-dev-vm-01.nix {inherit inputs;};
    };
    # for non-NixOS with home-manager
    homeConfigurations = {
      "neo@ubuntu-dev-vm-01" = nixpkgs.legacyPackages."aarch64-linux".callPackage ./host/ubuntu-dev-vm-01.nix {inherit inputs;};
    };

    devShells = forAllSystems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      default = pkgs.callPackage ./nix/shell.nix {};
    });
  };
}
