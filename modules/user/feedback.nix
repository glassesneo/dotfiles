{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "user.feedback";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  home.ifEnabled = {
    targets.darwin.defaults = {
      NSGlobalDomain = {
        "com.apple.sound.beep.volume" = 0.0;
        "com.apple.sound.beep.feedback" = 0;
      };
      "com.apple.universalaccess" = {
        flashScreen = false;
      };
    };
  };
}
