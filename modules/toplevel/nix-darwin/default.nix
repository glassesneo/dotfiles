{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "nix-darwin";

  darwin.always = {myconfig, ...}: {
    users.users = {
      "${myconfig.constants.username}" = {
        shell = pkgs.zsh;
      };
    };

    environment = {
      variables = {
        LC_ALL = "en_US.UTF-8";
      };
    };

    networking = {
      hostName = host.name;
      computerName = host.name;
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

    system.primaryUser = myconfig.constants.username;
  };
}
