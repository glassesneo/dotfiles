{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.alejandra";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled = {
    home.packages = [pkgs.alejandra];
  };
}
