{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "system.spaces";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  darwin.ifEnabled = {
    system.defaults.CustomUserPreferences = {
      "com.apple.spaces" = {
        "spans-displays" = 0;
      };
    };
  };
}
