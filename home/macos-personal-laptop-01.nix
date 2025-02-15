{
  home.stateVersion = "24.11";
  imports = [
    ./common.nix
    ./packages.nix
    ./programs
    ./darwin/zsh.nix
    ./darwin/nushell.nix
    ./darwin/homebrew.nix
    ./darwin/services.nix
    ./darwin/gui.nix
  ];
}
