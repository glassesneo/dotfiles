{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "nix-darwin.preferences.language";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  darwin.ifEnabled = {
    system.defaults = {
      CustomUserPreferences = {
        "com.apple.Music" = {
          AppleLanguages = ["ja"];
        };
        NSGlobalDomain = {
          AppleLanguages = [
            "en-US"
            "ja-JP"
          ];

          AppleLocale = "en_US";
        };
      };
    };
  };
}
