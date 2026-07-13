{delib, ...}:
delib.host {
  name = "seiran-vm1";

  homeManagerSystem = "aarch64-darwin";
  home.home.stateVersion = "25.05";

  darwin = {
    nix.settings = {
      max-jobs = 4;
      cores = 4;
    };
    nixpkgs.hostPlatform = "aarch64-darwin";
    system.stateVersion = 4;
    ids.gids.nixbld = 350;
  };
}
