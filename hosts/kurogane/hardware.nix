{delib, ...}:
delib.host {
  name = "kurogane";

  # useHomeManagerModule = false;
  homeManagerSystem = "aarch64-darwin";
  home.home.stateVersion = "24.11";

  darwin = {
    nixpkgs.hostPlatform = "aarch64-darwin";
    system.stateVersion = 4;
  };
}
