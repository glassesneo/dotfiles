{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.slack";

  options = delib.singleEnableOption host.guiShellFeatured;

  home.ifEnabled = {
    home.packages = [
      pkgs.slack
    ];
  };
}
