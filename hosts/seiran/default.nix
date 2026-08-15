{delib, ...}:
delib.host {
  name = "seiran";
  type = "laptop";
  rice = "vivid";
  tier = "full";
  hasNotch = true;
  builtInDisplayUuid = "37D8832A-2D66-02CA-B9F7-8F30A301B230";
  myconfig.services.kanata.profile = "macbook-us";
  myconfig.programs.appcleaner.enable = true;
  myconfig.programs.tart.vms = {
    seiran-vm0.os = "linux";
    seiran-vm1.os = "darwin";
  };
  myconfig.system.user.uid = 501;
}
