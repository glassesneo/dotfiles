{
  delib,
  host,
  pkgs,
  tiers,
  ...
}:
delib.module {
  name = "programs.tart";

  options = delib.singleEnableOption (tiers.atLeast host.tier "standard");

  home.ifEnabled = {
    home.packages = [pkgs.tart];
  };
}
