{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "system.security";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  darwin.ifEnabled = {
    security = {
      pam.services.sudo_local = {
        touchIdAuth = true;
        reattach = true;
      };
    };
    system.defaults = {
      CustomUserPreferences."com.apple.screensaver" = {
        askForPassword = 1;
        askForPasswordDelay = 0;
      };
      loginwindow.GuestEnabled = false;
    };
  };
}
