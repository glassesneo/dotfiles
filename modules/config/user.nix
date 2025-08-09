{delib, ...}:
delib.module {
  name = "user";

  # nixos.always = {myconfig, ...}: let
  # inherit (myconfig.constants) username;
  # in {
  # users = {
  # groups.${username} = {};

  # users.${username} = {
  # isNormalUser = true;
  # initialPassword = username;
  # extraGroups = ["wheel"];
  # };
  # };
  # };

  darwin.always = {myconfig, ...}: let
    inherit (myconfig.constants) username;
  in {
    users.users.${username} = {
      name = username;
      home = "/Users/${username}";
    };
  };
}
