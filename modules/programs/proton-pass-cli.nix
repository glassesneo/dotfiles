{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.proton-pass-cli";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    home.packages = [
      pkgs.proton-pass-cli
    ];
  };
}
