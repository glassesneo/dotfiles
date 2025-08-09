{
  delib,
  pkgs,
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

    home.packages = [pkgs.pure-prompt];
  };
}
