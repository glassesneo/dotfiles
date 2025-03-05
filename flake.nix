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
    flake-utils.url = "github:numtide/flake-utils";
    # ghostty = {
    #   url = "github:ghostty-org/ghostty/v1.1.0";
    # };
  };

  outputs = inputs @ {
    self,
    nixpkgs,
    home-manager,
    nix-darwin,
    flake-utils,
    ...
    # ghostty
  }: let
    userName = builtins.getEnv "USER";
    # userEmail = "glassesneo@protonmail.com";
    system = builtins.currentSystem;
    pkgs = import nixpkgs {
      inherit system;
      config.allowUnfree = true;
    };
  in {
    # for non-NixOS with home-manager
    homeConfigurations = {
      ${userName} = home-manager.lib.homeManagerConfiguration {
        inherit pkgs;
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
      "macos-personal-laptop-01" = nix-darwin.lib.darwinSystem {
        system = "aarch64-darwin";
        inherit inputs;
        specialArgs = {
          inherit inputs;
          hostName = "macos-personal-laptop-01";
        };
        modules = [
          ./system/darwin
          # (import ./system/darwin {hostName = "macos-personal-laptop-01";})
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

    formatter.${system} = pkgs.alejandra;
    devShells.${system}.default = pkgs.mkShellNoCC {
      name = "dotfiles";
      packages = with pkgs; [
        efm-langserver
        bash-language-server
        shfmt
        tree-sitter
        deno
        gcc
        nil
        # alejandra
        lua-language-server
        stylua
        taplo
        marksman
      ];
    };
  };
}
