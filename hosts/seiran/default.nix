{delib, ...}:
delib.host {
  name = "seiran";
  type = "laptop";
  rice = "vivid";
  tier = "full";
  hasNotch = true;
  myconfig.services.kanata.profile = "macbook-us";
  myconfig.programs.appcleaner.enable = true;
  myconfig.programs.tart.vms = {
    seiran-vm0.os = "linux";
    seiran-vm1.os = "darwin";
  };
  myconfig.user.uid = 501;
}
