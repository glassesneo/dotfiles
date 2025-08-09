{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.gomi";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.zsh.shellAliases = {
      rm = "gomi";
    };

    home.packages = [
      pkgs.gomi
    ];
  };
}
