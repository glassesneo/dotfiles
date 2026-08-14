{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "system.privacy";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

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
