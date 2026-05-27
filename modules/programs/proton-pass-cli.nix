{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.proton-pass-cli";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled = {
    home.packages = [
      pkgs.proton-pass-cli
    ];
  };
}
