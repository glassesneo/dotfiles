{delib, ...}:
delib.module {
  name = "nix-darwin.preferences.privacy";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {
    system.defaults.CustomUserPreferences = {
      "com.apple.AdLib" = {
        allowApplePersonalizedAdvertising = false;
      };
      # Prevent Photos from opening automatically when devices are plugged in
      "com.apple.ImageCapture".disableHotPlug = true;
    };
  };
}
