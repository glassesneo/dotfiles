{
  home.stateVersion = "24.11";
  imports = [
    ./common.nix
    ./darwin/homebrew.nix
    ./darwin/services.nix
    ./darwin/gui.nix
    ./packages.nix
    ./programs
  ];
}
