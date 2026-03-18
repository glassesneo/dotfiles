{delib, ...}:
delib.module {
  name = "nix-darwin.preferences.language";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {
    system.defaults = {
      CustomUserPreferences = {
        NSGlobalDomain = {
          AppleLanguages = [
            "ja-JP"
            "en-US"
          ];

          AppleLocale = "en_US";
        };
      };
    };
  };
}
