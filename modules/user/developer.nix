{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "user.developer";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  home.ifEnabled = {
    targets.darwin.defaults.NSGlobalDomain = {
      WebKitDeveloperExtras = true;
    };
  };
}
