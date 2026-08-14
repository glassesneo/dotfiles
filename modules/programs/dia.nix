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

  darwin.ifEnabled = {
    system.defaults.CustomUserPreferences = {
      "company.thebrowser.dia" = {
        SUEnableAutomaticChecks = false;
        SUAutomaticallyUpdate = false;
      };
    };
  };

  home.ifEnabled = {
    home.packages = [
      brewCasks.thebrowsercompany-dia
    ];
  };
}
