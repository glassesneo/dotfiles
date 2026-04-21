{
  delib,
  brewCasks,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.dia";

  options = delib.singleEnableOption (pkgs.stdenv.isDarwin && host.guiShellFeatured);

  home.ifEnabled = {
    home.packages = [
      brewCasks.thebrowsercompany-dia
    ];
  };
}
