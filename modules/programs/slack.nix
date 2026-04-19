{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.slack";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    home.packages = [
      pkgs.slack
    ];
  };
}
