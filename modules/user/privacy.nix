{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "user.privacy";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  home.ifEnabled = {
    targets.darwin.defaults = {
      "com.apple.AdLib" = {
        allowApplePersonalizedAdvertising = false;
      };
      "com.apple.ImageCapture".disableHotPlug = true;
    };
  };
}
