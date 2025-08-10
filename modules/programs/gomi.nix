{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.gomi";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    home.shellAliases = {
      rm = "gomi";
    };

    home.packages = [
      pkgs.gomi
    ];
  };
}
