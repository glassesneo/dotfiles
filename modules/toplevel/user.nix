{delib, ...}:
delib.module {
  name = "user";

  options = with delib;
    moduleOptions ({myconfig, ...}: {
      username = readOnly (strOption myconfig.constants.username);
      uid = intOption 501;
    });

  darwin.always = {cfg, ...}: {
    users.knownUsers = [
      cfg.username
    ];

    users.users.${cfg.username} = {
      inherit (cfg) uid;
      name = cfg.username;
      home = "/Users/${cfg.username}";
    };
  };

  nixos.always = {cfg, ...}: {
    users.users.${cfg.username} = {
      name = cfg.username;
      home = "/home/${cfg.username}";
    };
  };
}
