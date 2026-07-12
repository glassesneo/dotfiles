{
  delib,
  lib,
  ...
}:
delib.host {
  name = "kurogane";
  type = "laptop";
  rice = "monochrome";
  tier = "basic";
  myconfig.services.kanata.profile = "macbook-us";
  myconfig.darwin.window-manager.backend = lib.mkForce "rift";
}
