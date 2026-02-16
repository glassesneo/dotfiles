{
  delib,
  moduleSystem,
  homeManagerUser,
  config,
  pkgs,
  ...
}: let
  shared = {
    # useUserPackages = true;
    # useGlobalPkgs = true;
    backupFileExtension = "home_manager_backup";
  };
in
  delib.module {
    name = "home-manager";

    myconfig.always.args.shared.homeConfig =
      if moduleSystem == "home"
      then config
      else config.home-manager.users.${homeManagerUser};

    darwin.always.home-manager = shared;

    home.always = {myconfig, ...}: let
      inherit (myconfig.constants) username;
    in {
      home = {
        inherit username;
        homeDirectory =
          if pkgs.stdenv.isDarwin
          then "/Users/${username}"
          else "/home/${username}";
      };
    };
  }
