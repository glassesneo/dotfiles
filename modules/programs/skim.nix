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
  };

  darwin.ifEnabled = {
    system.defaults.CustomUserPreferences = {
      "net.sourceforge.skim-app.skim" = {
        SKAutoReloadFileUpdate = true;
      };
    };
  };
}
