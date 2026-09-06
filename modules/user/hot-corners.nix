{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "user.hot-corners";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  home.ifEnabled = {
    targets.darwin.defaults."com.apple.dock" = {
      # 1 = Disabled
      wvous-tl-corner = 1;
      wvous-tr-corner = 1;
      wvous-bl-corner = 13; # Lock Screen
      wvous-br-corner = 1;
    };
  };
}
