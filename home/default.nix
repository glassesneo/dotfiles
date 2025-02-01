{
  home = rec {
    username = "neo";
    homeDirectory = "/home/${username}";
    stateVersion = "25.05";
  };
  xdg.enable = true;
  programs.home-manager.enable = true;
  imports = [
    ./packages.nix
    ./programs
  ];
}
