{pkgs, ...}: {
  xdg.enable = true;

  home = {
    username = builtins.getEnv "USER";
    homeDirectory = builtins.getEnv "HOME";
    packages = with pkgs; [
      bat
      btop
      coreutils
      devbox
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

  programs.home-manager.enable = true;

  imports = [
    ./direnv.nix
    ./git.nix
    ./gh.nix
    ./eza.nix
    ./neovim.nix
    ./starship.nix
    ./zsh.nix
  ];
}
