{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.ghq";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    home.packages = [
      pkgs.ghq
    ];
  };
}
