{
  delib,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.pay-respects";

  options.programs.pay-respects = with delib; {
    enable = boolOption true;
    useSl = boolOption true;
  };

  home.ifEnabled = {cfg, ...}: {
    programs.pay-respects = {
      enable = cfg.enable && !cfg.useSl;
    };

    home.packages = lib.mkIf cfg.useSl [pkgs.sl];

    programs.zsh.initContent = lib.mkIf cfg.useSl (lib.mkAfter ''
      command_not_found_handler() {
        "${lib.getExe pkgs.sl}"
        return 127
      }
    '');
  };
}
