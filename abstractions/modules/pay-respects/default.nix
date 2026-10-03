{
  delib,
  lib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "pay-respects";
  meta.description = "Provide pay-respects or replace command-not-found handling with sl.";

  options = with delib; {
    enable = boolOption true;
    useSl = boolOption true;
    slOptions = listOfOption str ["-a" "-F"];
  };

  hjem.ifEnabled = {pkgs, ...}:
    lib.mkIf (!cfg.useSl) {
      packages = [pkgs.pay-respects];
    };
})
