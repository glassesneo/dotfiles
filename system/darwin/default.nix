{
  pkgs,
  hostName,
  ...
}: {
  nixpkgs = {
    config.allowUnfree = true;
  };
  # users.users.neo.home = "/Users/neo";

  imports = [
    ../common
    ./apps
    ./fonts.nix
    ./systems.nix
  ];
  networking = {
    hostName = hostName;
    computerName = hostName;
  };

  nix = {
    gc = {
      automatic = true;
      interval = {
        Weekday = 0;
        Hour = 0;
        Minute = 0;
      };
      options = "--delete-older-than 7d";
    };
    envVars = {
      SKETCHYBAR_APP_FONT_PATH = "${pkgs.sketchybar-app-font}/bin/icon_map.sh";
    };
  };
}
