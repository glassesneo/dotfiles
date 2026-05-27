{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "nix-darwin.preferences.screenshots";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  darwin.ifEnabled = {
    system.defaults.CustomUserPreferences."com.apple.screencapture" = {
      location = "~/Desktop";
      type = "jpg";
    };
  };
}
