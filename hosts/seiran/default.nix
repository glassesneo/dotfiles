{delib, ...}:
delib.host {
  name = "seiran";
  type = "laptop";
  rice = "catppuccin";
  tier = "full";
  hasNotch = true;
  myconfig.services.kanata.profile = "macbook-us";
  myconfig.darwin.window-manager.backend = "rift";
  myconfig.programs.appcleaner.enable = true;
  myconfig.user.uid = 501;
}
