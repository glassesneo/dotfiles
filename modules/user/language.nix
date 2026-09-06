{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "user.language";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  home.ifEnabled = {
    targets.darwin.defaults = {
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
}
