{delib, ...}:
delib.host {
  name = "seiran";
  darwin.ifEnabled = {
    nixpkgs.hostPlatform = "aarch64-darwin";
    system.stateVersion = 4;
    system.primaryUser = "neo";

    users.users.neo = {
      name = "neo";
      home = "/Users/neo";
    };
  };
}
