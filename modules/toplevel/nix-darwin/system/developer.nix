{delib, ...}:
delib.module {
  name = "nix-darwin.system.developer";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {
    system.defaults.CustomUserPreferences.NSGlobalDomain = {
      # Add a context menu item for showing the Web Inspector in web views
      WebKitDeveloperExtras = true;
    };
  };
}
