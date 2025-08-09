{delib, ...}:
delib.host {
  name = "desktop";

  # useHomeManagerModule = false;
  homeManagerSystem = "aarch64-darwin";
  home.home.stateVersion = "24.05";

  darwin = {
    nixpkgs.hostPlatform = "aarch64-darwin";
    system.stateVersion = 6;
  };
}
