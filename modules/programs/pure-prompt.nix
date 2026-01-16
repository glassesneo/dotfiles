{
  delib,
  homeConfig,
  pkgs,
  lib,
  ...
}:
delib.module {
  name = "programs.pure-prompt";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.zsh = {
      initContent = ''
        autoload -U promptinit; promptinit
        prompt pure
      '';
    };

    home.packages = lib.mkIf homeConfig.programs.zsh.enable [pkgs.pure-prompt];
  };
}
