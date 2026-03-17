{delib, ...}:
delib.module {
  name = "nix-darwin.system";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {myconfig, ...}: {
    system = {
      # activationScripts are executed every time you boot the system or run `nixos-rebuild` / `darwin-rebuild`.
      activationScripts.postActivation.text = ''
          # activateSettings -u will reload the settings from the database and apply them to the current session,
        # so we do not need to logout and login again to make the changes take effect.
        sudo -u ${myconfig.constants.username} /System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings -u
      '';
    };
  };
}
