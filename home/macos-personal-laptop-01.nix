{pkgs, ...}: {
  home.stateVersion = "24.11";
  imports = [
    ./common
    ./darwin/zsh.nix
    ./darwin/nushell.nix
    ./darwin/homebrew.nix
    ./darwin/services.nix
    ./darwin/gui.nix
  ];
  home.packages = with pkgs; [
    nowplaying-cli
  ];
}
