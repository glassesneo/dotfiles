{
  delib,
  inputs,
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

    options.theme.catppuccin = with delib; {
      enable = boolOption false;
      flavor = enumOption ["latte" "frappe" "macchiato" "mocha"] "macchiato";
    };

    myconfig.always.args.shared.homeConfig =
      if moduleSystem == "home"
      then config
      else config.home-manager.users.${homeManagerUser};

    darwin.always.home-manager = shared;
    nixos.always.home-manager = shared;

    home.always = {myconfig, ...}: let
      inherit (myconfig.constants) username;
    in {
      imports = [inputs.catppuccin.homeModules.catppuccin];
      catppuccin = {
        inherit (myconfig.theme.catppuccin) enable flavor;
        nvim.enable = false;
        tmux.enable = false;
        firefox.enable = false;
      };
      home = {
        inherit username;
        homeDirectory =
          if pkgs.stdenv.isDarwin
          then "/Users/${username}"
          else "/home/${username}";
      };
    };
  }
