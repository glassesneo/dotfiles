{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.tre";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    home.packages = [
      pkgs.tre-command
    ];
  };
}
