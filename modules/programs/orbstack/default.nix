{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.orbstack";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    home.packages = [
      pkgs.orbstack
    ];
  };
}
