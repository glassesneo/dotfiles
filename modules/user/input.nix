{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "user.input";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  home.ifEnabled = {
    targets.darwin.defaults = {
      NSGlobalDomain = {
        AppleKeyboardUIMode = 3; # full keyboard control
        ApplePressAndHoldEnabled = false;
        InitialKeyRepeat = 12;
        KeyRepeat = 1;
        NSAutomaticCapitalizationEnabled = false;
        NSAutomaticDashSubstitutionEnabled = false;
        NSAutomaticPeriodSubstitutionEnabled = false;
        NSAutomaticQuoteSubstitutionEnabled = false;
        NSAutomaticSpellingCorrectionEnabled = false;
        "com.apple.keyboard.fnState" = false;

        AppleEnableMouseSwipeNavigateWithScrolls = true;
        AppleEnableSwipeNavigateWithScrolls = true;
        "com.apple.swipescrolldirection" = true;
        "com.apple.trackpad.scaling" = 3.0;
      };
      "com.apple.symbolichotkeys".AppleSymbolicHotKeys = {
        "32".enabled = false; # Mission Control: Ctrl + Up
        "34".enabled = false; # Slow Mission Control
      };
      "com.apple.AppleMultitouchTrackpad" = {
        ActuationStrength = 1;
        Clicking = false;
        Dragging = false;
        TrackpadRightClick = false;
        TrackpadThreeFingerDrag = false;
        TrackpadThreeFingerTapGesture = 0;
      };
      "com.apple.driver.AppleBluetoothMultitouch.trackpad" = {
        ActuationStrength = 1;
        Clicking = false;
        Dragging = false;
        TrackpadRightClick = false;
        TrackpadThreeFingerDrag = false;
        TrackpadThreeFingerTapGesture = 0;
      };
    };
  };
}
