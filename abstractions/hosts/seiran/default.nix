{delib, ...}:
delib.host {
  name = "seiran";
  system = "aarch64-darwin";
  users.neo = {};

  darwin.ifEnabled.system.stateVersion = 4;
}
