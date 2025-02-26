{pkgs, ...}: {
  home.stateVersion = "24.11";
  imports = [
    ./common/direnv.nix
    ./common/git.nix
    ./common/gh.nix
    ./common/eza.nix
    ./common/neovim.nix
    ./common/oh-my-posh.nix
    # ./common/starship.nix
    ./common/zsh.nix
    ./darwin/nushell.nix
    ./darwin/homebrew.nix
    ./darwin/services.nix
    ./darwin/gui.nix
  ];
  home.packages = with pkgs; [
    nowplaying-cli
  ];
}
