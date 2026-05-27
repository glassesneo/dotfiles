{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "nix-darwin.preferences.spaces";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  darwin.ifEnabled = {
    system.defaults.CustomUserPreferences = {
      ".GlobalPreferences" = {
        # automatically switch to a new space when switching to the application
        AppleSpacesSwitchOnActivate = true;
      };
      "com.apple.spaces" = {
        "spans-displays" = 0; # Display have seperate spaces
      };
      "com.apple.WindowManager" = {
        EnableStandardClickToShowDesktop = 0; # Click wallpaper to reveal desktop
        StandardHideDesktopIcons = 0; # Show items on desktop
        HideDesktop = 0; # Do not hide items on desktop & stage manager
        StageManagerHideWidgets = 0;
        StandardHideWidgets = 0;
      };
    };
  };
}
