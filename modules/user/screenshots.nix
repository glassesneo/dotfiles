{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "user.screenshots";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  home.ifEnabled = {
    targets.darwin.defaults."com.apple.screencapture" = {
      location = "~/Desktop";
      type = "jpg";
    };
  };
}
