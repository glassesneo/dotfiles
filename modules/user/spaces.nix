{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "user.spaces";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  home.ifEnabled = {
    targets.darwin.defaults = {
      ".GlobalPreferences" = {
        AppleSpacesSwitchOnActivate = true;
      };
      "com.apple.WindowManager" = {
        EnableStandardClickToShowDesktop = 0;
        StandardHideDesktopIcons = 0;
        HideDesktop = 0;
        StageManagerHideWidgets = 0;
        StandardHideWidgets = 0;
      };
    };
  };
}
