{hostName, ...}: {
  nixpkgs = {
    config.allowUnfree = true;
  };
  # users.users.neo.home = "/Users/neo";
  environment.variables = {
    LC_ALL = "en_US.UTF-8";
  };

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
  };
}
