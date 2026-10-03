{delib, ...}:
delib.module {
  name = "nh";
  meta.description = "Provide nh for package and option searches.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [pkgs.nh];
    environment.sessionVariables.NH_SHOW_ACTIVATION_LOGS = "1";
  };
}
