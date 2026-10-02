{delib, ...}:
delib.host {
  name = "seiran";
  system = "aarch64-darwin";
  users.neo = {};
  primaryUser = "neo";

  myconfig.ifEnabled.shell.loginShell = "zsh";

  darwin.ifEnabled = {
    system.stateVersion = 4;
    ids.gids.nixbld = 350;
  };
}
