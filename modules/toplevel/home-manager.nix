{
  delib,
  moduleSystem,
  homeManagerUser,
  config,
  pkgs,
  ...
}: let
  shared = {
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
    nixos.always.home-manager = shared;

    home.always = {
      home = {
        username = homeManagerUser;
        homeDirectory =
          if pkgs.stdenv.isDarwin
          then "/Users/${homeManagerUser}"
          else "/home/${homeManagerUser}";
      };
      targets.darwin = pkgs.lib.mkIf pkgs.stdenv.isDarwin {
        linkApps.enable = false;

        copyApps = {
          enable = true;
          directory = "Applications/Home Manager Apps";
        };
      };
    };
  }
