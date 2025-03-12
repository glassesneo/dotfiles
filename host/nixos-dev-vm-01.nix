{inputs, ...}: let
in
  inputs.nixpkgs.lib.nixosSystem {
    system = "aarch64-linux";
    specialArgs = {
      inherit inputs;
      hostName = "nixos-dev-vm-01";
    };
    modules = [
      ../system/nixos/configuration.nix
      inputs.home-manager.nixosModules.home-manager
      {
        home-manager = {
          useGlobalPkgs = true;
          useUserPackages = true;
          extraSpecialArgs = {
            inherit inputs;
          };
          verbose = true;
          users.neo = {pkgs, ...}: {
            home = {
              username = "neo";
              homeDirectory = "/home/neo";
              stateVersion = "25.05";
              packages = with pkgs; [
                bat
                btop
                coreutils
                duf
                fastfetch
                fd
                fzf
                jq
                ripgrep
                sl
                unrar
                uv
                vim-startuptime
                xz
              ];
            };

            xdg.enable = true;
            programs.home-manager.enable = true;
            nixpkgs = {
              config = {
                allowUnfree = true;
                allowUnfreePredicate = _: true;
              };
            };

            imports = [
              ./common/direnv.nix
              ./common/git.nix
              ./common/gh.nix
              ./common/eza.nix
              ./common/neovim.nix
              # ./common/oh-my-posh.nix
              ./common/starship.nix
              ./common/zsh.nix
              ./nixos/gui.nix
            ];
          };
        };
      }
    ];
  }
