{delib, ...}:
delib.host {
  name = "seiran";

  homeManagerSystem = "aarch64-darwin";
  home.home.stateVersion = "25.05";

  darwin = {
    nixpkgs.hostPlatform = "aarch64-darwin";
    system.stateVersion = 4;
    ids.gids.nixbld = 350;
  };
}
