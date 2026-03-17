{delib, ...}:
delib.module {
  name = "nix-darwin.system.appearance";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {
    system.defaults = {
      menuExtraClock = {
        IsAnalog = false;
        Show24Hour = true;
        ShowDate = 1;
        ShowDayOfMonth = true;
        ShowDayOfWeek = true;
        ShowSeconds = false;
      };
      NSGlobalDomain = {
        AppleInterfaceStyle = "Dark"; # dark mode
        _HIHideMenuBar = true;
      };
    };
  };
}
