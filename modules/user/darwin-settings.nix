{
  delib,
  homeConfig,
  pkgs,
  ...
}:
delib.module {
  name = "user.darwin-settings";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  home.ifEnabled = {
    # User defaults stay cached until the preference database is reloaded.
    home.activation.activateDarwinSettings = homeConfig.lib.dag.entryAfter ["setDarwinDefaults" "writeBoundary"] ''
      /System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings -u
    '';
  };
}
