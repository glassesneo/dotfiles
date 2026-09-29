{delib, ...}:
delib.host {
  name = "seiran-vm1";
  system = "aarch64-darwin";
  users.neo = {};

  darwin.ifEnabled = {
    system.stateVersion = 4;
    ids.gids.nixbld = 350;
  };
}
