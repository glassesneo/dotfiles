{
  delib,
  homeManagerUser,
  inputs,
  moduleSystem,
  config,
  pkgs,
  ...
}: let
  shared = {
    backupFileExtension = "home_manager_backup";
  };
  copiedAppsDirectory = "Applications/Home Manager Apps";
  lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
in
  delib.module {
    name = "home-manager";

    myconfig.always.args.shared = {
      homeConfig =
        if moduleSystem == "home"
        then config
        else config.home-manager.users.${homeManagerUser};
      copiedDarwinApps = {
        directory = copiedAppsDirectory;
        path = name: "/Users/${homeManagerUser}/${copiedAppsDirectory}/${name}.app";
      };
    };

    darwin.always.home-manager = shared;
    nixos.always.home-manager = shared;

    home.always = {
      home = {
        username = homeManagerUser;
        homeDirectory =
          if pkgs.stdenv.isDarwin
          then "/Users/${homeManagerUser}"
          else "/home/${homeManagerUser}";
        activation.registerCopiedDarwinApps = pkgs.lib.mkIf pkgs.stdenv.isDarwin (
          inputs.home-manager.lib.hm.dag.entryAfter ["copyApps"] ''
            $DRY_RUN_CMD ${pkgs.lib.escapeShellArg lsregister} -R -f "$HOME/${copiedAppsDirectory}"
          ''
        );
      };
      targets.darwin = pkgs.lib.mkIf pkgs.stdenv.isDarwin {
        linkApps.enable = false;

        copyApps = {
          enable = true;
          directory = copiedAppsDirectory;
        };
      };
    };
  }
