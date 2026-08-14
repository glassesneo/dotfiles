{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "system.developer";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  darwin.ifEnabled = {
    system.defaults.CustomUserPreferences.NSGlobalDomain = {
      # Add a context menu item for showing the Web Inspector in web views
      WebKitDeveloperExtras = true;
    };
  };
}
