{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "system.hot-corners";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  darwin.ifEnabled = {
    system.defaults.dock = {
      # 1 = Disabled
      wvous-tl-corner = 1;
      wvous-tr-corner = 1;
      wvous-bl-corner = 13; # Lock Screen
      wvous-br-corner = 1;
    };
  };
}
