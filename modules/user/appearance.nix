{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "user.appearance";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  home.ifEnabled = {
    targets.darwin.defaults = {
      "com.apple.menuextra.clock" = {
        IsAnalog = false;
        Show24Hour = true;
        ShowDate = 1;
        ShowDayOfMonth = true;
        ShowDayOfWeek = true;
        ShowSeconds = false;
      };
      NSGlobalDomain = {
        AppleInterfaceStyle = "Dark";
        _HIHideMenuBar = true;
      };
    };
  };
}
