{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "nix-darwin.system.security";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  darwin.ifEnabled = {
    security = {
      # Add ability to use TouchID for sudo authentication
      pam.services.sudo_local = {
        touchIdAuth = true;
        reattach = true;
      };
    };
    system.defaults = {
      CustomUserPreferences."com.apple.screensaver" = {
        # Require password immediately after sleep or screen saver begins
        askForPassword = 1;
        askForPasswordDelay = 0;
      };
      loginwindow.GuestEnabled = false; # disable guest user
    };
  };
}
