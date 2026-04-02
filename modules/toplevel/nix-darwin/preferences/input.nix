{delib, ...}:
delib.module {
  name = "nix-darwin.preferences.input";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {
    system = {
      keyboard = {
        enableKeyMapping = true;
        remapCapsLockToControl = true;
      };
      defaults = {
        NSGlobalDomain = {
          # Keyboard
          AppleKeyboardUIMode = 3; # Mode 3 enables full keyboard control.
          ApplePressAndHoldEnabled = false; # Enable accent menu when holding down keys, default is true
          InitialKeyRepeat = 12; # Normal minimum is 15 (225 ms), maximum is 120 (1800 ms)
          KeyRepeat = 1; # Normal minimum is 2 (30 ms), maximum is 120 (1800 ms)
          NSAutomaticCapitalizationEnabled = false;
          NSAutomaticDashSubstitutionEnabled = false;
          NSAutomaticPeriodSubstitutionEnabled = false;
          NSAutomaticQuoteSubstitutionEnabled = false;
          NSAutomaticSpellingCorrectionEnabled = false;
          "com.apple.keyboard.fnState" = false;

          # Mouse & Trackpad
          AppleEnableMouseSwipeNavigateWithScrolls = true;
          AppleEnableSwipeNavigateWithScrolls = true;
          "com.apple.swipescrolldirection" = true; # Enable natural scrolling(default to true)
          "com.apple.trackpad.scaling" = 3.0;
        };
        trackpad = {
          ActuationStrength = 1;
          Clicking = false;
          Dragging = false;
          TrackpadRightClick = false;
          TrackpadThreeFingerDrag = false;
          TrackpadThreeFingerTapGesture = 0;
        };
      };
    };
  };
}
