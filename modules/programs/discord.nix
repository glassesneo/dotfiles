{
  delib,
  host,
  tiers,
  ...
}:
delib.module {
  name = "programs.discord";

  options = delib.singleEnableOption (tiers.atLeast host.tier "standard");

  home.ifEnabled = {
    programs.discord = {
      enable = true;
    };
  };
}
