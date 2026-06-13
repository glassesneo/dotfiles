{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.appcleaner";

  options = delib.singleEnableOption false;

  home.ifEnabled = {
    home.packages = [pkgs.appcleaner];
  };
}
