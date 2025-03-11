{
  pkgs,
  lib,
  ...
}: {
  home = {
    username = "neo";
    homeDirectory = lib.mkForce "/Users/neo";
    stateVersion = "24.11";
    packages = with pkgs; [
      bat
      btop
      coreutils
      devbox
      duf
      fastfetch
      fd
      jq
      nowplaying-cli
      ripgrep
      skim
      sl
      # tart
      unrar
      uv
      vim-startuptime
      xz
    ];
  };

  xdg.enable = true;
  programs.home-manager.enable = true;

  imports = [
    ./common/direnv.nix
    ./common/git.nix
    ./common/gh.nix
    ./common/eza.nix
    # ./common/neovim.nix
    ./common/oh-my-posh.nix
    ./common/yazi.nix
    ./common/zed-editor.nix
    # ./common/zellij.nix
    # ./common/starship.nix
    ./common/zsh.nix
    ./darwin/nushell.nix
    ./darwin/homebrew.nix
    ./darwin/services.nix
    ./darwin/gui.nix
  ];
}
