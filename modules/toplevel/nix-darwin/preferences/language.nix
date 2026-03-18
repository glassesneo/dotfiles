{delib, ...}:
delib.module {
  name = "nix-darwin.preferences.language";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {
    system.defaults = {
      CustomUserPreferences = {
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
