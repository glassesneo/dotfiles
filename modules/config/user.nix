{delib, ...}:
delib.module {
  name = "user";

  darwin.always = {myconfig, ...}: let
    inherit (myconfig.constants) username;
  in {
    users.users.${username} = {
      name = username;
      home = "/Users/${username}";
    };
  };

  nixos.always = {myconfig, ...}: let
    inherit (myconfig.constants) username;
  in {
    users.users.${username} = {
      name = username;
      home = "/home/${username}";
    };
  };
}
