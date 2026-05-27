{delib, ...}:
delib.host {
  name = "seiran-vm0";
  type = "virtual";
  tier = "standard";
  myconfig.programs.proton-pass-cli.enable = false;
  myconfig.programs.reload.enable = false;
}
