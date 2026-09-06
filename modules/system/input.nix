{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "system.input";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  darwin.ifEnabled = {
    system.keyboard = {
      enableKeyMapping = true;
      remapCapsLockToControl = false;
    };
  };
}
