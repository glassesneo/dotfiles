{delib, ...}:
delib.module {
  name = "nix-darwin";

  darwin.always = {myconfig, ...}: {
    system = {
      primaryUser = myconfig.constants.username;

      # Reload the preference database after each activation so changes apply
      # to the current session without requiring logout/login.
      activationScripts.postActivation.text = ''
        sudo -u ${myconfig.constants.username} /System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings -u
      '';
    };
  };
}
