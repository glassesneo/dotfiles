{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.gomi";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled = {
    home.shellAliases = {
      rm = "gomi";
    };

    home.packages = [
      pkgs.gomi
    ];
  };
}
