{delib, ...}:
delib.module {
  name = "nix-darwin.system.feedback";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {
    system.defaults = {
      NSGlobalDomain = {
        # `defaults read NSGlobalDomain "xxx"`
        "com.apple.sound.beep.volume" = 0.0;
        "com.apple.sound.beep.feedback" = 0;
      };
      CustomUserPreferences."com.apple.universalaccess" = {
        flashScreen = false;
      };
    };
  };
}
