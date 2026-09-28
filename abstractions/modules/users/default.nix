{
  delib,
  lib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "users";

  darwin.always = {
    system.primaryUser = lib.mkIf (myconfig.host.primaryUser != null) myconfig.host.primaryUser;
    users.users = builtins.mapAttrs (_: user: {home = user.homeDirectory;}) myconfig.host.users;
  };
})
