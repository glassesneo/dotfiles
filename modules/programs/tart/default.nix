{
  delib,
  host,
  pkgs,
  tiers,
  ...
}:
delib.module {
  name = "programs.tart";

  options = with delib;
    moduleOptions {
      enable = boolOption (pkgs.stdenv.isDarwin && tiers.atLeast host.tier "standard");
      package = packageOption pkgs.tart;
    };

  home.ifEnabled = {cfg, ...}: {
    home.packages = [cfg.package];
  };
}
