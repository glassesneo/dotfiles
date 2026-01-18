{
  config,
  delib,
  homeManagerUser,
  moduleSystem,
  pkgs,
  ...
}:
delib.module {
  name = "home";

  myconfig.always.args.shared = {
    homeConfig =
      if moduleSystem == "home"
      then config
      else config.home-manager.users.${homeManagerUser};
  };

  home.always = {myconfig, ...}: let
    inherit (myconfig.constants) username;
  in {
    home = {
      inherit username;
      # If you don't need Nix-Darwin, or if you're using it exclusively,
      # you can keep the string here instead of the condition.
      homeDirectory =
        if pkgs.stdenv.isDarwin
        then "/Users/${username}"
        else "/home/${username}";
    };

    # home-manager.backupFileExtension = "backup";
  };
}
