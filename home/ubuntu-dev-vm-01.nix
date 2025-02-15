{
  home.stateVersion = "25.05";
  imports = [
    ./common.nix
    ./packages.nix
    ./programs
    ./linux/zsh.nix
  ];
}
