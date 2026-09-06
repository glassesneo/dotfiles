{
  brewCasks,
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.skim";

  options = delib.singleEnableOption (pkgs.stdenv.isDarwin && host.guiShellFeatured);

  home.ifEnabled = {
    home.packages = [
      brewCasks.skim
    ];

    targets.darwin.defaults."net.sourceforge.skim-app.skim" = {
      SKAutoReloadFileUpdate = true;
    };
  };
}
