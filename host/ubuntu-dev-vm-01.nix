{inputs, ...}:
inputs.home-manager.lib.homeManagerConfiguration {
  pkgs = inputs.nixpkgs.legacyPackages."aarch64-linux";
  extraSpecialArgs = {
    inherit inputs;
  };
  modules = [
    ({pkgs, ...}: let
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
    in {
      home = {
        username = "neo";
        homeDirectory = "/home/neo";
        stateVersion = "25.05";
        inherit packages;
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
      ];
    })
  ];
}
