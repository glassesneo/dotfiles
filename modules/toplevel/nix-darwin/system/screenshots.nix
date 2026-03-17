{delib, ...}:
delib.module {
  name = "nix-darwin.system.screenshots";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {
    system.defaults.CustomUserPreferences."com.apple.screencapture" = {
      location = "~/Desktop";
      type = "jpg";
    };
  };
}
