{delib, ...}:
delib.module {
  name = "programs.pay-respects";

  options.programs.pay-respects = with delib; {
    enable = boolOption true;
  };

  home.ifEnabled = {cfg, ...}: {
    programs.pay-respects = {
      enable = cfg.enable;
    };
  };
}
